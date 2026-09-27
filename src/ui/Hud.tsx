import type { Agent, AppGroup, Selection, Snapshot } from "../types";
import { formatBytes, formatCount, formatCpu, formatDuration } from "../lib/format";
import { STATUS_COLOR, STATUS_LABEL } from "../galaxy/shared";
import { isDemo } from "../lib/useSnapshot";

export type View = "galaxy" | "list";

function Meter({ label, value, detail }: { label: string; value: number; detail: string }) {
  const pct = Math.min(Math.max(value, 0), 1) * 100;
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <span className="mono">{detail}</span>
      </div>
      <div className="meter-bar">
        <i style={{ width: `${pct}%`, background: pct > 85 ? "var(--hot)" : undefined }} />
      </div>
    </div>
  );
}

function Bell({ on }: { on: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      {!on && <path d="M3 3l18 18" />}
    </svg>
  );
}

interface TopBarProps {
  snapshot: Snapshot;
  apps: AppGroup[];
  query: string;
  onQuery: (q: string) => void;
  view: View;
  onView: (v: View) => void;
  notify: boolean;
  onNotify: (on: boolean) => void;
}

export function TopBar({ snapshot, apps, query, onQuery, view, onView, notify, onNotify }: TopBarProps) {
  const { system } = snapshot;
  const waiting = snapshot.agents.filter((a) => a.status === "waiting").length;
  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <span className="brand-mark" />
        Sombrero Galaxy
        {isDemo && <span className="pill">demo data</span>}
      </div>
      <div className="stats" data-tauri-drag-region>
        <Meter label="CPU" value={system.cpuUsage / 100} detail={formatCpu(system.cpuUsage)} />
        <Meter
          label="Memory"
          value={system.memoryUsed / system.memoryTotal}
          detail={`${formatBytes(system.memoryUsed)} / ${formatBytes(system.memoryTotal)}`}
        />
        <div className="counts" data-tauri-drag-region>
          <span><b>{snapshot.agents.length}</b> agents{waiting > 0 && <em className="needs-you"> · {waiting} need you</em>}</span>
          <span><b>{apps.length}</b> apps</span>
          <span><b>{system.processCount}</b> processes</span>
        </div>
      </div>
      <div className="controls">
        <button
          className={`icon-btn ${notify ? "on" : ""}`}
          onClick={() => onNotify(!notify)}
          title={notify ? "Notifying you when an agent needs you. Click to mute." : "Notifications muted. Click to turn on."}
          aria-label={notify ? "Mute agent notifications" : "Turn on agent notifications"}
          aria-pressed={notify}
        >
          <Bell on={notify} />
        </button>
        <input
          className="search"
          placeholder="Search name, pid, port…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          spellCheck={false}
        />
        <div className="segmented">
          <button className={view === "galaxy" ? "on" : ""} onClick={() => onView("galaxy")}>Galaxy</button>
          <button className={view === "list" ? "on" : ""} onClick={() => onView("list")}>List</button>
        </div>
      </div>
    </header>
  );
}

export function AgentDock({ agents, selection, onSelect }: { agents: Agent[]; selection: Selection | null; onSelect: (s: Selection) => void }) {
  return (
    <aside className="dock panel">
      <h3>Agents</h3>
      {agents.length === 0 && (
        <p className="muted small">
          No AI agents running. Start Claude Code, Codex, Gemini CLI, Aider… and they'll appear as stars near the core.
        </p>
      )}
      {agents.map((a) => {
        const active = selection?.type === "agent" && selection.pid === a.pid;
        const tokens = a.session ? a.session.inputTokens + a.session.outputTokens + a.session.cacheReadTokens + a.session.cacheWriteTokens : 0;
        return (
          <button key={a.pid} className={`agent-card ${active ? "active" : ""}`} onClick={() => onSelect({ type: "agent", pid: a.pid })}>
            <div className="agent-card-head">
              <span className={`dot ${a.status}`} style={{ background: STATUS_COLOR[a.status] }} />
              <b>{a.kind}</b>
              <span className="muted">{a.project ?? `pid ${a.pid}`}</span>
            </div>
            {a.status === "waiting" && a.attention ? (
              <div className="agent-activity attention">{a.attention}</div>
            ) : (
              a.session?.currentActivity && <div className="agent-activity">{a.session.currentActivity}</div>
            )}
            <div className="agent-meta">
              <span style={{ color: STATUS_COLOR[a.status] }}>{STATUS_LABEL[a.status]}</span>
              <span>{formatDuration(a.runTime)}</span>
              {tokens > 0 && <span>{formatCount(tokens)} tok</span>}
              {a.taskPids.length > 0 && <span>{a.taskPids.length} tasks</span>}
            </div>
          </button>
        );
      })}
    </aside>
  );
}

export function Legend() {
  return (
    <div className="legend panel">
      <div><i className="swatch sw-core" /> Your Mac</div>
      <div><i className="swatch sw-agent" /> AI agents</div>
      <div><i className="swatch sw-app" /> Apps · moons = helpers</div>
      <div><i className="swatch sw-dust" /> Background processes</div>
      <div><i className="swatch sw-hot" /> Busy (CPU)</div>
      <div><i className="swatch sw-port" /> Listening on a port</div>
      <div><i className="swatch sw-music" /> Music</div>
      <p className="muted small">Drag to orbit · scroll to zoom · click anything</p>
    </div>
  );
}
