use rusqlite::{params, Connection, Result as SqlResult};

use super::models::{ColumnMetrics, ColumnTimingAverage, PipelineTiming};
use super::{new_id, now};

const COLUMN_METRICS_WINDOW_DAYS: i64 = 30;

/// Map a database row to a PipelineTiming struct.
fn map_timing_row(row: &rusqlite::Row) -> rusqlite::Result<PipelineTiming> {
    Ok(PipelineTiming {
        id: row.get(0)?,
        task_id: row.get(1)?,
        column_id: row.get(2)?,
        column_name: row.get(3)?,
        entered_at: row.get(4)?,
        exited_at: row.get(5)?,
        duration_seconds: row.get(6)?,
        success: row.get::<_, Option<i64>>(7)?.map(|v| v != 0),
        retry_count: row.get(8)?,
    })
}

/// Insert a new timing record when a task enters a column.
pub fn insert_pipeline_timing(
    conn: &Connection,
    task_id: &str,
    column_id: &str,
    column_name: &str,
) -> SqlResult<PipelineTiming> {
    let id = new_id();
    let entered_at = now();

    conn.execute(
        "INSERT INTO pipeline_timing (id, task_id, column_id, column_name, entered_at, retry_count)
         VALUES (?1, ?2, ?3, ?4, ?5, 0)",
        params![id, task_id, column_id, column_name, entered_at],
    )?;

    conn.query_row(
        "SELECT id, task_id, column_id, column_name, entered_at, exited_at, duration_seconds, success, retry_count
         FROM pipeline_timing WHERE id = ?1",
        params![id],
        map_timing_row,
    )
}

/// Complete a timing record when a task exits a column.
/// Finds the open (exited_at IS NULL) timing record for the task+column.
pub fn complete_pipeline_timing(
    conn: &Connection,
    task_id: &str,
    column_id: &str,
    success: bool,
    retry_count: i64,
) -> SqlResult<Option<PipelineTiming>> {
    let exited_at = now();

    // Find the open timing record
    let timing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM pipeline_timing
             WHERE task_id = ?1 AND column_id = ?2 AND exited_at IS NULL
             ORDER BY entered_at DESC LIMIT 1",
            params![task_id, column_id],
            |row| row.get(0),
        )
        .ok();

    let Some(id) = timing_id else {
        return Ok(None);
    };

    // Calculate duration from entered_at
    conn.execute(
        "UPDATE pipeline_timing
         SET exited_at = ?1,
             duration_seconds = CAST((julianday(?1) - julianday(entered_at)) * 86400 AS INTEGER),
             success = ?2,
             retry_count = ?3
         WHERE id = ?4",
        params![exited_at, success as i64, retry_count, id],
    )?;

    conn.query_row(
        "SELECT id, task_id, column_id, column_name, entered_at, exited_at, duration_seconds, success, retry_count
         FROM pipeline_timing WHERE id = ?1",
        params![id],
        map_timing_row,
    )
    .map(Some)
}

/// Get all timing records for a specific task.
pub fn get_pipeline_timing(conn: &Connection, task_id: &str) -> SqlResult<Vec<PipelineTiming>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, column_id, column_name, entered_at, exited_at, duration_seconds, success, retry_count
         FROM pipeline_timing WHERE task_id = ?1 ORDER BY entered_at ASC",
    )?;
    let rows = stmt.query_map(params![task_id], map_timing_row)?;
    rows.collect()
}

/// Get average timing per column for a workspace.
pub fn get_average_pipeline_timing(
    conn: &Connection,
    workspace_id: &str,
) -> SqlResult<Vec<ColumnTimingAverage>> {
    let mut stmt = conn.prepare(
        "SELECT pt.column_id, pt.column_name,
                COALESCE(AVG(pt.duration_seconds), 0) as avg_duration,
                COUNT(*) as task_count,
                SUM(CASE WHEN pt.success = 1 THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN pt.success = 0 THEN 1 ELSE 0 END) as failure_count
         FROM pipeline_timing pt
         JOIN tasks t ON pt.task_id = t.id
         WHERE t.workspace_id = ?1 AND pt.duration_seconds IS NOT NULL
         GROUP BY pt.column_id, pt.column_name
         ORDER BY pt.column_name ASC",
    )?;
    let rows = stmt.query_map(params![workspace_id], |row| {
        Ok(ColumnTimingAverage {
            column_id: row.get(0)?,
            column_name: row.get(1)?,
            avg_duration_seconds: row.get(2)?,
            task_count: row.get(3)?,
            success_count: row.get(4)?,
            failure_count: row.get(5)?,
        })
    })?;
    rows.collect()
}

