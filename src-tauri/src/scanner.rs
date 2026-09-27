//! Samples every process on the machine, classifies it (agent / app / background)
//! and assembles a [`Snapshot`].

use crate::claude::ClaudeSessions;
use crate::model::*;
use crate::{music, ports};
use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind, Users};

const MAX_COMMAND_LEN: usize = 400;
/// How long a tool call may sit unanswered, with nothing running, before we assume a permission prompt.
const PERMISSION_STALL_SECS: u64 = 20;

/// CLI coding agents, matched on process name or on a fragment of the command line.
const CLI_AGENTS: &[(&str, &[&str], &[&str])] = &[
    // (display name, exact process names, command-line fragments)
    ("Claude Code", &["claude"], &["@anthropic-ai/claude-code", "claude-code/cli"]),
    ("Codex", &["codex"], &["@openai/codex"]),
    ("Gemini CLI", &["gemini"], &["@google/gemini-cli"]),
    ("Aider", &["aider"], &["bin/aider"]),
    ("OpenCode", &["opencode"], &["opencode-ai"]),
    ("Goose", &["goose"], &[]),
    ("Amp", &["amp"], &["@sourcegraph/amp"]),
    ("Copilot CLI", &[], &["@github/copilot"]),
    ("Cursor Agent", &["cursor-agent"], &[]),
];

/// Helper modes of agent binaries that aren't themselves agents.
const NOT_AGENTS: &[&str] = &["--chrome-native-host", " mcp serve", "--version"];

fn detect_cli_agent(name: &str, command: &str) -> Option<&'static str> {
    if NOT_AGENTS.iter().any(|f| command.contains(f)) {
        return None;
    }
    let name = name.to_ascii_lowercase();
    CLI_AGENTS.iter().find_map(|(label, names, fragments)| {
        let hit = names.contains(&name.as_str()) || fragments.iter().any(|f| command.contains(f));
        hit.then_some(*label)
    })
}

/// The user-facing .app a binary belongs to, e.g. "/Applications/Slack.app/Contents/..." -> "Slack".
/// Bundles buried in /System/Library are treated as background services, not apps.
fn app_bundle(exe: &str) -> Option<String> {
    let home_apps = std::env::var("HOME").map(|h| format!("{h}/Applications/")).ok();
    let user_facing = exe.starts_with("/Applications/")
        || exe.starts_with("/System/Applications/")
        || exe.starts_with("/System/Library/CoreServices/Finder.app/")
        || home_apps.is_some_and(|p| exe.starts_with(&p));
    if !user_facing {
        return None;
    }
    let end = exe.find(".app/")?;
    let start = exe[..end].rfind('/').map_or(0, |i| i + 1);
    Some(exe[start..end].to_string())
}

/// Safari web apps ("Add to Dock") all run one shared system binary and name the site's
/// bundle in an argument: `Web App --bundlepath ~/Applications/Spotify.app`. Returns "Spotify".
fn web_app_bundle(exe: &str, args: &[std::ffi::OsString]) -> Option<String> {
    if !exe.ends_with("/Web App.app/Contents/MacOS/Web App") {
        return None;
    }
    let i = args.iter().position(|a| a == "--bundlepath")?;
    let path = std::path::Path::new(args.get(i + 1)?);
    path.extension()
        .is_some_and(|x| x == "app")
        .then(|| path.file_stem()?.to_str().map(str::to_string))
        .flatten()
}

fn truncate(s: String, max: usize) -> String {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &s[..end])
}

pub struct Scanner {
    sys: System,
    users: Users,
    claude: ClaudeSessions,
    tick: u64,
    ports: HashMap<u32, Vec<u16>>,
    music: Option<NowPlaying>,
    host_name: String,
    os_version: String,
}

impl Scanner {
    pub fn new() -> Self {
        Scanner {
            sys: System::new(),
            users: Users::new_with_refreshed_list(),
            claude: ClaudeSessions::default(),
            tick: 0,
            ports: HashMap::new(),
            music: None,
            host_name: System::host_name().unwrap_or_else(|| "This Mac".into()),
            os_version: System::long_os_version().unwrap_or_default(),
        }
    }

    pub fn sample(&mut self) -> Snapshot {
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory();
        self.sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing()
                .with_cpu()
                .with_memory()
                .with_cmd(UpdateKind::OnlyIfNotSet)
                .with_exe(UpdateKind::OnlyIfNotSet)
                .with_cwd(UpdateKind::OnlyIfNotSet)
                .with_user(UpdateKind::OnlyIfNotSet),
        );

