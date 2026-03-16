//! V2 Trigger types and execution engine.
//!
//! Handles the new unified `triggers` JSON format on columns,
//! supporting spawn_cli, move_column, trigger_task actions.

use crate::db::{self, Column, Task};
use crate::error::AppError;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

use super::template::{self, TemplateContext};
use super::{PipelineEvent, PipelineState};

// ─── V2 Trigger Types ─────────────────────────────────────────────────────

/// V2 action types that a trigger can execute.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TriggerActionV2 {
    SpawnCli {
        #[serde(default)]
        cli: Option<String>,
        #[serde(default)]
        command: Option<String>,
        #[serde(default)]
        prompt_template: Option<String>,
        #[serde(default)]
        prompt: Option<String>,
        #[serde(default)]
        flags: Option<Vec<String>>,
        #[serde(default)]
        use_queue: Option<bool>,
    },
    MoveColumn {
        target: String,
    },
    TriggerTask {
        target_task: String,
        action: String,
        #[serde(default)]
        target_column: Option<String>,
        #[serde(default)]
        inject_prompt: Option<String>,
    },
    None,
}

/// Column-level triggers configuration (V2).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnTriggersV2 {
    pub on_entry: Option<TriggerActionV2>,
    pub on_exit: Option<TriggerActionV2>,
    pub exit_criteria: Option<ExitCriteriaV2>,
}

/// Exit criteria (V2 format).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExitCriteriaV2 {
    #[serde(rename = "type")]
    pub criteria_type: String,
    #[serde(default)]
    pub auto_advance: bool,
    #[serde(default)]
    pub timeout: Option<u64>,
}

/// Task-level trigger overrides.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TaskTriggerOverrides {
    #[serde(default)]
    pub on_entry: Option<serde_json::Value>,
    #[serde(default)]
    pub on_exit: Option<serde_json::Value>,
    #[serde(default)]
    pub skip_triggers: Option<bool>,
}

// ─── Events ────────────────────────────────────────────────────────────────

/// Event emitted when a spawn_cli trigger needs to execute.
/// Frontend listens for this and spawns the appropriate CLI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnCliEvent {
    pub task_id: String,
    pub column_id: String,
    pub workspace_id: String,
    pub cli_type: String,
    pub command: Option<String>,
    pub prompt: String,
    pub flags: Option<Vec<String>>,
    pub use_queue: bool,
}

// ─── Trigger Resolution ────────────────────────────────────────────────────

/// Resolve the effective trigger action for a given hook (on_entry/on_exit),
/// merging column defaults with task-level overrides.
fn resolve_trigger(
    column_triggers: &ColumnTriggersV2,
    task: &Task,
    hook: &str,
) -> Option<TriggerActionV2> {
    // Parse task overrides
    let overrides: TaskTriggerOverrides = task
        .trigger_overrides
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or_default();

    // Skip if task says so
    if overrides.skip_triggers == Some(true) {
        return Option::None;
    }

    // Get base action from column
    let base = match hook {
        "on_entry" => column_triggers.on_entry.clone(),
        "on_exit" => column_triggers.on_exit.clone(),
        _ => Option::None,
    };

    let base = base?;

    // Check if it's a None action
    if matches!(base, TriggerActionV2::None) {
        return Option::None;
    }

    // Apply task override if present
    let override_value = match hook {
        "on_entry" => overrides.on_entry,
        "on_exit" => overrides.on_exit,
        _ => Option::None,
    };

    if let Some(override_json) = override_value {
        // Merge: start with base serialized, then overlay override fields
        if let Ok(mut base_value) = serde_json::to_value(&base) {
            if let Some(base_obj) = base_value.as_object_mut() {
                if let Some(override_obj) = override_json.as_object() {
                    for (k, v) in override_obj {
                        base_obj.insert(k.clone(), v.clone());
                    }
                }
            }
            if let Ok(merged) = serde_json::from_value::<TriggerActionV2>(base_value) {
                return Some(merged);
            }
        }
    }

    Some(base)
}

