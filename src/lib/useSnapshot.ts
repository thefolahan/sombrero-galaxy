import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Snapshot } from "../types";
import { demoSnapshot } from "./demo";

/** Live machine snapshot from the Rust scanner, or demo data when run in a plain browser. */
export function useSnapshot(): Snapshot | null {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setSnapshot(demoSnapshot());
      const id = setInterval(() => setSnapshot(demoSnapshot()), 1500);
      return () => clearInterval(id);
    }
    let cancelled = false;
    invoke<Snapshot | null>("get_snapshot").then((s) => {
      if (!cancelled && s) setSnapshot((prev) => prev ?? s);
    });
    const unlisten = listen<Snapshot>("snapshot", (e) => setSnapshot(e.payload));
    return () => {
      cancelled = true;
      unlisten.then((f) => f());
    };
  }, []);

  return snapshot;
}

export const isDemo = !isTauri();
