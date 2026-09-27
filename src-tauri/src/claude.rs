//! Reads Claude Code session transcripts (~/.claude/projects/<dir>/<session>.jsonl)
//! to find out what each running Claude agent is doing and how many tokens it has used.

use crate::model::{AgentStatus, SessionInfo};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Running totals for one transcript, updated incrementally so large files are read once.
#[derive(Default)]
struct Transcript {
    offset: u64,
    info: SessionInfo,
    /// What the last meaningful line tells us about the agent's state.
    last_role: Option<String>,
    last_stop_reason: Option<String>,
}

#[derive(Default)]
pub struct ClaudeSessions {
    transcripts: HashMap<PathBuf, Transcript>,
}

/// Claude Code names a project directory after its cwd with every non-alphanumeric
/// character replaced by '-'.
fn project_dir_name(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

fn projects_root() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".claude").join("projects"))
}

fn truncate(s: &str, max: usize) -> String {
    let s = s.trim().replace('\n', " ");
    if s.chars().count() <= max {
        s
    } else {
        let mut out: String = s.chars().take(max).collect();
        out.push('…');
        out
    }
}

fn describe_tool_use(name: &str, input: &Value) -> String {
    let field = |k: &str| input.get(k).and_then(Value::as_str);
    let detail = match name {
        "Bash" => field("description").or(field("command")),
        "Read" | "Edit" | "Write" | "NotebookEdit" => field("file_path").map(|p| {
            Path::new(p)
                .file_name()
                .and_then(|f| f.to_str())
                .unwrap_or(p)
        }),
        "Grep" | "Glob" => field("pattern"),
        "WebFetch" => field("url"),
        "WebSearch" => field("query"),
        "Task" | "Agent" => field("description"),
        _ => None,
    };
    match detail {
        Some(d) => format!("{name}: {}", truncate(d, 70)),
        None => name.to_string(),
    }
}

impl ClaudeSessions {
    /// Transcripts for `cwd` as (path, modified, created), most recently modified first.
    fn transcripts_for(cwd: &str) -> Vec<(PathBuf, SystemTime, SystemTime)> {
        let Some(root) = projects_root() else {
            return vec![];
        };
        let dir = root.join(project_dir_name(cwd));
        let Ok(entries) = std::fs::read_dir(dir) else {
            return vec![];
        };
        let mut files: Vec<(PathBuf, SystemTime, SystemTime)> = entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
            .filter_map(|e| {
                let meta = e.metadata().ok()?;
                let modified = meta.modified().ok()?;
                Some((e.path(), modified, meta.created().unwrap_or(modified)))
            })
            .collect();
        files.sort_by(|a, b| b.1.cmp(&a.1));
        files
    }

    /// Look up session info for each Claude process, given (pid, cwd, start time in unix secs).
    ///
    /// Transcripts don't record which process wrote them, so when several agents share a cwd
    /// each transcript (newest first) goes to the unmatched agent that started most recently
    /// before the transcript was created. A resumed session's file predates its process, so
    /// failing that it goes to the newest unmatched agent.
    pub fn resolve(&mut self, agents: &[(u32, String, u64)]) -> HashMap<u32, (SessionInfo, AgentStatus)> {
        let mut by_cwd: HashMap<&str, Vec<(u32, u64)>> = HashMap::new();
        for (pid, cwd, start) in agents {
            by_cwd.entry(cwd.as_str()).or_default().push((*pid, *start));
        }

        let unix = |t: SystemTime| t.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let mut out = HashMap::new();
        let mut used = Vec::new();
        for (cwd, mut candidates) in by_cwd {
            candidates.sort_by(|a, b| b.1.cmp(&a.1));
            for (path, modified, created) in Self::transcripts_for(cwd) {
                if candidates.is_empty() {
                    break;
                }
                let created = unix(created);
                let pick = candidates
                    .iter()
                    .position(|(_, start)| *start <= created + 10)
                    .unwrap_or(0);
                let (pid, _) = candidates.remove(pick);
                let age = SystemTime::now()
                    .duration_since(modified)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                if let Some(found) = self.update(&path, age) {
                    out.insert(pid, found);
                }
                used.push(path);
            }
        }
        // Forget transcripts no running agent maps to any more.
        self.transcripts.retain(|p, _| used.contains(p));
        out
    }