// ─── Trigger Execution ─────────────────────────────────────────────────────

/// Fire the on_entry trigger for a column (V2 format).
pub fn fire_on_entry(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    column: &Column,
    triggers: &ColumnTriggersV2,
    prev_column: Option<&Column>,
) -> Result<Task, AppError> {
    let action = match resolve_trigger(triggers, task, "on_entry") {
        Some(a) => a,
        Option::None => return Ok(task.clone()),
    };

    let ts = db::now();

    // Set pipeline state to triggered
    let updated_task = db::update_task_pipeline_state(
        conn,
        &task.id,
        PipelineState::Triggered.as_str(),
        Some(&ts),
        Option::None,
    )?;

    let _ = app.emit(
        "pipeline:triggered",
        &PipelineEvent {
            task_id: task.id.clone(),
            column_id: column.id.clone(),
            event_type: "triggered".to_string(),
            state: PipelineState::Triggered.as_str().to_string(),
            message: Some("V2 trigger fired".to_string()),
        },
    );

    execute_action(conn, app, &updated_task, column, &action, prev_column)
}

/// Fire the on_exit trigger for a column (V2 format).
pub fn fire_on_exit(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    column: &Column,
    next_column: Option<&Column>,
) -> Result<(), AppError> {
    // Parse V2 triggers
    let triggers: ColumnTriggersV2 = column
        .triggers
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or(ColumnTriggersV2 {
            on_entry: Option::None,
            on_exit: Option::None,
            exit_criteria: Option::None,
        });

    let action = match resolve_trigger(&triggers, task, "on_exit") {
        Some(a) => a,
        Option::None => return Ok(()),
    };

    let _ = execute_action(conn, app, task, column, &action, next_column);

    // Check dependents after exit
    let _ = super::dependencies::check_dependents(conn, app, task);

    Ok(())
}

