use rusqlite::{params, Connection, Result as SqlResult};

use super::models::{UsageRecord, UsageSummary};
use super::{new_id, now};

/// Inline row mapping for UsageRecord (10 fields).
fn map_usage_record_row(row: &rusqlite::Row) -> rusqlite::Result<UsageRecord> {
    Ok(UsageRecord {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        task_id: row.get(2)?,
        session_id: row.get(3)?,
        provider: row.get(4)?,
        model: row.get(5)?,
        input_tokens: row.get(6)?,
        output_tokens: row.get(7)?,
        cost_usd: row.get(8)?,
        created_at: row.get(9)?,
    })
}

const USAGE_RECORD_COLUMNS: &str = "id, workspace_id, task_id, session_id, provider, model, input_tokens, output_tokens, cost_usd, created_at";

#[allow(clippy::too_many_arguments)]
pub fn insert_usage_record(
    conn: &Connection,
    workspace_id: &str,
    task_id: Option<&str>,
    session_id: Option<&str>,
    provider: &str,
    model: &str,
    input_tokens: i64,
    output_tokens: i64,
    cost_usd: f64,
) -> SqlResult<UsageRecord> {
    let id = new_id();
    let ts = now();
    conn.execute(
        &format!(
            "INSERT INTO usage_records ({}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            USAGE_RECORD_COLUMNS
        ),
        params![
            id,
            workspace_id,
            task_id,
            session_id,
            provider,
            model,
            input_tokens,
            output_tokens,
            cost_usd,
            ts
        ],
    )?;
    get_usage_record(conn, &id)
}

pub fn get_usage_record(conn: &Connection, id: &str) -> SqlResult<UsageRecord> {
    conn.query_row(
        &format!(
            "SELECT {} FROM usage_records WHERE id = ?1",
            USAGE_RECORD_COLUMNS
        ),
        params![id],
        map_usage_record_row,
    )
}

pub fn list_usage_records(
    conn: &Connection,
    workspace_id: &str,
    limit: Option<i64>,
) -> SqlResult<Vec<UsageRecord>> {
    let limit_val = limit.unwrap_or(100);
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM usage_records WHERE workspace_id = ?1 ORDER BY created_at DESC LIMIT ?2",
        USAGE_RECORD_COLUMNS
    ))?;
    let rows = stmt.query_map(params![workspace_id, limit_val], map_usage_record_row)?;
    rows.collect()
}

pub fn list_task_usage(conn: &Connection, task_id: &str) -> SqlResult<Vec<UsageRecord>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM usage_records WHERE task_id = ?1 ORDER BY created_at DESC",
        USAGE_RECORD_COLUMNS
    ))?;
    let rows = stmt.query_map(params![task_id], map_usage_record_row)?;
    rows.collect()
}

pub fn get_workspace_usage_summary(
    conn: &Connection,
    workspace_id: &str,
) -> SqlResult<UsageSummary> {
    conn.query_row(
        "SELECT COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0), COALESCE(SUM(cost_usd), 0.0), COUNT(*) FROM usage_records WHERE workspace_id = ?1",
        params![workspace_id],
        |row| Ok(UsageSummary {
            total_input_tokens: row.get(0)?,
            total_output_tokens: row.get(1)?,
            total_cost_usd: row.get(2)?,
            record_count: row.get(3)?,
        }),
    )
}

pub fn get_task_usage_summary(conn: &Connection, task_id: &str) -> SqlResult<UsageSummary> {
    conn.query_row(
        "SELECT COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0), COALESCE(SUM(cost_usd), 0.0), COUNT(*) FROM usage_records WHERE task_id = ?1",
        params![task_id],
        |row| Ok(UsageSummary {
            total_input_tokens: row.get(0)?,
            total_output_tokens: row.get(1)?,
            total_cost_usd: row.get(2)?,
            record_count: row.get(3)?,
        }),
    )
}

pub fn delete_workspace_usage(conn: &Connection, workspace_id: &str) -> SqlResult<()> {
    conn.execute(
        "DELETE FROM usage_records WHERE workspace_id = ?1",
        params![workspace_id],
    )?;
    Ok(())
}
