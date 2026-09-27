//! Which processes are listening on TCP ports (dev servers, databases, ...).

use std::collections::HashMap;
use std::process::Command;

/// Map of pid -> listening ports, from `lsof -F` machine-readable output.
pub fn listening_ports() -> HashMap<u32, Vec<u16>> {
    let mut map: HashMap<u32, Vec<u16>> = HashMap::new();
    let Ok(out) = Command::new("lsof")
        .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"])
        .output()
    else {
        return map;
    };
    let mut pid = None;
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        if let Some(p) = line.strip_prefix('p') {
            pid = p.parse::<u32>().ok();
        } else if let (Some(addr), Some(pid)) = (line.strip_prefix('n'), pid) {
            // e.g. "*:5173", "127.0.0.1:1420", "[::1]:3000"
            if let Some(port) = addr.rsplit(':').next().and_then(|p| p.parse::<u16>().ok()) {
                let ports = map.entry(pid).or_default();
                if !ports.contains(&port) {
                    ports.push(port);
                }
            }
        }
    }
    for ports in map.values_mut() {
        ports.sort_unstable();
    }
    map
}
