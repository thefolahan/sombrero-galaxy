import { useEffect, useState } from "react";
import type { Agent, AppGroup, Proc, Selection, Snapshot } from "../types";
import { formatBytes, formatClock, formatCount, formatCpu, formatDuration } from "../lib/format";
import { STATUS_COLOR, STATUS_LABEL } from "../galaxy/shared";
import { killProcess, openPort } from "./actions";

interface Props {
  snapshot: Snapshot;
  apps: AppGroup[];
  selection: Selection;
  onSelect: (s: Selection | null) => void;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <span className="k">{k}</span>
      <span className="v">{children}</span>
    </div>
  );
}

/** Stop / force-kill buttons that ask for a second click before acting. */
function StopButtons({ pid, label = "Stop" }: { pid: number; label?: string }) {
  const [armed, setArmed] = useState<"term" | "kill" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    setArmed(null);
    setMessage(null);
  }, [pid]);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(id);
  }, [armed]);

  const run = async (force: boolean) => {
    const mode = force ? "kill" : "term";
    if (armed !== mode) return setArmed(mode);
    setArmed(null);
    try {
      await killProcess(pid, force);
      setMessage(force ? `Killed ${pid}.` : `Sent stop signal to ${pid}.`);
    } catch (e) {
      setMessage(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <div className="actions">
      <button className="btn" onClick={() => run(false)}>{armed === "term" ? `Confirm ${label.toLowerCase()}?` : label}</button>
      <button className="btn danger" onClick={() => run(true)}>{armed === "kill" ? "Confirm force kill?" : "Force kill"}</button>
      {message && <p className="small muted">{message}</p>}
    </div>
  );
}

function Ports({ ports }: { ports: number[] }) {
  if (!ports.length) return null;
  return (
    <Row k="Ports">
      {ports.map((p) => (
        <button key={p} className="chip" onClick={() => openPort(p)} title={`Open http://localhost:${p}`}>:{p} ↗</button>
      ))}
    </Row>
  );
}

function ProcList({ procs, onSelect }: { procs: Proc[]; onSelect: (s: Selection) => void }) {
  return (
    <ul className="proc-list">
      {procs.slice(0, 40).map((p) => (
        <li key={p.pid}>
          <button onClick={() => onSelect({ type: "process", pid: p.pid })}>
            <span className="name">{p.name}</span>
            <span className="mono">{formatCpu(p.cpu)}</span>
            <span className="mono">{formatBytes(p.memory)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function AgentView({ agent, snapshot, onSelect }: { agent: Agent; snapshot: Snapshot; onSelect: (s: Selection) => void }) {
  const s = agent.session;
  const tasks = snapshot.processes.filter((p) => agent.taskPids.includes(p.pid));
  return (
    <>
      <div className="inspector-head">
        <span className="kicker" style={{ color: STATUS_COLOR[agent.status] }}>● {STATUS_LABEL[agent.status]}</span>
        <h2>{agent.kind}</h2>
        <p className="muted">{agent.project ?? "unknown project"}</p>
      </div>
      {agent.status === "waiting" && agent.attention && (
        <div className="callout attention">
          <span className="kicker">Needs you</span>
          {agent.attention}
        </div>
      )}
      {s?.currentActivity && (
        <div className="callout">
          <span className="kicker">Now</span>
          {s.currentActivity}
        </div>
      )}
      {s?.lastPrompt && (
        <div className="callout subtle">
          <span className="kicker">Last prompt</span>
          {s.lastPrompt}
        </div>
      )}
      <div className="rows">
        {s?.model && <Row k="Model">{s.model}</Row>}
        {s?.gitBranch && <Row k="Branch">{s.gitBranch}</Row>}
        {s && (
          <>
            <Row k="Tokens">
              {formatCount(s.inputTokens + s.cacheReadTokens + s.cacheWriteTokens)} in · {formatCount(s.outputTokens)} out
            </Row>
            <Row k="Cache">{formatCount(s.cacheReadTokens)} read · {formatCount(s.cacheWriteTokens)} written</Row>
            <Row k="Messages">{s.messageCount}</Row>
            <Row k="Last write">{formatDuration(s.lastUpdateSecs)} ago</Row>
          </>
        )}
        <Row k="PID">{agent.pid}</Row>
        <Row k="Running">{formatDuration(agent.runTime)}</Row>
        <Row k="CPU">{formatCpu(agent.cpu)} <span className="muted">(incl. tasks)</span></Row>
        <Row k="Memory">{formatBytes(agent.memory)}</Row>
        {agent.cwd && <Row k="Folder"><span className="mono wrap">{agent.cwd}</span></Row>}
        {!s && agent.kind === "Claude Code" && (
          <p className="small muted">No transcript yet. It shows up after the first message.</p>
        )}
      </div>
      {tasks.length > 0 && (
        <>
          <h4>Running tasks</h4>
          <ProcList procs={tasks} onSelect={onSelect} />
        </>
      )}
      <StopButtons pid={agent.pid} />
    </>
  );
}

function AppView({ app, onSelect }: { app: AppGroup; onSelect: (s: Selection) => void }) {
  return (
    <>
      <div className="inspector-head">
        <span className="kicker">App</span>
        <h2>{app.name}</h2>
        <p className="muted">{app.processes.length} process{app.processes.length === 1 ? "" : "es"}</p>
      </div>
      <div className="rows">
        <Row k="CPU">{formatCpu(app.cpu)}</Row>
        <Row k="Memory">{formatBytes(app.memory)}</Row>
        <Row k="Main PID">{app.rootPid}</Row>
        <Ports ports={app.ports} />
      </div>
      <h4>Processes</h4>
      <ProcList procs={app.processes} onSelect={onSelect} />
      <StopButtons pid={app.rootPid} label="Quit" />
    </>
  );
}

function ProcessView({ proc, snapshot, onSelect }: { proc: Proc; snapshot: Snapshot; onSelect: (s: Selection) => void }) {
  const parent = proc.ppid != null ? snapshot.processes.find((p) => p.pid === proc.ppid) : undefined;
  const children = snapshot.processes.filter((p) => p.ppid === proc.pid);
  return (
    <>
      <div className="inspector-head">
        <span className="kicker">{proc.kind === "agent" ? "Agent task" : proc.app ? `Part of ${proc.app}` : "Background process"}</span>
        <h2>{proc.name}</h2>
        <p className="muted">pid {proc.pid}{proc.user && ` · ${proc.user}`}</p>
      </div>
      <div className="rows">
        <Row k="CPU">{formatCpu(proc.cpu)}</Row>
        <Row k="Memory">{formatBytes(proc.memory)}</Row>
        <Row k="Running">{formatDuration(proc.runTime)}</Row>
        {parent && (
          <Row k="Parent">
            <button className="chip" onClick={() => onSelect({ type: "process", pid: parent.pid })}>{parent.name} ({parent.pid})</button>
          </Row>
        )}
        {proc.app && (
          <Row k="App"><button className="chip" onClick={() => onSelect({ type: "app", name: proc.app! })}>{proc.app}</button></Row>
        )}
        {proc.agentPid != null && proc.agentPid !== proc.pid && (
          <Row k="Agent"><button className="chip" onClick={() => onSelect({ type: "agent", pid: proc.agentPid! })}>pid {proc.agentPid}</button></Row>
        )}
        <Ports ports={proc.ports} />
        {proc.command && <Row k="Command"><span className="mono wrap">{proc.command}</span></Row>}
        {proc.cwd && <Row k="Folder"><span className="mono wrap">{proc.cwd}</span></Row>}
      </div>
      {children.length > 0 && (
        <>
          <h4>Children</h4>
          <ProcList procs={children} onSelect={onSelect} />
        </>
      )}
      <StopButtons pid={proc.pid} />
    </>
  );
}

export function Inspector({ snapshot, apps, selection, onSelect }: Props) {
  let body: React.ReactNode = null;
  switch (selection.type) {
    case "system": {
      const s = snapshot.system;
      body = (
        <>
          <div className="inspector-head">
            <span className="kicker">Core</span>
            <h2>{s.hostName}</h2>
            <p className="muted">{s.osVersion}</p>
          </div>
          <div className="rows">
            <Row k="CPU">{formatCpu(s.cpuUsage)} across {s.cpuCount} cores</Row>
            <Row k="Memory">{formatBytes(s.memoryUsed)} / {formatBytes(s.memoryTotal)}</Row>
            <Row k="Uptime">{formatDuration(s.uptime)}</Row>
            <Row k="Processes">{s.processCount}</Row>
            <Row k="Apps">{apps.length}</Row>
            <Row k="Agents">{snapshot.agents.length}</Row>
          </div>
          <h4>Busiest right now</h4>
          <ProcList procs={[...snapshot.processes].sort((a, b) => b.cpu - a.cpu)} onSelect={onSelect} />
        </>
      );
      break;
    }
    case "agent": {
      const agent = snapshot.agents.find((a) => a.pid === selection.pid);
      body = agent ? <AgentView agent={agent} snapshot={snapshot} onSelect={onSelect} /> : null;
      break;
    }
    case "app": {
      const app = apps.find((a) => a.name === selection.name);
      body = app ? <AppView app={app} onSelect={onSelect} /> : null;
      break;
    }
    case "process": {
      const proc = snapshot.processes.find((p) => p.pid === selection.pid);
      body = proc ? <ProcessView proc={proc} snapshot={snapshot} onSelect={onSelect} /> : null;
      break;
    }
    case "music": {
      const m = snapshot.music;
      body = m ? (
        <>
          <div className="inspector-head">
            <span className="kicker" style={{ color: "#e08bff" }}>{m.playing ? "♪ Now playing" : "Paused"} · {m.player}</span>
            <h2>{m.title}</h2>
            <p className="muted">{m.artist}</p>
          </div>
          <div className="rows">
            <Row k="Album">{m.album}</Row>
            <Row k="Position">{formatClock(m.positionSecs)} / {formatClock(m.durationSecs)}</Row>
          </div>
        </>
      ) : null;
      break;
    }
  }

  return (
    <aside className="inspector panel">
      <button className="close" onClick={() => onSelect(null)} aria-label="Close">×</button>
      {body ?? <p className="muted">That one has left the galaxy (it's no longer running).</p>}
    </aside>
  );
}
