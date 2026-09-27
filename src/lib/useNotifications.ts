import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

const KEY = "sombrero.notifications";

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

/** "Agent needs you" notifications on/off, remembered across launches and mirrored to Rust. */
export function useNotifications(): [boolean, (on: boolean) => void] {
  const [enabled, setEnabled] = useState(stored);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, enabled ? "on" : "off");
    } catch {
      // Storage unavailable; the setting just won't persist.
    }
    if (isTauri()) invoke("set_notifications", { enabled });
  }, [enabled]);
  return [enabled, setEnabled];
}
