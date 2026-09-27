// Mirrors src-tauri/src/model.rs.

export type ProcKind = "agent" | "app" | "background";
export type AgentStatus = "working" | "waiting" | "idle" | "unknown";

export interface SystemStats {
  hostName: string;
  osVersion: string;
  cpuUsage: number;
  cpuCount: number;
  memoryUsed: number;
  memoryTotal: number;
  uptime: number;
  processCount: number;
}

export interface Proc {
  pid: number;
  ppid: number | null;
  name: string;
  command: string;
  exe: string | null;
  cwd: string | null;
  user: string | null;
  cpu: number;
  memory: number;
  startTime: number;
  runTime: number;
  kind: ProcKind;
  app: string | null;
  agentPid: number | null;
  ports: number[];
}

export interface SessionInfo {
  sessionId: string;
  model: string | null;
  gitBranch: string | null;
  lastPrompt: string | null;
  currentActivity: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  messageCount: number;
  lastUpdateSecs: number;
  pendingTool: boolean;
}

export interface Agent {
  pid: number;
  kind: string;
  status: AgentStatus;
  cwd: string | null;
  project: string | null;
  cpu: number;
  memory: number;
  runTime: number;
  taskPids: number[];
  session: SessionInfo | null;
  /** Why the agent needs you, when status is "waiting". */
  attention: string | null;
}

export interface NowPlaying {
  player: string;
  title: string;
  artist: string;
  album: string;
  playing: boolean;
  positionSecs: number;
  durationSecs: number;
}

export interface Snapshot {
  system: SystemStats;
  processes: Proc[];
  agents: Agent[];
  music: NowPlaying | null;
  timestamp: number;
}

/** A running .app, built by grouping its processes. */
export interface AppGroup {
  name: string;
  processes: Proc[];
  /** The bundle's main process (the one whose parent is outside the app). */
  rootPid: number;
  cpu: number;
  memory: number;
  ports: number[];
}

export type Selection =
  | { type: "system" }
  | { type: "agent"; pid: number }
  | { type: "app"; name: string }
  | { type: "process"; pid: number }
  | { type: "music" };
