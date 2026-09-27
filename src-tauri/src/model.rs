use serde::Serialize;

/// One full picture of the machine, pushed to the frontend on every tick.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub system: SystemStats,
    pub processes: Vec<Proc>,
    pub agents: Vec<Agent>,
    pub music: Option<NowPlaying>,
    pub timestamp: u64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub host_name: String,
    pub os_version: String,
    pub cpu_usage: f32,
    pub cpu_count: usize,
    pub memory_used: u64,
    pub memory_total: u64,
    pub uptime: u64,
    pub process_count: usize,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProcKind {
    /// A process that belongs to an AI agent (the agent itself or a task it spawned).
    Agent,
    /// Part of a macOS .app bundle.
    App,
    /// Everything else: daemons, shells, CLI tools.
    Background,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Proc {
    pub pid: u32,
    pub ppid: Option<u32>,
    pub name: String,
    pub command: String,
    pub exe: Option<String>,
    pub cwd: Option<String>,
    pub user: Option<String>,
    pub cpu: f32,
    pub memory: u64,
    pub start_time: u64,
    pub run_time: u64,
    pub kind: ProcKind,
    /// Name of the .app bundle this process lives in, e.g. "Google Chrome".
    pub app: Option<String>,
    /// PID of the agent this process belongs to (itself, or an ancestor).
    pub agent_pid: Option<u32>,
    pub ports: Vec<u16>,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Working,
    Waiting,
    Idle,
    Unknown,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub pid: u32,
    /// "Claude Code", "Codex", "Cursor", ...
    pub kind: String,
    pub status: AgentStatus,
    pub cwd: Option<String>,
    /// Last path segment of cwd, used as a display name.
    pub project: Option<String>,
    pub cpu: f32,
    pub memory: u64,
    pub run_time: u64,
    /// Child processes the agent is running right now (shells, test runners...).
    pub task_pids: Vec<u32>,
    pub session: Option<SessionInfo>,
    /// Why the agent needs the human, when `status` is Waiting.
    pub attention: Option<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session_id: String,
    pub model: Option<String>,
    pub git_branch: Option<String>,
    pub last_prompt: Option<String>,
    pub current_activity: Option<String>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub message_count: u64,
    /// Seconds since the transcript was last written.
    pub last_update_secs: u64,
    /// Claude asked to run a tool and no result has come back yet.
    pub pending_tool: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub player: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub playing: bool,
    pub position_secs: f64,
    pub duration_secs: f64,
}
