//! Phase 4 (AGENT_PANEL_MODES) completion-source telemetry.
//!
//! Every time an agent finishes (or is terminated), one row is appended
//! here. The fire-and-forget API at the bottom of this file is what
//! callers should use — it routes through a tokio task so completion
//! handling is never blocked on the insert.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::now_millis;

/// What signal flagged the agent as complete. Stable string values —
/// keep in sync with the comment in migration 045.
#[derive(Debug, Clone, Copy)]
pub enum CompletionSource {
    Sentinel,
    ExitCode,
    Manual,
    Timeout,
    Kill,
}

impl CompletionSource {
    pub fn as_str(self) -> &'static str {
        match self {
            CompletionSource::Sentinel => "sentinel",
            CompletionSource::ExitCode => "exit_code",
            CompletionSource::Manual => "manual",
            CompletionSource::Timeout => "timeout",
            CompletionSource::Kill => "kill",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCompletionEvent {
    pub id: i64,
    pub task_id: String,
    pub workspace_id: String,
    pub cli: String,
    /// `"headless" | "interactive"`. Matches `ResolvedRuntimeMode.mode`.
    pub mode: String,
    /// One of the `CompletionSource` strings above.
    pub completion_source: String,
    pub duration_ms: i64,
    pub sentinel_seen_at: Option<i64>,
    pub created_at: i64,
}

/// Append a completion event to the local telemetry table. Synchronous;
/// callers in hot paths should use `record_async` instead.
pub fn record(
    conn: &Connection,
    task_id: &str,
    workspace_id: &str,
    cli: &str,
    mode: &str,
    source: CompletionSource,
    duration_ms: i64,
    sentinel_seen_at: Option<i64>,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO agent_completion_events
            (task_id, workspace_id, cli, mode, completion_source,
             duration_ms, sentinel_seen_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            task_id,
            workspace_id,
            cli,
            mode,
            source.as_str(),
            duration_ms,
            sentinel_seen_at,
            now_millis()
        ],
    )?;
    Ok(())
}

/// Fire-and-forget completion event write. Spawns a tokio task that
/// opens its own DB connection so the hot trigger-completion path
/// doesn't have to wait on the insert. Errors are logged, not bubbled.
pub fn record_async(
    task_id: String,
    workspace_id: String,
    cli: String,
    mode: String,
    source: CompletionSource,
    duration_ms: i64,
    sentinel_seen_at: Option<i64>,
) {
    tokio::spawn(async move {
        match Connection::open(super::db_path()) {
            Ok(conn) => {
                let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                if let Err(e) = record(
                    &conn,
                    &task_id,
                    &workspace_id,
                    &cli,
                    &mode,
                    source,
                    duration_ms,
                    sentinel_seen_at,
                ) {
                    log::warn!(
                        "[completion-events] insert failed for task {} ({}): {}",
                        task_id,
                        source.as_str(),
                        e
                    );
                }
            }
            Err(e) => {
                log::warn!(
                    "[completion-events] DB open failed for task {} ({}): {}",
                    task_id,
                    source.as_str(),
                    e
                );
            }
        }
    });
}

/// Return the most recent `limit` completion events for a workspace,
/// newest-first. Used by the settings panel debug view.
pub fn list_recent(
    conn: &Connection,
    workspace_id: &str,
    limit: i64,
) -> rusqlite::Result<Vec<AgentCompletionEvent>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, workspace_id, cli, mode, completion_source,
                duration_ms, sentinel_seen_at, created_at
         FROM agent_completion_events
         WHERE workspace_id = ?1
         ORDER BY created_at DESC, id DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![workspace_id, limit], |row| {
        Ok(AgentCompletionEvent {
            id: row.get(0)?,
            task_id: row.get(1)?,
            workspace_id: row.get(2)?,
            cli: row.get(3)?,
            mode: row.get(4)?,
            completion_source: row.get(5)?,
            duration_ms: row.get(6)?,
            sentinel_seen_at: row.get(7)?,
            created_at: row.get(8)?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn record_and_list_round_trip() {
        let conn = db::init_test().unwrap();
        record(
            &conn,
            "t1",
            "ws1",
            "claude",
            "interactive",
            CompletionSource::Sentinel,
            42_000,
            Some(1234),
        )
        .unwrap();
        record(
            &conn,
            "t2",
            "ws1",
            "codex",
            "headless",
            CompletionSource::Timeout,
            7_200_000,
            None,
        )
        .unwrap();
        record(
            &conn,
            "t3",
            "ws-other",
            "claude",
            "interactive",
            CompletionSource::Manual,
            100,
            None,
        )
        .unwrap();

        let events = list_recent(&conn, "ws1", 10).unwrap();
        assert_eq!(events.len(), 2, "must filter by workspace");
        // Newest first.
        assert_eq!(events[0].completion_source, "timeout");
        assert_eq!(events[1].completion_source, "sentinel");
        assert_eq!(events[1].cli, "claude");
        assert_eq!(events[1].mode, "interactive");
        assert_eq!(events[1].sentinel_seen_at, Some(1234));
    }
}
