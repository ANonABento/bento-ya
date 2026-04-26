//! Garbage collector for tmux sessions and agent resources.
//!
//! Runs periodically to:
//! 1. Kill orphaned tmux sessions (task deleted or not in DB)
//! 2. Detach idle sessions (idle > idle_sleep_minutes)
//! 3. Kill dead sessions (idle > idle_kill_hours)
//! 4. Clean up stale agent_session records

use std::time::Duration;

use rusqlite::Connection;

use super::tmux_transport;
use crate::config::AppSettings;
use crate::db;

/// Run one garbage collection cycle.
pub fn collect(conn: &Connection) {
    let settings = AppSettings::load();
    let sessions = tmux_transport::list_sessions();

    if sessions.is_empty() {
        return;
    }

    let mut killed = 0;

    for session_name in &sessions {
        let task_id = match tmux_transport::session_name_to_task_id(session_name) {
            Some(id) => id,
            None => continue,
        };

        // Check if task exists in DB
        let task = match db::get_task(conn, task_id) {
            Ok(t) => t,
            Err(_) => {
                // Task doesn't exist — orphaned session
                eprintln!(
                    "[gc] Killing orphaned tmux session: {} (task not in DB)",
                    session_name
                );
                let _ = std::process::Command::new("tmux")
                    .args(["kill-session", "-t", session_name])
                    .output();
                killed += 1;
                continue;
            }
        };

        eprintln!(
            "[gc] Evaluating session {} — task {} pipeline_state={} agent_status={:?}",
            session_name, task_id, task.pipeline_state, task.agent_status
        );

        // Check for finished agents — candidate for session cleanup.
        // Never kill sessions for tasks with an active pipeline (state = running/triggered)
        // since the pipeline's tmux wait-for completion detection needs the session alive.
        let pipeline_active = matches!(task.pipeline_state.as_str(), "running" | "triggered");

        let agent_finished = !pipeline_active
            && matches!(
                task.agent_status.as_deref(),
                Some("completed") | Some("failed") | Some("cancelled") | Some("idle")
            );

        if agent_finished {
            // Check if the agent session has been idle long enough to kill
            if let Some(ref sid) = task.agent_session_id {
                if let Ok(session) = db::get_agent_session(conn, sid) {
                    // Try RFC3339 first, then space-separated format
                    let parsed = chrono::DateTime::parse_from_rfc3339(&session.updated_at)
                        .map(|dt| dt.with_timezone(&chrono::Utc))
                        .or_else(|_| {
                            chrono::NaiveDateTime::parse_from_str(
                                &session.updated_at,
                                "%Y-%m-%d %H:%M:%S%.f%:z",
                            )
                            .map(|ndt| ndt.and_utc())
                            .or_else(|_| {
                                chrono::NaiveDateTime::parse_from_str(
                                    &session.updated_at,
                                    "%Y-%m-%d %H:%M:%S",
                                )
                                .map(|ndt| ndt.and_utc())
                            })
                        });

                    if let Ok(updated_utc) = parsed {
                        let idle_hours = (chrono::Utc::now() - updated_utc).num_hours();
                        if idle_hours >= settings.idle_kill_hours as i64 {
                            eprintln!(
                                "[gc] Killing idle tmux session: {} (idle {}h, threshold {}h)",
                                session_name, idle_hours, settings.idle_kill_hours
                            );
                            let _ = std::process::Command::new("tmux")
                                .args(["kill-session", "-t", session_name])
                                .output();
                            killed += 1;

                            // Clean up agent_status
                            let _ = db::update_task_agent_status(conn, task_id, Some("idle"), None);
                        }
                    }
                }
            }
        }
    }

    if killed > 0 {
        eprintln!("[gc] Cleaned up {} tmux session(s)", killed);
    }

    // Also check for tasks marked "running" whose tmux session has died
    // (e.g., OOM kill, manual tmux kill-session)
    if let Ok(mut stmt) =
        conn.prepare("SELECT id, agent_session_id FROM tasks WHERE agent_status = 'running'")
    {
        let stale: Vec<(String, Option<String>)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();

        for (task_id, session_id) in stale {
            let session_name = tmux_transport::session_name(&task_id);
            // Check if tmux session actually exists
            let session_exists = sessions.contains(&session_name);
            if !session_exists {
                eprintln!(
                    "[gc] Task {} marked running but tmux session gone — marking failed",
                    task_id
                );
                let _ = db::update_task_agent_status(conn, &task_id, Some("failed"), None);
                if let Some(ref sid) = session_id {
                    let _ = db::update_agent_session(
                        conn,
                        sid,
                        None,
                        Some("failed"),
                        None,
                        None,
                        None,
                        None,
                    );
                }
            }
        }
    }
}

/// Start the periodic garbage collector.
/// Runs every `gc_interval_minutes` from settings (default 5).
/// Note: interval changes via API take effect on the next cycle, not immediately.
pub fn start_gc() {
    tauri::async_runtime::spawn(async move {
        loop {
            let interval = {
                let settings = AppSettings::load();
                Duration::from_secs(settings.gc_interval_minutes * 60)
            };

            tokio::time::sleep(interval).await;

            // Open a fresh DB connection for each cycle
            if let Ok(conn) = Connection::open(db::db_path()) {
                let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                collect(&conn);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_collect_no_sessions() {
        // Should not panic when no tmux sessions exist
        // (can't fully test without tmux, but verify it doesn't crash)
        let conn = Connection::open_in_memory().unwrap();
        collect(&conn); // No-op since no tmux sessions
    }
}
