import { useMemo, useState } from "react";
import type { Proc, Selection, Snapshot } from "../types";
import { formatBytes, formatCpu, formatDuration } from "../lib/format";
import { matches } from "../lib/groups";

type SortKey = "name" | "pid" | "cpu" | "memory" | "runTime" | "kind";

const KIND_LABEL: Record<Proc["kind"], string> = { agent: "Agent", app: "App", background: "Background" };

/** Activity-Monitor-style table of every process. */
export function ListView({ snapshot, query, selection, onSelect }: { snapshot: Snapshot; query: string; selection: Selection | null; onSelect: (s: Selection) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "cpu", desc: true });

  const rows = useMemo(() => {
    const list = snapshot.processes.filter((p) => matches(query, p.name, p.pid, p.command, p.app, ...p.ports));
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) => {
      const x = a[sort.key] ?? "";
      const y = b[sort.key] ?? "";
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [snapshot.processes, query, sort]);

  const header = (key: SortKey, label: string, numeric = false) => (
    <th className={numeric ? "num" : ""} onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : numeric }))}>
      {label}
      {sort.key === key && <span className="sort">{sort.desc ? " ↓" : " ↑"}</span>}
    </th>
  );

  const selectedPid = selection?.type === "process" ? selection.pid : null;
  return (
    <div className="list-view">
      <table>
        <thead>
          <tr>
            {header("name", "Name")}
            {header("kind", "Type")}
            {header("pid", "PID", true)}
            {header("cpu", "CPU", true)}
            {header("memory", "Memory", true)}
            {header("runTime", "Running", true)}
            <th>Ports</th>
            <th>User</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.pid} className={p.pid === selectedPid ? "selected" : ""} onClick={() => onSelect({ type: "process", pid: p.pid })}>
              <td>
                <span className={`kind-dot kind-${p.kind}`} />
                {p.name}
                {p.app && p.app !== p.name && <span className="muted"> · {p.app}</span>}
              </td>
              <td className="muted">{KIND_LABEL[p.kind]}</td>
              <td className="num mono">{p.pid}</td>
              <td className={`num mono ${p.cpu > 50 ? "hot" : ""}`}>{formatCpu(p.cpu)}</td>
              <td className="num mono">{formatBytes(p.memory)}</td>
              <td className="num mono">{formatDuration(p.runTime)}</td>
              <td className="mono">{p.ports.map((x) => `:${x}`).join(" ")}</td>
              <td className="muted">{p.user}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="muted empty">Nothing matches “{query}”.</p>}
    </div>
  );
}
