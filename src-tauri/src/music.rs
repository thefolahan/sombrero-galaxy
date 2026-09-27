//! What's playing on the Mac.
//!
//! The primary source is macOS's system-wide Now Playing info (what Control Centre shows),
//! which covers any player: native apps, Safari/Chrome web apps, browser tabs. It lives in the
//! private MediaRemote framework, which recent macOS only answers for Apple-signed programs,
//! so we query it from `osascript` (JavaScript for Automation) rather than from our own binary.
//!
//! If that ever stops working, we fall back to asking Spotify and Apple Music directly via
//! AppleScript, and only when they're already running, so we never launch them by accident.

use crate::model::NowPlaying;
use serde::Deserialize;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const SYSTEM_NOW_PLAYING: &str = r#"
ObjC.import("Foundation");
function run() {
  try {
    $.NSBundle.bundleWithPath("/System/Library/PrivateFrameworks/MediaRemote.framework/").load;
    const Req = $.NSClassFromString("MRNowPlayingRequest");
    const item = Req.localNowPlayingItem;
    if (!item || item.isNil()) return "";
    const info = item.nowPlayingInfo;
    if (!info || info.isNil()) return "";
    const get = (k) => {
      const v = info.objectForKey("kMRMediaRemoteNowPlayingInfo" + k);
      return v.isNil() ? null : ObjC.unwrap(v);
    };
    const client = Req.localNowPlayingPlayerPath.client;
    const ts = get("Timestamp");
    return JSON.stringify({
      player: client.isNil() ? null : ObjC.unwrap(client.displayName),
      playing: !!Req.localIsPlaying,
      title: get("Title"),
      artist: get("Artist"),
      album: get("Album"),
      duration: get("Duration"),
      elapsed: get("ElapsedTime"),
      rate: get("PlaybackRate"),
      timestampMs: ts ? ts.getTime() : null,
    });
  } catch (e) {
    return "";
  }
}
"#;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SystemInfo {
    player: Option<String>,
    playing: bool,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>,
    elapsed: Option<f64>,
    rate: Option<f64>,
    timestamp_ms: Option<f64>,
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// Turns MediaRemote's answer into a [`NowPlaying`]. MediaRemote reports the position as of
/// `timestamp`, so while playing we advance it by the time since then.
fn from_system(json: &str, now_ms: f64) -> Option<NowPlaying> {
    let info: SystemInfo = serde_json::from_str(json.trim()).ok()?;
    let title = info.title.filter(|t| !t.trim().is_empty())?;
    let duration = info.duration.unwrap_or(0.0);
    let mut position = info.elapsed.unwrap_or(0.0);
    if info.playing {
        if let Some(ts) = info.timestamp_ms {
            position += ((now_ms - ts) / 1000.0).max(0.0) * info.rate.unwrap_or(1.0);
        }
    }
    if duration > 0.0 {
        position = position.min(duration);
    }
    Some(NowPlaying {
        player: info.player.unwrap_or_else(|| "Now Playing".into()),
        title,
        artist: info.artist.unwrap_or_default(),
        album: info.album.unwrap_or_default(),
        playing: info.playing,
        position_secs: position,
        duration_secs: duration,
    })
}

fn system_now_playing() -> Option<NowPlaying> {
    let out = Command::new("osascript")
        .args(["-l", "JavaScript", "-e", SYSTEM_NOW_PLAYING])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    from_system(&String::from_utf8_lossy(&out.stdout), now_ms())
}

const SEP: &str = "␟";

fn script(app: &str) -> String {
    // Spotify reports duration in ms, Music in seconds; normalised below.
    format!(
        r#"tell application "{app}"
  if player state is stopped then return ""
  set t to current track
  return (name of t) & "{SEP}" & (artist of t) & "{SEP}" & (album of t) & "{SEP}" & ((player state is playing) as string) & "{SEP}" & (player position as string) & "{SEP}" & ((duration of t) as string)
end tell"#
    )
}

fn parse_num(s: &str) -> f64 {
    // AppleScript may format decimals with a comma depending on locale.
    s.trim().replace(',', ".").parse().unwrap_or(0.0)
}

fn query(app: &str) -> Option<NowPlaying> {
    let out = Command::new("osascript").arg("-e").arg(script(app)).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let parts: Vec<&str> = text.trim_end().split(SEP).collect();
    if parts.len() != 6 {
        return None;
    }
    let mut duration = parse_num(parts[5]);
    if app == "Spotify" {
        duration /= 1000.0;
    }
    Some(NowPlaying {
        player: app.to_string(),
        title: parts[0].to_string(),
        artist: parts[1].to_string(),
        album: parts[2].to_string(),
        playing: parts[3] == "true",
        position_secs: parse_num(parts[4]),
        duration_secs: duration,
    })
}

/// `running_apps` is the set of .app names currently running.
pub fn now_playing(running_apps: &[&str]) -> Option<NowPlaying> {
    system_now_playing().or_else(|| players_now_playing(running_apps))
}

fn players_now_playing(running_apps: &[&str]) -> Option<NowPlaying> {
    let candidates: Vec<NowPlaying> = ["Spotify", "Music"]
        .into_iter()
        .filter(|app| running_apps.contains(app))
        .filter_map(query)
        .collect();
    // Prefer whichever is actually playing.
    let playing = candidates.iter().position(|n| n.playing);
    match playing {
        Some(i) => candidates.into_iter().nth(i),
        None => candidates.into_iter().next(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advances_position_while_playing() {
        let json = r#"{"player":"Spotify","playing":true,"title":"Juicy","artist":"Victoria Monét",
            "album":"Juicy","duration":186.6,"elapsed":10.0,"rate":1,"timestampMs":1000000}"#;
        let np = from_system(json, 1_005_000.0).unwrap();
        assert_eq!(np.player, "Spotify");
        assert!((np.position_secs - 15.0).abs() < 1e-6);
    }

    #[test]
    fn paused_position_stays_put_and_empty_means_nothing() {
        let json = r#"{"player":"Safari","playing":false,"title":"Talk","artist":null,"album":null,
            "duration":60,"elapsed":42,"rate":0,"timestampMs":0}"#;
        assert!((from_system(json, 9e12).unwrap().position_secs - 42.0).abs() < 1e-6);
        assert!(from_system("", 0.0).is_none());
        assert!(from_system(r#"{"playing":false,"title":""}"#, 0.0).is_none());
    }
}
