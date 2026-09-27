import { useMemo, useState } from "react";
import "./App.css";
import type { Selection } from "./types";
import { useSnapshot } from "./lib/useSnapshot";
import { useNotifications } from "./lib/useNotifications";
import { groupApps } from "./lib/groups";
import { Galaxy } from "./galaxy/Galaxy";
import { AgentDock, Legend, TopBar, type View } from "./ui/Hud";
import { Inspector } from "./ui/Inspector";
import { ListView } from "./ui/ListView";

export default function App() {
  const snapshot = useSnapshot();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("galaxy");
  const [notify, setNotify] = useNotifications();
  const apps = useMemo(() => (snapshot ? groupApps(snapshot.processes) : []), [snapshot]);

  // A process inside an app or agent has no body of its own, so the camera flies to its owner.
  const focus = useMemo(() => {
    if (!selection || !snapshot) return null;
    if (selection.type !== "process") return selection;
    const p = snapshot.processes.find((x) => x.pid === selection.pid);
    if (p?.kind === "agent" && p.agentPid != null) return { type: "agent", pid: p.agentPid } as const;
    if (p?.kind === "app" && p.app) return { type: "app", name: p.app } as const;
    return selection;
  }, [selection, snapshot]);

  if (!snapshot) {
    return (
      <div className="loading">
        <span className="brand-mark big" />
        <p>Mapping your galaxy…</p>
      </div>
    );
  }

  return (
    <main className="app">
      <div className="stage">
        <Galaxy snapshot={snapshot} apps={apps} selection={selection} focus={focus} query={query} onSelect={setSelection} />
      </div>
      <TopBar snapshot={snapshot} apps={apps} query={query} onQuery={setQuery} view={view} onView={setView} notify={notify} onNotify={setNotify} />
      {view === "list" && <ListView snapshot={snapshot} query={query} selection={selection} onSelect={setSelection} />}
      {view === "galaxy" && (
        <>
          <AgentDock agents={snapshot.agents} selection={selection} onSelect={setSelection} />
          <Legend />
        </>
      )}
      {selection && <Inspector snapshot={snapshot} apps={apps} selection={selection} onSelect={setSelection} />}
    </main>
  );
}
