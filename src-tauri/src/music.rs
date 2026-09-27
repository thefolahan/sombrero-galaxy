//! Now-playing info from Spotify and Apple Music via AppleScript.
//! We only ask a player if it's already running, so we never launch it by accident.

use crate::model::NowPlaying;
use std::process::Command;

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
