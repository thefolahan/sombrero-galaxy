import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isDemo } from "../lib/useSnapshot";

export async function killProcess(pid: number, force: boolean): Promise<void> {
  if (isDemo) throw new Error("Demo mode: run inside the app with `pnpm tauri dev` to stop processes.");
  await invoke("kill_process", { pid, force });
}

export async function openPort(port: number): Promise<void> {
  const url = `http://localhost:${port}`;
  if (isDemo) window.open(url, "_blank");
  else await openUrl(url);
}
