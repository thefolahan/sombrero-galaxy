mod alerts;
mod claude;
mod model;
mod music;
mod ports;
mod scanner;

use model::Snapshot;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use sysinfo::{Pid, ProcessesToUpdate, Signal, System};
use tauri::{Emitter, State};

const TICK: Duration = Duration::from_millis(1500);

#[derive(Default)]
struct Latest(Arc<Mutex<Option<Snapshot>>>);

/// The most recent snapshot, so the UI has something to draw before the next tick.
#[tauri::command]
fn get_snapshot(latest: State<'_, Latest>) -> Option<Snapshot> {
    latest.0.lock().ok()?.clone()
}

/// Turns "agent needs you" notifications on or off.
#[tauri::command]
fn set_notifications(enabled: bool) {
    alerts::ENABLED.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

/// Sends SIGTERM (or SIGKILL when `force`) to a process.
#[tauri::command]
fn kill_process(pid: u32, force: bool) -> Result<(), String> {
    if pid <= 1 || pid == std::process::id() {
        return Err("Refusing to stop that process.".into());
    }
    let mut sys = System::new();
    let target = [Pid::from_u32(pid)];
    sys.refresh_processes(ProcessesToUpdate::Some(&target), true);
    let process = sys
        .process(target[0])
        .ok_or_else(|| format!("Process {pid} is no longer running."))?;
    let signal = if force { Signal::Kill } else { Signal::Term };
    match process.kill_with(signal) {
        Some(true) => Ok(()),
        Some(false) => Err(format!(
            "Could not signal {pid}. It may belong to another user or to the system."
        )),
        None => Err("That signal isn't supported on this platform.".into()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let latest = Latest::default();
    let shared = latest.0.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(latest)
        .setup(move |app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut scanner = scanner::Scanner::new();
                let mut alerts = alerts::Alerts::default();
                loop {
                    let snapshot = scanner.sample();
                    alerts.update(&handle, &snapshot.agents);
                    let _ = handle.emit("snapshot", &snapshot);
                    if let Ok(mut slot) = shared.lock() {
                        *slot = Some(snapshot);
                    }
                    std::thread::sleep(TICK);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_snapshot, kill_process, set_notifications])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
