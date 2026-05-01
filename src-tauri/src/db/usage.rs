use rusqlite::{params, Connection, Result as SqlResult};

use super::models::{
    ColumnCost, DailyCost, ModelUsageSummary, TaskCost, UsageRecord, UsageSummary,
};
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

pub fn get_workspace_model_usage_between(
    conn: &Connection,
    workspace_id: &str,
    start_at: &str,
    end_at: &str,
) -> SqlResult<Vec<ModelUsageSummary>> {
    let mut stmt = conn.prepare(
        "SELECT provider,
                model,
                COALESCE(SUM(input_tokens), 0) as input_tokens,
                COALESCE(SUM(output_tokens), 0) as output_tokens,
                COALESCE(SUM(cost_usd), 0.0) as cost_usd,
                COUNT(*) as record_count
         FROM usage_records
         WHERE workspace_id = ?1
           AND datetime(created_at) >= datetime(?2)
           AND datetime(created_at) < datetime(?3)
         GROUP BY provider, model
         ORDER BY cost_usd DESC",
    )?;
    let rows = stmt.query_map(params![workspace_id, start_at, end_at], |row| {
        Ok(ModelUsageSummary {
            provider: row.get(0)?,
            model: row.get(1)?,
            input_tokens: row.get(2)?,
            output_tokens: row.get(3)?,
            cost_usd: row.get(4)?,
            record_count: row.get(5)?,
        })
    })?;
    rows.collect()
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

/// Daily cost aggregation for the past N days (for time-series charts).
pub fn get_workspace_daily_costs(
    conn: &Connection,
    workspace_id: &str,
    days: i64,
) -> SqlResult<Vec<DailyCost>> {
    let mut stmt = conn.prepare(
        "SELECT DATE(created_at) as date,
                COALESCE(SUM(cost_usd), 0.0) as cost_usd,
                COALESCE(SUM(input_tokens), 0) as input_tokens,
                COALESCE(SUM(output_tokens), 0) as output_tokens,
                COUNT(*) as record_count
         FROM usage_records
         WHERE workspace_id = ?1
           AND created_at >= DATE('now', '-' || ?2 || ' days')
         GROUP BY DATE(created_at)
         ORDER BY date ASC",
    )?;
    let rows = stmt.query_map(params![workspace_id, days], |row| {
        Ok(DailyCost {
            date: row.get(0)?,
            cost_usd: row.get(1)?,
            input_tokens: row.get(2)?,
            output_tokens: row.get(3)?,
            record_count: row.get(4)?,
        })
    })?;
    rows.collect()
}

/// Cost aggregated by column name.
pub fn get_workspace_column_costs(
    conn: &Connection,
    workspace_id: &str,
) -> SqlResult<Vec<ColumnCost>> {
    let mut stmt = conn.prepare(
        "SELECT COALESCE(column_name, 'Untracked') as column_name,
                COALESCE(SUM(cost_usd), 0.0) as cost_usd,
                COALESCE(SUM(input_tokens), 0) as input_tokens,
                COALESCE(SUM(output_tokens), 0) as output_tokens,
                COUNT(*) as record_count
         FROM usage_records
         WHERE workspace_id = ?1
         GROUP BY column_name
         ORDER BY cost_usd DESC",
    )?;
    let rows = stmt.query_map(params![workspace_id], |row| {
        Ok(ColumnCost {
            column_name: row.get(0)?,
            cost_usd: row.get(1)?,
            input_tokens: row.get(2)?,
            output_tokens: row.get(3)?,
            record_count: row.get(4)?,
        })
    })?;
    rows.collect()
}

/// Cost aggregated by task (top N tasks by cost), with task title from JOIN.
pub fn get_workspace_task_costs(
    conn: &Connection,
    workspace_id: &str,
    limit: i64,
) -> SqlResult<Vec<TaskCost>> {
    let mut stmt = conn.prepare(
        "SELECT u.task_id,
                COALESCE(t.title, 'Unknown Task') as task_title,
                COALESCE(SUM(u.cost_usd), 0.0) as cost_usd,
                COALESCE(SUM(u.input_tokens), 0) as input_tokens,
                COALESCE(SUM(u.output_tokens), 0) as output_tokens,
                COUNT(*) as record_count
         FROM usage_records u
         LEFT JOIN tasks t ON t.id = u.task_id
         WHERE u.workspace_id = ?1 AND u.task_id IS NOT NULL
         GROUP BY u.task_id
         ORDER BY cost_usd DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![workspace_id, limit], |row| {
        Ok(TaskCost {
            task_id: row.get(0)?,
            task_title: row.get(1)?,
            cost_usd: row.get(2)?,
            input_tokens: row.get(3)?,
            output_tokens: row.get(4)?,
            record_count: row.get(5)?,
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
    use rusqlite::Connection;

    fn setup_usage_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE usage_records (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT NOT NULL,
                task_id TEXT,
                session_id TEXT,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                cost_usd REAL NOT NULL DEFAULT 0.0,
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
    fn test_get_workspace_model_usage_between_groups_current_window() {
        let conn = setup_usage_conn();
        conn.execute(
            "INSERT INTO usage_records
             (id, workspace_id, provider, model, input_tokens, output_tokens, cost_usd, created_at)
             VALUES
             ('1', 'ws-1', 'anthropic', 'sonnet', 100, 50, 0.25, '2026-05-01T00:00:00+00:00'),
             ('2', 'ws-1', 'anthropic', 'sonnet', 200, 75, 0.50, '2026-05-01T04:00:00+00:00'),
             ('3', 'ws-1', 'anthropic', 'opus', 1000, 500, 4.00, '2026-05-01T05:00:00+00:00'),
             ('4', 'ws-1', 'anthropic', 'sonnet', 999, 999, 9.99, '2026-05-02T00:00:00+00:00'),
             ('5', 'ws-2', 'anthropic', 'sonnet', 999, 999, 9.99, '2026-05-01T04:00:00Z')",
            [],
        )
        .unwrap();

        let summaries = get_workspace_model_usage_between(
            &conn,
            "ws-1",
            "2026-05-01T00:00:00.000Z",
            "2026-05-02T00:00:00.000Z",
        )
        .unwrap();

        assert_eq!(summaries.len(), 2);
        assert_eq!(summaries[0].model, "opus");
        assert_eq!(summaries[0].cost_usd, 4.0);
        assert_eq!(summaries[1].model, "sonnet");
        assert_eq!(summaries[1].input_tokens, 300);
        assert_eq!(summaries[1].output_tokens, 125);
        assert_eq!(summaries[1].record_count, 2);
        assert!((summaries[1].cost_usd - 0.75).abs() < 0.001);
    }
}
