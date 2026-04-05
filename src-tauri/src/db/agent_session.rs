use rusqlite::{params, Connection, Result as SqlResult};

use super::models::AgentSession;
use super::{new_id, now};

/// Inline row mapping for AgentSession (17 fields).
fn map_agent_session_row(row: &rusqlite::Row) -> rusqlite::Result<AgentSession> {
    Ok(AgentSession {
        id: row.get(0)?,
        task_id: row.get(1)?,
        pid: row.get(2)?,
        status: row.get(3)?,
        pty_cols: row.get(4)?,
        pty_rows: row.get(5)?,
        last_output: row.get(6)?,
        exit_code: row.get(7)?,
        agent_type: row.get(8)?,
        working_dir: row.get(9)?,
        scrollback: row.get(10)?,
        resumable: row.get::<_, i64>(11)? != 0,
        cli_session_id: row.get(12)?,
        model: row.get(13)?,
        effort_level: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
    })
}

const AGENT_SESSION_COLUMNS: &str = "id, task_id, pid, status, pty_cols, pty_rows, last_output, exit_code, agent_type, working_dir, scrollback, resumable, cli_session_id, model, effort_level, created_at, updated_at";

pub fn insert_agent_session(
    conn: &Connection,
    task_id: &str,
    agent_type: &str,
    working_dir: Option<&str>,
) -> SqlResult<AgentSession> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO agent_sessions (id, task_id, agent_type, working_dir, status, pty_cols, pty_rows, resumable, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'idle', 80, 24, 0, ?5, ?6)",
        params![id, task_id, agent_type, working_dir, ts, ts],
    )?;
    get_agent_session(conn, &id)
}

pub fn get_agent_session(conn: &Connection, id: &str) -> SqlResult<AgentSession> {
    conn.query_row(
        &format!("SELECT {} FROM agent_sessions WHERE id = ?1", AGENT_SESSION_COLUMNS),
        params![id],
        map_agent_session_row,
    )
}

pub fn list_agent_sessions(conn: &Connection, task_id: &str) -> SqlResult<Vec<AgentSession>> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM agent_sessions WHERE task_id = ?1 ORDER BY created_at DESC", AGENT_SESSION_COLUMNS),
    )?;
    let rows = stmt.query_map(params![task_id], map_agent_session_row)?;
    rows.collect()
}

/// List resumable sessions for a task
pub fn list_resumable_sessions(conn: &Connection, task_id: &str) -> SqlResult<Vec<AgentSession>> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM agent_sessions WHERE task_id = ?1 AND resumable = 1 ORDER BY created_at DESC", AGENT_SESSION_COLUMNS),
    )?;
    let rows = stmt.query_map(params![task_id], map_agent_session_row)?;
    rows.collect()
}

pub fn update_agent_session(
    conn: &Connection,
    id: &str,
    pid: Option<Option<i64>>,
    status: Option<&str>,
    exit_code: Option<Option<i64>>,
    last_output: Option<Option<&str>>,
    scrollback: Option<Option<&str>>,
    resumable: Option<bool>,
) -> SqlResult<AgentSession> {
    let current = get_agent_session(conn, id)?;
    let ts = now();
    let new_pid = match pid {
        Some(p) => p,
        None => current.pid,
    };
    let new_exit_code = match exit_code {
        Some(e) => e,
        None => current.exit_code,
    };
    let new_last_output = match last_output {
        Some(o) => o.map(|s| s.to_string()),
        None => current.last_output.clone(),
    };
    let new_scrollback = match scrollback {
        Some(s) => s.map(|t| t.to_string()),
        None => current.scrollback.clone(),
    };
    let new_resumable = resumable.unwrap_or(current.resumable);
    conn.execute(
        "UPDATE agent_sessions SET pid = ?1, status = ?2, exit_code = ?3, last_output = ?4, scrollback = ?5, resumable = ?6, updated_at = ?7 WHERE id = ?8",
        params![
            new_pid,
            status.unwrap_or(&current.status),
            new_exit_code,
            new_last_output,
            new_scrollback,
            if new_resumable { 1 } else { 0 },
            ts,
            id,
        ],
    )?;
    get_agent_session(conn, id)
}

pub fn delete_agent_session(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM agent_sessions WHERE id = ?1", params![id])?;
    Ok(())
}

/// Update CLI session fields for an agent session
pub fn update_agent_session_cli(
    conn: &Connection,
    id: &str,
    cli_session_id: Option<&str>,
    model: Option<&str>,
    effort_level: Option<&str>,
) -> SqlResult<AgentSession> {
    let ts = now();
    conn.execute(
        "UPDATE agent_sessions SET cli_session_id = ?1, model = ?2, effort_level = ?3, updated_at = ?4 WHERE id = ?5",
        params![cli_session_id, model, effort_level, ts, id],
    )?;
    get_agent_session(conn, id)
}

/// Count running agent sessions across all tasks
pub fn count_running_agent_sessions(conn: &Connection) -> SqlResult<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM agent_sessions WHERE status = 'running'",
        [],
        |row| row.get(0),
    )
}

/// Get or create agent session for a task
pub fn get_or_create_agent_session_for_task(
    conn: &Connection,
    task_id: &str,
    agent_type: &str,
    working_dir: Option<&str>,
) -> SqlResult<AgentSession> {
    // Try to find an existing idle session
    let existing: Result<AgentSession, _> = conn.query_row(
        &format!("SELECT {} FROM agent_sessions WHERE task_id = ?1 AND status = 'idle' ORDER BY created_at DESC LIMIT 1", AGENT_SESSION_COLUMNS),
        params![task_id],
        map_agent_session_row,
    );

    match existing {
        Ok(session) => Ok(session),
        Err(_) => insert_agent_session(conn, task_id, agent_type, working_dir),
    }
}
