//! Tells the user when an agent starts needing them: a native notification on each
//! new request, plus a Dock badge with how many agents are waiting.

use crate::model::{Agent, AgentStatus};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

/// Whether to show notifications; the UI's bell toggle flips this.
pub static ENABLED: AtomicBool = AtomicBool::new(true);

/// Don't repeat the same request for the same agent within this window, in case its
/// status flickers (e.g. a brief CPU spike while it sits at a permission prompt).
const REPEAT_AFTER: Duration = Duration::from_secs(300);

#[derive(Default)]
pub struct Alerts {
    /// Last seen attention reason per agent pid; `None` means it wasn't waiting.
    seen: HashMap<u32, Option<String>>,
    /// Last notification sent per agent pid.
    notified: HashMap<u32, (String, Instant)>,
    primed: bool,
    badge: i64,
}

impl Alerts {
    pub fn update(&mut self, app: &AppHandle, agents: &[Agent]) {
        let enabled = ENABLED.load(Ordering::Relaxed);
        for (i, reason) in self.decide(agents, Instant::now(), enabled) {
            notify(app, &agents[i], &reason);
        }
        let waiting = self.seen.values().filter(|r| r.is_some()).count() as i64;
        if waiting != self.badge {
            self.badge = waiting;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_badge_count((waiting > 0).then_some(waiting));
            }
        }
    }

    /// Records the agents' state and returns which of them (by index) to notify about, and why.
    fn decide(&mut self, agents: &[Agent], now: Instant, enabled: bool) -> Vec<(usize, String)> {
        let mut out = Vec::new();
        let mut seen = HashMap::with_capacity(agents.len());
        for (i, a) in agents.iter().enumerate() {
            let reason = (a.status == AgentStatus::Waiting).then(|| a.attention.clone().unwrap_or_default());
            let before = self.seen.get(&a.pid).cloned().flatten();
            // Notify on a new request, including a different request from an agent that was
            // already waiting (e.g. it finished its turn, you replied, and now it wants permission).
            // Skip the first tick so launching the app doesn't replay everything already waiting.
            if let Some(r) = reason.as_deref() {
                let repeat = self
                    .notified
                    .get(&a.pid)
                    .is_some_and(|(last, at)| last == r && now.duration_since(*at) < REPEAT_AFTER);
                if self.primed && reason != before && !repeat && enabled {
                    out.push((i, r.to_string()));
                    self.notified.insert(a.pid, (r.to_string(), now));
                }
            }
            seen.insert(a.pid, reason);
        }
        self.seen = seen;
        self.notified.retain(|pid, _| self.seen.contains_key(pid));
        self.primed = true;
        out
    }
}

fn notify(app: &AppHandle, agent: &Agent, reason: &str) {
    let title = match &agent.project {
        Some(p) => format!("{} needs you · {p}", agent.kind),
        None => format!("{} needs you", agent.kind),
    };
    let body = if reason.is_empty() { "Waiting for your input" } else { reason };
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .sound("Glass")
        .show();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent(pid: u32, status: AgentStatus, attention: Option<&str>) -> Agent {
        Agent {
            pid,
            kind: "Claude Code".into(),
            status,
            cwd: None,
            project: None,
            cpu: 0.0,
            memory: 0,
            run_time: 0,
            task_pids: vec![],
            session: None,
            attention: attention.map(str::to_string),
        }
    }

    const DONE: Option<&str> = Some("Finished, waiting for your reply");
    const PERM: Option<&str> = Some("Wants permission: Bash: rm -rf build");

    #[test]
    fn ignores_agents_already_waiting_at_launch() {
        let mut a = Alerts::default();
        assert!(a.decide(&[agent(1, AgentStatus::Waiting, DONE)], Instant::now(), true).is_empty());
    }

    #[test]
    fn notifies_on_transition_and_on_a_new_request() {
        let mut a = Alerts::default();
        let t = Instant::now();
        a.decide(&[agent(1, AgentStatus::Working, None)], t, true);
        let hits = a.decide(&[agent(1, AgentStatus::Waiting, DONE)], t, true);
        assert_eq!(hits, vec![(0, DONE.unwrap().to_string())]);
        // Still waiting on the same thing: no repeat.
        assert!(a.decide(&[agent(1, AgentStatus::Waiting, DONE)], t, true).is_empty());
        // A different request while waiting does notify.
        assert_eq!(a.decide(&[agent(1, AgentStatus::Waiting, PERM)], t, true).len(), 1);
    }

    #[test]
    fn suppresses_flicker_but_not_forever() {
        let mut a = Alerts::default();
        let t = Instant::now();
        a.decide(&[agent(1, AgentStatus::Working, None)], t, true);
        assert_eq!(a.decide(&[agent(1, AgentStatus::Waiting, PERM)], t, true).len(), 1);
        a.decide(&[agent(1, AgentStatus::Working, None)], t, true);
        assert!(a.decide(&[agent(1, AgentStatus::Waiting, PERM)], t + Duration::from_secs(5), true).is_empty());
        a.decide(&[agent(1, AgentStatus::Working, None)], t, true);
        let later = t + REPEAT_AFTER + Duration::from_secs(1);
        assert_eq!(a.decide(&[agent(1, AgentStatus::Waiting, PERM)], later, true).len(), 1);
    }

    #[test]
    fn respects_mute() {
        let mut a = Alerts::default();
        let t = Instant::now();
        a.decide(&[agent(1, AgentStatus::Working, None)], t, false);
        assert!(a.decide(&[agent(1, AgentStatus::Waiting, DONE)], t, false).is_empty());
    }
}
