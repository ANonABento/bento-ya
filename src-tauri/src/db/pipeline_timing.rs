use rusqlite::{params, Connection, Result as SqlResult};

use super::models::{ColumnTimingAverage, PipelineTiming};
use super::{new_id, now};

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
pub fn get_pipeline_timing(
    conn: &Connection,
    task_id: &str,
) -> SqlResult<Vec<PipelineTiming>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, column_id, column_name, entered_at, exited_at, duration_seconds, success, retry_count
         FROM pipeline_timing WHERE task_id = ?1 ORDER BY entered_at ASC",
    )?;
    let rows = stmt.query_map(params![task_id], map_timing_row)?;
    rows.collect()
}

/// Get average timing per column for a workspace, filtered to the last 30 days.
pub fn get_average_pipeline_timing(
    conn: &Connection,
    workspace_id: &str,
) -> SqlResult<Vec<ColumnTimingAverage>> {
    let mut stmt = conn.prepare(
        "SELECT pt.column_id, pt.column_name,
                COALESCE(AVG(pt.duration_seconds), 0) as avg_duration,
                COUNT(*) as task_count,
                SUM(CASE WHEN pt.success = 1 THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN pt.success = 0 THEN 1 ELSE 0 END) as failure_count,
                CAST(COUNT(*) AS REAL) / 30.0 as throughput_per_day
         FROM pipeline_timing pt
         JOIN tasks t ON pt.task_id = t.id
         WHERE t.workspace_id = ?1
           AND pt.duration_seconds IS NOT NULL
           AND pt.exited_at >= datetime('now', '-30 days')
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
            throughput_per_day: row.get(6)?,
        })
    })?;
    rows.collect()
}