/// Execute a trigger action.
fn execute_action(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    column: &Column,
    action: &TriggerActionV2,
    other_column: Option<&Column>,
) -> Result<Task, AppError> {
    match action {
        TriggerActionV2::SpawnCli {
            cli,
            command,
            prompt_template,
            prompt,
            flags,
            use_queue,
        } => {
            // Build template context
            let workspace = db::get_workspace(conn, &task.workspace_id)?;

            let ctx = TemplateContext {
                task,
                column,
                workspace: &workspace,
                prev_column: other_column,
                next_column: Option::None,
                dep_tasks: HashMap::new(),
            };

            // Resolve prompt: direct prompt wins over template
            let resolved_prompt = if let Some(p) = prompt {
                if !p.is_empty() {
                    template::interpolate(p, &ctx)
                } else if let Some(tmpl) = prompt_template {
                    template::interpolate(tmpl, &ctx)
                } else {
                    format!("{}\n\n{}", task.title, task.description.as_deref().unwrap_or(""))
                }
            } else if let Some(tmpl) = prompt_template {
                template::interpolate(tmpl, &ctx)
            } else {
                // Default prompt
                format!("{}\n\n{}", task.title, task.description.as_deref().unwrap_or(""))
            };

            let cli_type = cli.as_deref().unwrap_or("claude").to_string();

            // Emit spawn_cli event for frontend
            let event = SpawnCliEvent {
                task_id: task.id.clone(),
                column_id: column.id.clone(),
                workspace_id: task.workspace_id.clone(),
                cli_type: cli_type.clone(),
                command: command.clone(),
                prompt: resolved_prompt,
                flags: flags.clone(),
                use_queue: use_queue.unwrap_or(true),
            };
            let _ = app.emit("pipeline:spawn_cli", &event);

            Ok(task.clone())
        }

        TriggerActionV2::MoveColumn { target } => {
            let target_col = resolve_column_target(conn, task, target)?;
            if let Some(col) = target_col {
                let ts = db::now();
                let max_pos: i64 = conn
                    .query_row(
                        "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
                        rusqlite::params![col.id],
                        |row| row.get(0),
                    )
                    .unwrap_or(-1);

                conn.execute(
                    "UPDATE tasks SET column_id = ?1, position = ?2, pipeline_state = 'idle', updated_at = ?3 WHERE id = ?4",
                    rusqlite::params![col.id, max_pos + 1, ts, task.id],
                )
                .map_err(AppError::from)?;

                let _ = app.emit(
                    "pipeline:advanced",
                    &PipelineEvent {
                        task_id: task.id.clone(),
                        column_id: col.id.clone(),
                        event_type: "advanced".to_string(),
                        state: "idle".to_string(),
                        message: Some(format!("Moved to {}", col.name)),
                    },
                );

                let moved_task = db::get_task(conn, &task.id)?;
                // Fire on_entry on the new column
                let _ = super::fire_trigger(conn, app, &moved_task, &col);
                return Ok(db::get_task(conn, &task.id)?);
            }
            Ok(task.clone())
        }

        TriggerActionV2::TriggerTask {
            target_task,
            action: task_action,
            target_column,
            inject_prompt,
        } => {
            // Look up target task
            if let Ok(target) = db::get_task(conn, target_task) {
                match task_action.as_str() {
                    "move_column" => {
                        if let Some(col_target) = target_column {
                            let col = resolve_column_target(conn, &target, col_target)?;
                            if let Some(col) = col {
                                let ts = db::now();
                                let max_pos: i64 = conn
                                    .query_row(
                                        "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
                                        rusqlite::params![col.id],
                                        |row| row.get(0),
                                    )
                                    .unwrap_or(-1);

                                conn.execute(
                                    "UPDATE tasks SET column_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
                                    rusqlite::params![col.id, max_pos + 1, ts, target.id],
                                )
                                .map_err(AppError::from)?;
                            }
                        }
                    }
                    "unblock" => {
                        // Unblock the target task
                        conn.execute(
                            "UPDATE tasks SET blocked = 0, updated_at = ?1 WHERE id = ?2",
                            rusqlite::params![db::now(), target.id],
                        )
                        .map_err(AppError::from)?;
                    }
                    "start" => {
                        // Fire trigger on the target task's current column
                        let col = db::get_column(conn, &target.column_id)?;
                        let _ = super::fire_trigger(conn, app, &target, &col);
                    }
                    _ => {}
                }

                // Inject prompt if specified
                if let Some(inject) = inject_prompt {
                    let workspace = db::get_workspace(conn, &task.workspace_id)?;
                    let ctx = TemplateContext {
                        task,
                        column,
                        workspace: &workspace,
                        prev_column: Option::None,
                        next_column: Option::None,
                        dep_tasks: HashMap::new(),
                    };
                    let resolved = template::interpolate(inject, &ctx);
                    conn.execute(
                        "UPDATE tasks SET trigger_prompt = ?1, updated_at = ?2 WHERE id = ?3",
                        rusqlite::params![resolved, db::now(), target.id],
                    )
                    .map_err(AppError::from)?;
                }
            }
            Ok(task.clone())
        }

        TriggerActionV2::None => Ok(task.clone()),
    }
}

// Note: dependency task interpolation ({dep.<id>.title}) is handled at the
// dependency resolution level in dependencies.rs, not here.

/// Resolve a column target string to a Column.
fn resolve_column_target(
    conn: &Connection,
    task: &Task,
    target: &str,
) -> Result<Option<Column>, AppError> {
    let current_col = db::get_column(conn, &task.column_id)?;

    match target {
        "next" => Ok(db::get_next_column(conn, &task.workspace_id, current_col.position)?),
        "previous" => {
            if current_col.position > 0 {
                let cols = db::list_columns(conn, &task.workspace_id)?;
                Ok(cols
                    .into_iter()
                    .find(|c| c.position == current_col.position - 1))
            } else {
                Ok(Option::None)
            }
        }
        col_id => Ok(db::get_column(conn, col_id).ok()),
    }
}