        // lsof and osascript are comparatively slow, so run them less often.
        if self.tick % 4 == 0 {
            self.ports = ports::listening_ports();
        }
        let mut procs = self.collect_processes();

        if self.tick % 2 == 0 {
            let apps: HashSet<&str> = procs.iter().filter_map(|p| p.app.as_deref()).collect();
            let apps: Vec<&str> = apps.into_iter().collect();
            self.music = music::now_playing(&apps);
        }
        self.tick += 1;

        let agents = self.build_agents(&mut procs);

        Snapshot {
            system: SystemStats {
                host_name: self.host_name.clone(),
                os_version: self.os_version.clone(),
                cpu_usage: self.sys.global_cpu_usage(),
                cpu_count: self.sys.cpus().len(),
                memory_used: self.sys.used_memory(),
                memory_total: self.sys.total_memory(),
                uptime: System::uptime(),
                process_count: procs.len(),
            },
            processes: procs,
            agents,
            music: self.music.clone(),
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
        }
    }

    fn collect_processes(&self) -> Vec<Proc> {
        let own_pid = std::process::id();
        self.sys
            .processes()
            .values()
            // Skip kernel-ish zero-memory entries and threads.
            .filter(|p| p.thread_kind().is_none() && p.pid().as_u32() != 0)
            .map(|p| {
                let pid = p.pid().as_u32();
                let exe = p.exe().map(|e| e.to_string_lossy().into_owned());
                let command = p
                    .cmd()
                    .iter()
                    .map(|a| a.to_string_lossy())
                    .collect::<Vec<_>>()
                    .join(" ");
                let app = exe
                    .as_deref()
                    .and_then(|e| app_bundle(e).or_else(|| web_app_bundle(e, p.cmd())));
                Proc {
                    pid,
                    ppid: p.parent().map(Pid::as_u32),
                    name: p.name().to_string_lossy().into_owned(),
                    command: truncate(command, MAX_COMMAND_LEN),
                    exe,
                    cwd: p.cwd().map(|c| c.to_string_lossy().into_owned()),
                    user: p
                        .user_id()
                        .and_then(|u| self.users.get_user_by_id(u))
                        .map(|u| u.name().to_string()),
                    cpu: p.cpu_usage(),
                    memory: p.memory(),
                    start_time: p.start_time(),
                    run_time: p.run_time(),
                    kind: if app.is_some() { ProcKind::App } else { ProcKind::Background },
                    app: if pid == own_pid { Some("Sombrero Galaxy".into()) } else { app },
                    agent_pid: None,
                    ports: self.ports.get(&pid).cloned().unwrap_or_default(),
                }
            })
            .collect()
    }

    /// Finds agent processes, tags their descendants as agent tasks, and attaches
    /// Claude Code session info.
    fn build_agents(&mut self, procs: &mut [Proc]) -> Vec<Agent> {
        let index: HashMap<u32, usize> = procs.iter().enumerate().map(|(i, p)| (p.pid, i)).collect();

        let direct: HashMap<u32, &'static str> = procs
            .iter()
            .filter(|p| p.app.is_none())
            .filter_map(|p| detect_cli_agent(&p.name, &p.command).map(|k| (p.pid, k)))
            .collect();

        // Walk each process's ancestry; the outermost agent ancestor owns it. This also
        // stops a wrapper (e.g. `node codex.js` -> native `codex`) from counting twice.
        let owner_of = |pid: u32| -> Option<u32> {
            let mut owner = None;
            let mut cur = Some(pid);
            for _ in 0..64 {
                let Some(c) = cur else { break };
                if direct.contains_key(&c) {
                    owner = Some(c);
                }
                cur = index.get(&c).and_then(|&i| procs[i].ppid);
            }
            owner
        };
        let owners: Vec<Option<u32>> = procs.iter().map(|p| owner_of(p.pid)).collect();

        let mut tasks: HashMap<u32, Vec<u32>> = HashMap::new();
        for (p, owner) in procs.iter_mut().zip(owners) {
            if let Some(o) = owner {
                p.kind = ProcKind::Agent;
                p.agent_pid = Some(o);
                if o != p.pid {
                    tasks.entry(o).or_default().push(p.pid);
                }
            }
        }

        let roots: Vec<&Proc> = procs
            .iter()
            .filter(|p| p.agent_pid == Some(p.pid))
            .collect();

        let claude_cwds: Vec<(u32, String, u64)> = roots
            .iter()
            .filter(|p| direct.get(&p.pid) == Some(&"Claude Code"))
            .filter_map(|p| Some((p.pid, p.cwd.clone()?, p.start_time)))
            .collect();
        let mut sessions = self.claude.resolve(&claude_cwds);

        let mut agents: Vec<Agent> = roots
            .into_iter()
            .map(|p| {
                let task_pids = tasks.remove(&p.pid).unwrap_or_default();
                // Aggregate the agent's whole process tree so a busy test run shows up as load.
                let (cpu, memory) = task_pids
                    .iter()
                    .filter_map(|t| index.get(t).map(|&i| &procs[i]))
                    .fold((p.cpu, p.memory), |(c, m), t| (c + t.cpu, m + t.memory));
                let (session, mut status) = match sessions.remove(&p.pid) {
                    Some((s, st)) => (Some(s), st),
                    // No transcript to go on: infer from activity.
                    None if cpu > 5.0 => (None, AgentStatus::Working),
                    None => (None, AgentStatus::Unknown),
                };
                let mut attention = None;
                if let Some(s) = &session {
                    // A tool call that has sat unanswered with nothing running under it is
                    // almost always Claude Code waiting on a permission prompt.
                    let stalled = s.pending_tool
                        && s.last_update_secs >= PERMISSION_STALL_SECS
                        && task_pids.is_empty()
                        && cpu < 3.0;
                    if stalled && status != AgentStatus::Idle {
                        status = AgentStatus::Waiting;
                        attention = Some(match &s.current_activity {
                            Some(a) => format!("Wants permission: {a}"),
                            None => "Wants permission to use a tool".into(),
                        });
                    } else if status == AgentStatus::Waiting {
                        attention = Some("Finished, waiting for your reply".into());
                    }
                }
                Agent {
                    pid: p.pid,
                    kind: direct[&p.pid].to_string(),
                    status,
                    project: p.cwd.as_deref().and_then(|c| {
                        std::path::Path::new(c)
                            .file_name()
                            .map(|f| f.to_string_lossy().into_owned())
                    }),
                    cwd: p.cwd.clone(),
                    cpu,
                    memory,
                    run_time: p.run_time,
                    task_pids,
                    session,
                    attention,
                }
            })
            .collect();
        agents.sort_by_key(|a| a.pid);
        agents
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_outermost_app_bundle() {
        assert_eq!(
            app_bundle("/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/x"),
            Some("Google Chrome".into())
        );
        assert_eq!(app_bundle("/System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter"), None);
        assert_eq!(app_bundle("/usr/bin/zsh"), None);
    }

    #[test]
    fn finds_safari_web_apps() {
        let exe = "/System/Volumes/Preboot/Cryptexes/App/System/Library/CoreServices/Web App.app/Contents/MacOS/Web App";
        let args: Vec<std::ffi::OsString> = [exe, "--bundlepath", "/Users/me/Applications/Spotify.app", "--sandboxextension", "abc"]
            .iter()
            .map(Into::into)
            .collect();
        assert_eq!(web_app_bundle(exe, &args), Some("Spotify".into()));
        assert_eq!(web_app_bundle("/usr/bin/zsh", &args), None);
    }

    #[test]
    fn detects_agents() {
        assert_eq!(detect_cli_agent("claude", ""), Some("Claude Code"));
        assert_eq!(
            detect_cli_agent("node", "node /opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js"),
            Some("Codex")
        );
        assert_eq!(detect_cli_agent("zsh", "-zsh"), None);
        assert_eq!(detect_cli_agent("claude", "/Users/me/.local/bin/claude --chrome-native-host"), None);
    }
}

#[cfg(test)]
mod live {
    /// `cargo test live_snapshot -- --ignored --nocapture` prints what the scanner sees.
    #[test]
    #[ignore]
    fn live_snapshot() {
        let mut s = super::Scanner::new();
        s.sample();
        std::thread::sleep(std::time::Duration::from_millis(800));
        let snap = s.sample();
        println!("{}", serde_json::to_string_pretty(&snap.agents).unwrap());
        let apps: std::collections::BTreeSet<_> = snap.processes.iter().filter_map(|p| p.app.clone()).collect();
        println!("apps: {apps:?}");
        println!("procs: {}  with ports: {:?}", snap.processes.len(),
            snap.processes.iter().filter(|p| !p.ports.is_empty()).map(|p| (&p.name, &p.ports)).collect::<Vec<_>>());
        println!("music: {}", serde_json::to_string(&snap.music).unwrap());
    }
}
