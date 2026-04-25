use crate::db::{self, Column, Task};
use crate::error::AppError;
use rusqlite::Connection;
use tauri::AppHandle;

use super::events::{emit_pipeline, emit_tasks_changed};
use super::exit::{evaluate_exit_criteria, parse_trigger_field_bool};
use super::state::PipelineState;
use super::triggers;

/// Fire the column trigger when a task enters.
/// Returns the updated task with pipeline state set.
/// Routes to V2 triggers if `column.triggers` is populated, otherwise falls back to idle.
pub fn fire_trigger(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    column: &Column,
) -> Result<Task, AppError> {
    if db::get_column(conn, &column.id).is_err() {
        log::warn!(
            "Column {} deleted before trigger could fire for task {}",
            column.id,
            task.id
        );
        return Ok(task.clone());
    }

    if let Err(e) = db::insert_pipeline_timing(conn, &task.id, &column.id, &column.name) {
        log::warn!(
            "Failed to insert pipeline timing for task {}: {}",
            task.id,
            e
        );
    }

    let col_triggers = triggers::parse_column_triggers(column.triggers.as_deref());
    if col_triggers.on_entry.is_some() {
        return triggers::fire_on_entry(conn, app, task, column, &col_triggers, None);
    }

    Ok(task.clone())
}

/// Auto-advance a task to the next column if criteria are met.
/// Returns the updated task if advanced, or `None` if no advancement happened.
pub fn try_auto_advance(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    current_column: &Column,
) -> Result<Option<Task>, AppError> {
    if let Ok(workspace) = db::get_workspace(conn, &task.workspace_id) {
        if let Ok(cfg) = serde_json::from_str::<serde_json::Value>(&workspace.config) {
            if let Some(false) = cfg.get("autoAdvance").and_then(|v| v.as_bool()) {
                return Ok(None);
            }
        }
    }

    let auto_advance = parse_trigger_field_bool(current_column.triggers.as_deref(), "auto_advance");
    if !auto_advance {
        return Ok(None);
    }

    let exit_met = evaluate_exit_criteria(conn, app, task, current_column)?;
    if !exit_met {
        return Ok(None);
    }

    let next_column = db::get_next_column(conn, &task.workspace_id, current_column.position)?;

    match next_column {
        Some(next_col) => {
            let _ = db::update_task_pipeline_state(
                conn,
                &task.id,
                PipelineState::Advancing.as_str(),
                None,
                None,
            );

            emit_pipeline(
                app,
                "pipeline:advancing",
                &task.id,
                &current_column.id,
                PipelineState::Advancing,
                Some(format!("Moving to column: {}", next_col.name)),
            );

            let max_pos: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
                    rusqlite::params![next_col.id],
                    |row| row.get(0),
                )
                .unwrap_or(-1);

            let ts = db::now();
            conn.execute(
                "UPDATE tasks SET column_id = ?1, position = ?2, pipeline_state = 'idle', pipeline_triggered_at = NULL, updated_at = ?3 WHERE id = ?4",
                rusqlite::params![next_col.id, max_pos + 1, ts, task.id],
            ).map_err(AppError::from)?;

            let updated_task = db::get_task(conn, &task.id)?;

            emit_pipeline(
                app,
                "pipeline:advanced",
                &updated_task.id,
                &next_col.id,
                PipelineState::Idle,
                Some(format!(
                    "Moved from {} to {}",
                    current_column.name, next_col.name
                )),
            );
            emit_tasks_changed(app, &task.workspace_id, "pipeline_advanced");

            let _ = fire_trigger(conn, app, &updated_task, &next_col)?;
            Ok(Some(db::get_task(conn, &task.id)?))
        }
        None => {
            let task = db::update_task_pipeline_state(
                conn,
                &task.id,
                PipelineState::Idle.as_str(),
                None,
                None,
            )?;
            Ok(Some(task))
        }
    }
}
