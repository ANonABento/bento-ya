use rusqlite::{params, Connection, Result as SqlResult};

use super::models::{
    ColumnCostSummary, CostDashboard, DailyCostSummary, TaskCostSummary, UsageRecord, UsageSummary,
    WorkspaceCostSummary,
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

pub fn get_cost_dashboard(conn: &Connection) -> SqlResult<CostDashboard> {
    let total = conn.query_row(
        "SELECT COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0), COALESCE(SUM(cost_usd), 0.0), COUNT(*) FROM usage_records",
        [],
        |row| Ok(UsageSummary {
            total_input_tokens: row.get(0)?,
            total_output_tokens: row.get(1)?,
            total_cost_usd: row.get(2)?,
            record_count: row.get(3)?,
        }),
    )?;

    let mut workspace_stmt = conn.prepare(
        "SELECT
            u.workspace_id,
            COALESCE(w.name, 'Unknown workspace') AS workspace_name,
            COALESCE(SUM(u.cost_usd), 0.0) AS total_cost_usd,
            COALESCE(SUM(u.input_tokens), 0) AS total_input_tokens,
            COALESCE(SUM(u.output_tokens), 0) AS total_output_tokens,
            COUNT(*) AS record_count
        FROM usage_records u
        LEFT JOIN workspaces w ON w.id = u.workspace_id
        GROUP BY u.workspace_id, workspace_name
        ORDER BY total_cost_usd DESC, workspace_name ASC",
    )?;
    let workspaces = workspace_stmt
        .query_map([], |row| {
            Ok(WorkspaceCostSummary {
                workspace_id: row.get(0)?,
                workspace_name: row.get(1)?,
                total_cost_usd: row.get(2)?,
                total_input_tokens: row.get(3)?,
                total_output_tokens: row.get(4)?,
                record_count: row.get(5)?,
            })
        })?
        .collect::<SqlResult<Vec<_>>>()?;

    let mut column_stmt = conn.prepare(
        "SELECT
            u.workspace_id,
            COALESCE(w.name, 'Unknown workspace') AS workspace_name,
            COALESCE(u.column_name, c.name, 'Unassigned') AS column_name,
            COALESCE(SUM(u.cost_usd), 0.0) AS total_cost_usd,
            COALESCE(SUM(u.input_tokens), 0) AS total_input_tokens,
            COALESCE(SUM(u.output_tokens), 0) AS total_output_tokens,
            COUNT(*) AS record_count
        FROM usage_records u
        LEFT JOIN workspaces w ON w.id = u.workspace_id
        LEFT JOIN tasks t ON t.id = u.task_id
        LEFT JOIN columns c ON c.id = t.column_id
        GROUP BY u.workspace_id, workspace_name, column_name
        ORDER BY total_cost_usd DESC, workspace_name ASC, column_name ASC",
    )?;
    let columns = column_stmt
        .query_map([], |row| {
            Ok(ColumnCostSummary {
                workspace_id: row.get(0)?,
                workspace_name: row.get(1)?,
                column_name: row.get(2)?,
                total_cost_usd: row.get(3)?,
                total_input_tokens: row.get(4)?,
                total_output_tokens: row.get(5)?,
                record_count: row.get(6)?,
            })
        })?
        .collect::<SqlResult<Vec<_>>>()?;

    let mut task_stmt = conn.prepare(
        "SELECT
            u.task_id,
            COALESCE(t.title, 'Deleted or unassigned task') AS task_title,
            u.workspace_id,
            COALESCE(w.name, 'Unknown workspace') AS workspace_name,
            COALESCE(c.name, MAX(u.column_name)) AS column_name,
            COALESCE(SUM(u.cost_usd), 0.0) AS total_cost_usd,
            COALESCE(SUM(u.input_tokens), 0) AS total_input_tokens,
            COALESCE(SUM(u.output_tokens), 0) AS total_output_tokens,
            COUNT(*) AS record_count
        FROM usage_records u
        LEFT JOIN tasks t ON t.id = u.task_id
        LEFT JOIN workspaces w ON w.id = u.workspace_id
        LEFT JOIN columns c ON c.id = t.column_id
        GROUP BY u.task_id, task_title, u.workspace_id, workspace_name, c.name
        ORDER BY total_cost_usd DESC, task_title ASC
        LIMIT 10",
    )?;
    let top_tasks = task_stmt
        .query_map([], |row| {
            Ok(TaskCostSummary {
                task_id: row.get(0)?,
                task_title: row.get(1)?,
                workspace_id: row.get(2)?,
                workspace_name: row.get(3)?,
                column_name: row.get(4)?,
                total_cost_usd: row.get(5)?,
                total_input_tokens: row.get(6)?,
                total_output_tokens: row.get(7)?,
                record_count: row.get(8)?,
            })
        })?
        .collect::<SqlResult<Vec<_>>>()?;

    let mut daily_stmt = conn.prepare(
        "SELECT
            substr(created_at, 1, 10) AS usage_date,
            COALESCE(SUM(cost_usd), 0.0) AS total_cost_usd,
            COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
            COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
            COUNT(*) AS record_count
        FROM usage_records
        GROUP BY usage_date
        ORDER BY usage_date ASC",
    )?;
    let daily = daily_stmt
        .query_map([], |row| {
            Ok(DailyCostSummary {
                date: row.get(0)?,
                total_cost_usd: row.get(1)?,
                total_input_tokens: row.get(2)?,
                total_output_tokens: row.get(3)?,
                record_count: row.get(4)?,
            })
        })?
        .collect::<SqlResult<Vec<_>>>()?;

    Ok(CostDashboard {
        total,
        workspaces,
        columns,
        top_tasks,
        daily,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn test_cost_dashboard_groups_usage_by_workspace_column_task_and_day() {
        let conn = crate::db::init_test().unwrap();
        let ws_a = crate::db::insert_workspace(&conn, "Alpha", "/tmp/alpha").unwrap();
        let ws_b = crate::db::insert_workspace(&conn, "Beta", "/tmp/beta").unwrap();
        let todo = crate::db::insert_column(&conn, &ws_a.id, "Todo", 0).unwrap();
        let done = crate::db::insert_column(&conn, &ws_b.id, "Done", 0).unwrap();
        let task_a = crate::db::insert_task(&conn, &ws_a.id, &todo.id, "Build API", None).unwrap();
        let task_b = crate::db::insert_task(&conn, &ws_b.id, &done.id, "Ship UI", None).unwrap();

        insert_usage_record(
            &conn,
            &ws_a.id,
            Some(&task_a.id),
            None,
            PROVIDER_ANTHROPIC,
            "claude-sonnet",
            100,
            50,
            1.25,
            Some("Todo"),
            30,
        )
        .unwrap();
        insert_usage_record(
            &conn,
            &ws_a.id,
            Some(&task_a.id),
            None,
            PROVIDER_ANTHROPIC,
            "claude-sonnet",
            200,
            75,
            2.75,
            Some("Todo"),
            40,
        )
        .unwrap();
        insert_usage_record(
            &conn,
            &ws_b.id,
            Some(&task_b.id),
            None,
            PROVIDER_ANTHROPIC,
            "claude-opus",
            300,
            100,
            5.0,
            Some("Done"),
            50,
        )
        .unwrap();

        let dashboard = get_cost_dashboard(&conn).unwrap();

        assert_eq!(dashboard.total.record_count, 3);
        assert!((dashboard.total.total_cost_usd - 9.0).abs() < 0.001);
        assert_eq!(dashboard.workspaces.len(), 2);
        assert_eq!(dashboard.workspaces[0].workspace_name, "Beta");
        assert!((dashboard.workspaces[0].total_cost_usd - 5.0).abs() < 0.001);
        assert_eq!(dashboard.columns.len(), 2);
        assert_eq!(dashboard.top_tasks[0].task_title, "Ship UI");
        assert_eq!(dashboard.top_tasks[1].task_title, "Build API");
        assert_eq!(dashboard.daily.len(), 1);
        assert_eq!(dashboard.daily[0].record_count, 3);
    }
}