    fn update(&mut self, path: &Path, age_secs: u64) -> Option<(SessionInfo, AgentStatus)> {
        let t = self.transcripts.entry(path.to_path_buf()).or_default();
        let mut file = File::open(path).ok()?;
        let len = file.metadata().ok()?.len();
        if len < t.offset {
            // Transcript was rewritten; start over.
            *t = Transcript::default();
        }
        if len > t.offset {
            file.seek(SeekFrom::Start(t.offset)).ok()?;
            let mut buf = Vec::with_capacity((len - t.offset) as usize);
            file.read_to_end(&mut buf).ok()?;
            // Only consume complete lines; a partially written line is picked up next tick.
            if let Some(last_nl) = buf.iter().rposition(|&b| b == b'\n') {
                for line in buf[..last_nl].split(|&b| b == b'\n') {
                    if let Ok(v) = serde_json::from_slice::<Value>(line) {
                        Self::ingest(t, &v);
                    }
                }
                t.offset += last_nl as u64 + 1;
            }
        }
        if t.info.session_id.is_empty() {
            t.info.session_id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();
        }
        t.info.last_update_secs = age_secs;
        t.info.pending_tool =
            t.last_role.as_deref() == Some("assistant") && t.last_stop_reason.as_deref() == Some("tool_use");

        let status = if age_secs > 600 {
            AgentStatus::Idle
        } else {
            match (t.last_role.as_deref(), t.last_stop_reason.as_deref()) {
                // Claude finished its turn and is waiting on the human.
                (Some("assistant"), Some("end_turn")) => AgentStatus::Waiting,
                (Some("assistant"), Some("tool_use")) | (Some("user"), _) => AgentStatus::Working,
                (Some("assistant"), None) if age_secs < 30 => AgentStatus::Working,
                _ if age_secs < 15 => AgentStatus::Working,
                _ => AgentStatus::Waiting,
            }
        };
        Some((t.info.clone(), status))
    }

    fn ingest(t: &mut Transcript, v: &Value) {
        let Some(kind) = v.get("type").and_then(Value::as_str) else {
            return;
        };
        if kind != "user" && kind != "assistant" {
            return;
        }
        // Sidechain lines come from subagents; count their tokens but don't let them set status.
        let sidechain = v.get("isSidechain").and_then(Value::as_bool).unwrap_or(false);
        if let Some(id) = v.get("sessionId").and_then(Value::as_str) {
            t.info.session_id = id.to_string();
        }
        if let Some(b) = v.get("gitBranch").and_then(Value::as_str) {
            if !b.is_empty() {
                t.info.git_branch = Some(b.to_string());
            }
        }
        let Some(msg) = v.get("message") else { return };
        t.info.message_count += 1;

        if kind == "assistant" {
            if let Some(m) = msg.get("model").and_then(Value::as_str) {
                if !m.starts_with('<') {
                    t.info.model = Some(m.to_string());
                }
            }
            if let Some(u) = msg.get("usage") {
                let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
                t.info.input_tokens += n("input_tokens");
                t.info.output_tokens += n("output_tokens");
                t.info.cache_read_tokens += n("cache_read_input_tokens");
                t.info.cache_write_tokens += n("cache_creation_input_tokens");
            }
            if let Some(blocks) = msg.get("content").and_then(Value::as_array) {
                for b in blocks {
                    match b.get("type").and_then(Value::as_str) {
                        Some("tool_use") => {
                            let name = b.get("name").and_then(Value::as_str).unwrap_or("tool");
                            let input = b.get("input").cloned().unwrap_or(Value::Null);
                            t.info.current_activity = Some(describe_tool_use(name, &input));
                        }
                        Some("text") => {
                            if let Some(text) = b.get("text").and_then(Value::as_str) {
                                if !text.trim().is_empty() {
                                    t.info.current_activity = Some(truncate(text, 90));
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            if !sidechain {
                t.last_role = Some("assistant".into());
                t.last_stop_reason = msg
                    .get("stop_reason")
                    .and_then(Value::as_str)
                    .map(str::to_string);
            }
        } else {
            // A user line is either a real prompt or a tool_result being fed back.
            let prompt = match msg.get("content") {
                Some(Value::String(s)) => Some(s.as_str()),
                Some(Value::Array(blocks)) => blocks
                    .iter()
                    .find(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                    .and_then(|b| b.get("text").and_then(Value::as_str)),
                _ => None,
            };
            if !sidechain {
                if let Some(p) = prompt {
                    // Skip slash-command and hook plumbing Claude Code writes as user lines.
                    if !p.starts_with('<') && !p.trim().is_empty() {
                        t.info.last_prompt = Some(truncate(p, 140));
                        t.info.current_activity = Some("Thinking…".into());
                    }
                }
                t.last_role = Some("user".into());
                t.last_stop_reason = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_dir_matches_claude_code() {
        assert_eq!(
            project_dir_name("/Users/me/Web Projects/my.app"),
            "-Users-me-Web-Projects-my-app"
        );
    }
}