/// Get board header metrics for every column in a workspace.
pub fn get_column_metrics(conn: &Connection, workspace_id: &str) -> SqlResult<Vec<ColumnMetrics>> {
    let window_modifier = format!("-{COLUMN_METRICS_WINDOW_DAYS} days");
    let mut stmt = conn.prepare(
        "WITH timing_metrics AS (
             SELECT pt.column_id AS column_id,
                    COALESCE(AVG(pt.duration_seconds), 0) AS avg_duration,
                    COALESCE(SUM(CASE WHEN pt.success = 1 AND pt.retry_count = 0 THEN 1 ELSE 0 END), 0) AS success_count,
                    COALESCE(SUM(CASE WHEN pt.retry_count > 0 THEN 1 ELSE 0 END), 0) AS retry_count,
                    COUNT(pt.id) AS sample_count
             FROM pipeline_timing pt
             JOIN tasks t ON t.id = pt.task_id
             WHERE t.workspace_id = ?1
               AND pt.duration_seconds IS NOT NULL
               AND datetime(pt.exited_at) >= datetime('now', ?2)
             GROUP BY pt.column_id
         ),
         session_metrics AS (
             SELECT t.column_id AS column_id,
                    COALESCE(AVG(CAST((julianday(agent_sessions.updated_at) - julianday(agent_sessions.created_at)) * 86400 AS INTEGER)), 0) AS avg_duration,
                    COALESCE(SUM(CASE WHEN agent_sessions.exit_code = 0 AND t.retry_count = 0 THEN 1 ELSE 0 END), 0) AS success_count,
                    COALESCE(SUM(CASE WHEN t.retry_count > 0 OR agent_sessions.exit_code != 0 THEN 1 ELSE 0 END), 0) AS retry_count,
                    COUNT(agent_sessions.id) AS sample_count
             FROM agent_sessions
             JOIN tasks t ON t.id = agent_sessions.task_id
             WHERE t.workspace_id = ?1
               AND agent_sessions.exit_code IS NOT NULL
               AND datetime(agent_sessions.updated_at) >= datetime('now', ?2)
             GROUP BY t.column_id
         )
         SELECT c.id,
                c.name,
                CASE WHEN COALESCE(timing_metrics.sample_count, 0) > 0 THEN timing_metrics.avg_duration ELSE COALESCE(session_metrics.avg_duration, 0) END AS avg_duration,
                CASE WHEN COALESCE(timing_metrics.sample_count, 0) > 0 THEN timing_metrics.success_count ELSE COALESCE(session_metrics.success_count, 0) END AS success_count,
                CASE WHEN COALESCE(timing_metrics.sample_count, 0) > 0 THEN timing_metrics.retry_count ELSE COALESCE(session_metrics.retry_count, 0) END AS retry_count,
                CASE WHEN COALESCE(timing_metrics.sample_count, 0) > 0 THEN timing_metrics.sample_count ELSE COALESCE(session_metrics.sample_count, 0) END AS sample_count
         FROM columns c
         LEFT JOIN timing_metrics ON timing_metrics.column_id = c.id
         LEFT JOIN session_metrics ON session_metrics.column_id = c.id
         WHERE c.workspace_id = ?1
         ORDER BY c.position ASC",
    )?;
    let rows = stmt.query_map(params![workspace_id, window_modifier], |row| {
        let sample_count: i64 = row.get(5)?;
        let success_count: i64 = row.get(3)?;
        let success_rate = if sample_count > 0 {
            (success_count as f64 / sample_count as f64) * 100.0
        } else {
            0.0
        };

        Ok(ColumnMetrics {
            column_id: row.get(0)?,
            column_name: row.get(1)?,
            avg_duration_seconds: row.get(2)?,
            success_rate,
            throughput_per_day: (sample_count as f64) / (COLUMN_METRICS_WINDOW_DAYS as f64),
            sample_count,
            success_count,
            retry_count: row.get(4)?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{
        complete_pipeline_timing, init_test, insert_agent_session, insert_column,
        insert_pipeline_timing, insert_task, insert_workspace, now, update_task,
    };
    use chrono::{Duration, Utc};
    use rusqlite::params;

    #[test]
    fn column_metrics_include_empty_columns() {
        let conn = init_test().unwrap();
        let ws = insert_workspace(&conn, "WS", "/tmp").unwrap();
        let col = insert_column(&conn, &ws.id, "Backlog", 0).unwrap();

        let metrics = get_column_metrics(&conn, &ws.id).unwrap();

        assert_eq!(metrics.len(), 1);
        assert_eq!(metrics[0].column_id, col.id);
        assert_eq!(metrics[0].sample_count, 0);
        assert_eq!(metrics[0].success_rate, 0.0);
        assert_eq!(metrics[0].throughput_per_day, 0.0);
    }

    #[test]
    fn column_metrics_summarize_last_30_days() {
        let conn = init_test().unwrap();
        let ws = insert_workspace(&conn, "WS", "/tmp").unwrap();
        let col = insert_column(&conn, &ws.id, "Working", 0).unwrap();
        let task_a = insert_task(&conn, &ws.id, &col.id, "A", None).unwrap();
        let task_b = insert_task(&conn, &ws.id, &col.id, "B", None).unwrap();

        insert_pipeline_timing(&conn, &task_a.id, &col.id, &col.name).unwrap();
        complete_pipeline_timing(&conn, &task_a.id, &col.id, true, 0).unwrap();
        insert_pipeline_timing(&conn, &task_b.id, &col.id, &col.name).unwrap();
        complete_pipeline_timing(&conn, &task_b.id, &col.id, false, 1).unwrap();

        let metrics = get_column_metrics(&conn, &ws.id).unwrap();

        assert_eq!(metrics.len(), 1);
        assert_eq!(metrics[0].sample_count, 2);
        assert_eq!(metrics[0].success_count, 1);
        assert_eq!(metrics[0].retry_count, 1);
        assert_eq!(metrics[0].success_rate, 50.0);
        assert!((metrics[0].throughput_per_day - (2.0 / 30.0)).abs() < f64::EPSILON);
    }

    #[test]
    fn column_metrics_count_historical_timing_after_task_moves_columns() {
        let conn = init_test().unwrap();
        let ws = insert_workspace(&conn, "WS", "/tmp").unwrap();
        let working = insert_column(&conn, &ws.id, "Working", 0).unwrap();
        let done = insert_column(&conn, &ws.id, "Done", 1).unwrap();
        let task = insert_task(&conn, &ws.id, &working.id, "A", None).unwrap();

        insert_pipeline_timing(&conn, &task.id, &working.id, &working.name).unwrap();
        complete_pipeline_timing(&conn, &task.id, &working.id, true, 0).unwrap();
        update_task(
            &conn,
            &task.id,
            None,
            None,
            Some(&done.id),
            None,
            None,
            None,
        )
        .unwrap();

        let metrics = get_column_metrics(&conn, &ws.id).unwrap();
        let working_metrics = metrics
            .iter()
            .find(|metric| metric.column_id == working.id)
            .unwrap();
        let done_metrics = metrics
            .iter()
            .find(|metric| metric.column_id == done.id)
            .unwrap();

        assert_eq!(working_metrics.sample_count, 1);
        assert_eq!(working_metrics.success_count, 1);
        assert_eq!(working_metrics.success_rate, 100.0);
        assert_eq!(done_metrics.sample_count, 0);
    }

    #[test]
    fn column_metrics_ignore_samples_older_than_30_days() {
        let conn = init_test().unwrap();
        let ws = insert_workspace(&conn, "WS", "/tmp").unwrap();
        let col = insert_column(&conn, &ws.id, "Working", 0).unwrap();
        let old_task = insert_task(&conn, &ws.id, &col.id, "Old", None).unwrap();
        let recent_task = insert_task(&conn, &ws.id, &col.id, "Recent", None).unwrap();
        let old_entered_at = (Utc::now() - Duration::days(40)).to_rfc3339();
        let old_exited_at = (Utc::now() - Duration::days(39)).to_rfc3339();

        conn.execute(
            "INSERT INTO pipeline_timing
             (id, task_id, column_id, column_name, entered_at, exited_at, duration_seconds, success, retry_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 3600, 1, 0)",
            params![
                "old-timing",
                old_task.id,
                col.id,
                col.name,
                old_entered_at,
                old_exited_at,
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO pipeline_timing
             (id, task_id, column_id, column_name, entered_at, exited_at, duration_seconds, success, retry_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 120, 1, 0)",
            params![
                "recent-timing",
                recent_task.id,
                col.id,
                col.name,
                now(),
                now(),
            ],
        )
        .unwrap();

        let metrics = get_column_metrics(&conn, &ws.id).unwrap();

        assert_eq!(metrics.len(), 1);
        assert_eq!(metrics[0].sample_count, 1);
        assert_eq!(metrics[0].success_count, 1);
        assert_eq!(metrics[0].avg_duration_seconds, 120.0);
    }

    #[test]
    fn column_metrics_fall_back_to_completed_agent_sessions() {
        let conn = init_test().unwrap();
        let ws = insert_workspace(&conn, "WS", "/tmp").unwrap();
        let col = insert_column(&conn, &ws.id, "Working", 0).unwrap();
        let task = insert_task(&conn, &ws.id, &col.id, "A", None).unwrap();
        let session = insert_agent_session(&conn, &task.id, "codex", None).unwrap();

        conn.execute(
            "UPDATE agent_sessions
             SET exit_code = 0,
                 created_at = datetime('now', '-1 hour'),
                 updated_at = datetime('now')
             WHERE id = ?1",
            params![session.id],
        )
        .unwrap();

        let metrics = get_column_metrics(&conn, &ws.id).unwrap();

        assert_eq!(metrics.len(), 1);
        assert_eq!(metrics[0].sample_count, 1);
        assert_eq!(metrics[0].success_count, 1);
        assert_eq!(metrics[0].retry_count, 0);
        assert!((metrics[0].avg_duration_seconds - 3600.0).abs() <= 1.0);
    }
}
