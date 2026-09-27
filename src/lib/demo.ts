// Fake data so the UI can be developed in a browser with `pnpm dev`.
import type { Agent, Proc, Snapshot } from "../types";

const MB = 1024 * 1024;
const started = Date.now() / 1000;
let tick = 0;

const jitter = (base: number, spread: number) => Math.max(0, base + (Math.random() - 0.5) * spread);

function proc(pid: number, name: string, extra: Partial<Proc> = {}): Proc {
  return {
    pid,
    ppid: 1,
    name,
    command: name,
    exe: null,
    cwd: null,
    user: "you",
    cpu: jitter(0.3, 0.6),
    memory: (5 + ((pid * 37) % 90)) * MB,
    startTime: started - 3600,
    runTime: 3600 + tick * 1.5,
    kind: "background",
    app: null,
    agentPid: null,
    ports: [],
    ...extra,
  };
}

const APPS: [string, number, number][] = [
  // name, helper count, base cpu
  ["Google Chrome", 14, 6],
  ["Slack", 5, 2],
  ["WebStorm", 3, 9],
  ["Spotify", 4, 3],
  ["Discord", 5, 1.5],
  ["Figma", 3, 4],
  ["Finder", 1, 0.2],
  ["Messages", 1, 0.1],
  ["Cursor", 6, 3],
  ["Terminal", 1, 0.4],
  ["Notion", 3, 1],
];

const DAEMONS = [
  "WindowServer", "kernel_task", "launchd", "mds_stores", "mdworker_shared", "cloudd", "bird",
  "coreaudiod", "bluetoothd", "rapportd", "trustd", "distnoted", "cfprefsd", "syslogd", "powerd",
  "locationd", "sharingd", "nsurlsessiond", "photoanalysisd", "softwareupdated", "zsh", "zsh", "zsh",
  "postgres", "redis-server", "node", "Docker", "com.docker.backend", "ssh-agent", "gpg-agent",
];

export function demoSnapshot(): Snapshot {
  tick++;
  const processes: Proc[] = [];
  let pid = 400;

  for (const [name, helpers, cpu] of APPS) {
    const root = pid++;
    processes.push(proc(root, name, { kind: "app", app: name, cpu: jitter(cpu, cpu), memory: (120 + helpers * 40) * MB }));
    for (let i = 0; i < helpers; i++) {
      processes.push(proc(pid++, `${name} Helper`, { ppid: root, kind: "app", app: name, cpu: jitter(cpu / 3, cpu / 2) }));
    }
  }
  for (let i = 0; i < 180; i++) {
    const name = DAEMONS[i % DAEMONS.length];
    processes.push(proc(pid++, name, { cpu: name === "WindowServer" ? jitter(12, 6) : jitter(0.2, 0.5) }));
  }
  processes.push(proc(pid++, "node", { command: "node vite --port 5173", ports: [5173], cpu: jitter(2, 2) }));
  processes.push(proc(pid++, "postgres", { ports: [5432] }));

  const agents: Agent[] = [];
  const addAgent = (kind: string, project: string, status: Agent["status"], activity: string, prompt: string, tasks: string[]) => {
    const root = pid++;
    const cwd = `/Users/you/code/${project}`;
    processes.push(proc(root, kind === "Claude Code" ? "claude" : kind.toLowerCase(), {
      kind: "agent", agentPid: root, cwd, cpu: status === "working" ? jitter(14, 10) : 0.4, memory: 380 * MB,
    }));
    const taskPids = tasks.map((t) => {
      const p = pid++;
      processes.push(proc(p, t.split(" ")[0], { command: t, ppid: root, kind: "agent", agentPid: root, cwd, cpu: jitter(20, 30) }));
      return p;
    });
    agents.push({
      pid: root, kind, status, cwd, project, cpu: jitter(14, 10), memory: 420 * MB, runTime: 1800 + tick * 1.5, taskPids,
      attention: status === "waiting" ? "Finished, waiting for your reply" : null,
      session: kind === "Claude Code" ? {
        sessionId: `demo-${root}`, model: "claude-opus-5-5", gitBranch: "main", lastPrompt: prompt,
        currentActivity: activity, inputTokens: 1200, outputTokens: 48_000 + tick * 90,
        cacheReadTokens: 2_300_000 + tick * 4000, cacheWriteTokens: 140_000, messageCount: 80 + tick, lastUpdateSecs: 2, pendingTool: false,
      } : null,
    });
  };
  addAgent("Claude Code", "sombrero-galaxy", "working", "Edit: Galaxy.tsx", "Build a galaxy UI that shows everything running on my laptop", ["npm run build", "tsc --noEmit"]);
  addAgent("Claude Code", "api-server", "waiting", "Tests pass. Want me to open a PR?", "Fix the flaky auth test", []);
  addAgent("Codex", "landing-page", "working", "", "", ["pnpm test"]);

  const total = 32 * 1024 * MB;
  return {
    system: {
      hostName: "Demo MacBook Pro", osVersion: "macOS 27.0", cpuUsage: jitter(22, 12), cpuCount: 12,
      memoryUsed: jitter(19, 1) * 1024 * MB, memoryTotal: total, uptime: 86400 * 3 + tick * 1.5,
      processCount: processes.length,
    },
    processes,
    agents,
    music: {
      player: "Spotify", title: "Galaxy Brain", artist: "The Orbiters", album: "Dust Lanes", playing: true,
      positionSecs: (tick * 1.5) % 214, durationSecs: 214,
    },
    timestamp: Date.now(),
  };
}
