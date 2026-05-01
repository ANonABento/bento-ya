use rusqlite::{params, Connection, Result as SqlResult};

use super::models::{UsageByModelDailySummary, UsageRecord, UsageSummary};
use super::{new_id, now};

pub const PROVIDER_ANTHROPIC: &str = "anthropic";

/// Inline row mapping for UsageRecord (12 fields).
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
        column_name: row.get(9)?,
        duration_seconds: row.get(10)?,
        created_at: row.get(11)?,
    })
}

const USAGE_RECORD_COLUMNS: &str = "id, workspace_id, task_id, session_id, provider, model, input_tokens, output_tokens, cost_usd, column_name, duration_seconds, created_at";

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
    column_name: Option<&str>,
    duration_seconds: i64,
) -> SqlResult<UsageRecord> {
    let id = new_id();
    let ts = now();
    conn.execute(
        &format!("INSERT INTO usage_records ({}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)", USAGE_RECORD_COLUMNS),
        params![id, workspace_id, task_id, session_id, provider, model, input_tokens, output_tokens, cost_usd, column_name, duration_seconds, ts],
    )?;
    get_usage_record(conn, &id)
}

/// Estimate cost in USD based on model name and token counts.
///
/// Pricing (per million tokens):
/// - Opus: $15 input, $75 output
/// - Sonnet: $3 input, $15 output
/// - Haiku: $0.25 input, $1.25 output
pub fn estimate_cost(model: &str, input_tokens: i64, output_tokens: i64) -> f64 {
    let model_lower = model.to_lowercase();
    let (input_rate, output_rate) = if model_lower.contains("opus") {
        (15.0, 75.0)
    } else if model_lower.contains("sonnet") {
        (3.0, 15.0)
    } else if model_lower.contains("haiku") {
        (0.25, 1.25)
    } else {
        // Default to sonnet pricing for unknown models
        (3.0, 15.0)
    };
    (input_tokens as f64 * input_rate + output_tokens as f64 * output_rate) / 1_000_000.0
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

/// Aggregate token/cost usage by model for a specific date.
pub fn get_workspace_usage_by_model_for_date(
    conn: &Connection,
    workspace_id: &str,
    date: &str,
) -> SqlResult<Vec<UsageByModelDailySummary>> {
    let mut stmt = conn.prepare(
        "SELECT
            model,
            COALESCE(SUM(input_tokens), 0),
            COALESCE(SUM(output_tokens), 0),
            COALESCE(SUM(cost_usd), 0.0),
            COUNT(*)
          FROM usage_records
         WHERE workspace_id = ?1
           AND substr(created_at, 1, 10) = ?2
         GROUP BY model
         ORDER BY model ASC",
    )?;
    let rows = stmt.query_map(params![workspace_id, date], |row| {
        Ok(UsageByModelDailySummary {
            model: row.get(0)?,
            total_input_tokens: row.get(1)?,
            total_output_tokens: row.get(2)?,
            total_cost_usd: row.get(3)?,
            record_count: row.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn delete_workspace_usage(conn: &Connection, workspace_id: &str) -> SqlResult<()> {
    conn.execute(
        "DELETE FROM usage_records WHERE workspace_id = ?1",
        params![workspace_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use rusqlite::Connection;

    fn setup_usage_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE usage_records (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                task_id TEXT,
                session_id TEXT,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                input_tokens INTEGER NOT NULL,
                output_tokens INTEGER NOT NULL,
                cost_usd REAL NOT NULL,
                column_name TEXT,
                duration_seconds INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_estimate_cost_opus() {
        let cost = estimate_cost("claude-opus-4-20250514", 1_000_000, 1_000_000);
        assert!((cost - 90.0).abs() < 0.001); // $15 + $75
    }

    #[test]
    fn test_estimate_cost_sonnet() {
        let cost = estimate_cost("claude-sonnet-4-20250514", 1_000_000, 1_000_000);
        assert!((cost - 18.0).abs() < 0.001); // $3 + $15
    }

    #[test]
    fn test_estimate_cost_haiku() {
        let cost = estimate_cost("claude-haiku-3-5-20241022", 1_000_000, 1_000_000);
        assert!((cost - 1.5).abs() < 0.001); // $0.25 + $1.25
    }

    #[test]
    fn test_estimate_cost_unknown_defaults_sonnet() {
        let cost = estimate_cost("gpt-4", 1_000_000, 1_000_000);
        assert!((cost - 18.0).abs() < 0.001);
    }

    #[test]
    fn test_estimate_cost_zero_tokens() {
        let cost = estimate_cost("claude-opus-4-20250514", 0, 0);
        assert!((cost - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_get_workspace_usage_by_model_for_date() {
        let conn = setup_usage_conn();
        insert_usage_record(
            &conn,
            "ws-1",
            None,
            None,
            PROVIDER_ANTHROPIC,
            "claude-sonnet",
            100,
            50,
            0.25,
            None,
            0,
        )
        .unwrap();
        insert_usage_record(
            &conn,
            "ws-1",
            None,
            None,
            PROVIDER_ANTHROPIC,
            "claude-sonnet",
            25,
            25,
            0.10,
            None,
            0,
        )
        .unwrap();
        insert_usage_record(
            &conn,
            "ws-1",
            None,
            None,
            PROVIDER_ANTHROPIC,
            "claude-opus",
            10,
            5,
            0.50,
            None,
            0,
        )
        .unwrap();

        let today = Utc::now().date_naive().to_string();
        let summaries = get_workspace_usage_by_model_for_date(&conn, "ws-1", &today).unwrap();

        assert_eq!(summaries.len(), 2);
        assert_eq!(summaries[0].model, "claude-opus");
        assert_eq!(summaries[0].total_input_tokens, 10);
        assert_eq!(summaries[0].total_output_tokens, 5);
        assert_eq!(summaries[0].record_count, 1);
        assert_eq!(summaries[1].model, "claude-sonnet");
        assert_eq!(summaries[1].total_input_tokens, 125);
        assert_eq!(summaries[1].total_output_tokens, 75);
        assert!((summaries[1].total_cost_usd - 0.35).abs() < 0.001);
        assert_eq!(summaries[1].record_count, 2);
    }
}
