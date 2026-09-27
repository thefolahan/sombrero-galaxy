import type { AppGroup, Proc } from "../types";

/** Desktop apps that are AI assistants; drawn with an aurora ring. */
export const AI_APPS = new Set(["Cursor", "Windsurf", "Claude", "ChatGPT", "Zed", "Perplexity", "Siri AI"]);

export function groupApps(processes: Proc[]): AppGroup[] {
  const byName = new Map<string, Proc[]>();
  for (const p of processes) {
    if (p.kind !== "app" || !p.app) continue;
    const list = byName.get(p.app);
    if (list) list.push(p);
    else byName.set(p.app, [p]);
  }
  const groups: AppGroup[] = [];
  for (const [name, procs] of byName) {
    const pids = new Set(procs.map((p) => p.pid));
    const root = procs.find((p) => p.ppid == null || !pids.has(p.ppid)) ?? procs[0];
    procs.sort((a, b) => b.cpu - a.cpu || b.memory - a.memory);
    groups.push({
      name,
      processes: procs,
      rootPid: root.pid,
      cpu: procs.reduce((s, p) => s + p.cpu, 0),
      memory: procs.reduce((s, p) => s + p.memory, 0),
      ports: [...new Set(procs.flatMap((p) => p.ports))].sort((a, b) => a - b),
    });
  }
  return groups.sort((a, b) => b.memory - a.memory);
}

/** Stable 32-bit hash so every body keeps its place in the galaxy across ticks. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic value in [0, 1) derived from a key and a salt. */
export function rand(key: string, salt = 0): number {
  return (hash(`${salt}:${key}`) % 100000) / 100000;
}

export function matches(query: string, ...fields: (string | number | null | undefined)[]): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some((f) => f != null && String(f).toLowerCase().includes(q));
}
