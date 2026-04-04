//! Pipeline Engine
//!
//! Handles column triggers and exit criteria evaluation.
//! When a task enters a column, the pipeline fires the column's trigger.
//! When exit criteria are met, the task auto-advances to the next column.

pub mod dependencies;
pub mod template;
pub mod triggers;

use crate::db::{self, Column, Task};
use crate::error::AppError;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

// ─── Pipeline State ─────────────────────────────────────────────────────────

/// Pipeline execution states for a task
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PipelineState {
    /// Task is idle, no trigger running
    Idle,
    /// Trigger has been fired, waiting for execution
    Triggered,
    /// Trigger is actively running (agent/script)
    Running,
    /// Evaluating exit criteria
    Evaluating,
    /// Task is advancing to next column
    Advancing,
}

impl PipelineState {
    pub fn as_str(&self) -> &'static str {
        match self {
            PipelineState::Idle => "idle",
            PipelineState::Triggered => "triggered",
            PipelineState::Running => "running",
            PipelineState::Evaluating => "evaluating",
            PipelineState::Advancing => "advancing",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "triggered" => PipelineState::Triggered,
            "running" => PipelineState::Running,
            "evaluating" => PipelineState::Evaluating,
            "advancing" => PipelineState::Advancing,
            _ => PipelineState::Idle,
        }
    }
}

// ─── Pipeline Events ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct PipelineEvent {
    pub task_id: String,
    pub column_id: String,
    pub event_type: String,
    pub state: String,
    pub message: Option<String>,
}

/// Global event emitted when tasks are mutated (created, moved, deleted) by the pipeline.
/// Frontend listens for this to re-fetch task store.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksChangedEvent {
    pub workspace_id: String,
    pub reason: String,
}

/// Emit a global tasks:changed event so the frontend re-fetches.
pub fn emit_tasks_changed(app: &AppHandle, workspace_id: &str, reason: &str) {
    let _ = app.emit("tasks:changed", &TasksChangedEvent {
        workspace_id: workspace_id.to_string(),
        reason: reason.to_string(),
    });
}

/// Payload sent to webhook URLs
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookPayload {
    pub event: String,
    pub task_id: String,
    pub task_title: String,
    pub task_description: Option<String>,
    pub column_id: String,
    pub column_name: String,
    pub workspace_id: String,
    pub pr_number: Option<i64>,
    pub pr_url: Option<String>,
    pub timestamp: String,
}

// ─── Pipeline Engine ────────────────────────────────────────────────────────

/// Fire the column trigger when a task enters.
/// Returns the updated task with pipeline state set.
/// Routes to V2 triggers if `column.triggers` is populated, otherwise falls back to legacy.
pub fn fire_trigger(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    column: &Column,
) -> Result<Task, AppError> {
    // Verify column still exists (may have been deleted while trigger was queued)
    if db::get_column(conn, &column.id).is_err() {
        log::warn!("Column {} deleted before trigger could fire for task {}", column.id, task.id);
        return Ok(task.clone());
    }

    // Check for V2 triggers
    if let Some(ref triggers_json) = column.triggers {
        if triggers_json != "{}" && !triggers_json.is_empty() {
            if let Ok(col_triggers) = serde_json::from_str::<triggers::ColumnTriggersV2>(triggers_json) {
                if col_triggers.on_entry.is_some() {
                    return triggers::fire_on_entry(conn, app, task, column, &col_triggers, None);
                }
            }
        }
    }

    // No trigger configured, stay idle
    Ok(task.clone())
}

/// Evaluate exit criteria for a task.
/// Returns true if exit criteria are met and task should advance.
pub fn evaluate_exit_criteria(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    column: &Column,
) -> Result<bool, AppError> {
    // Get exit criteria type from V2 triggers
    let exit_type = column
        .triggers
        .as_deref()
        .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
        .and_then(|v| v.get("exit_criteria")?.get("type")?.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "manual".to_string());

    // Set state to evaluating
    let _ = db::update_task_pipeline_state(
        conn,
        &task.id,
        PipelineState::Evaluating.as_str(),
        task.pipeline_triggered_at.as_deref(),
        None,
    );

    let _ = app.emit("pipeline:evaluating", &PipelineEvent {
        task_id: task.id.clone(),
        column_id: column.id.clone(),
        event_type: "evaluating".to_string(),
        state: PipelineState::Evaluating.as_str().to_string(),
        message: Some(format!("Exit type: {}", exit_type)),
    });

    let exit_met = match exit_type.as_str() {
        "manual" => {
            // Manual exit never auto-advances
            false
        }
        "agent_complete" => {
            // Check if agent linked to this task has completed
            if let Some(ref session_id) = task.agent_session_id {
                // Look up the agent session in the database
                match db::get_agent_session(conn, session_id) {
                    Ok(session) => {
                        // Agent is complete if status is "completed" or "stopped" with exit_code 0
                        session.status == "completed"
                            || (session.status == "stopped" && session.exit_code == Some(0))
                    }
                    Err(_) => {
                        // No DB session found — CLI trigger agents are tracked in-memory only.
                        // If mark_complete(success=true) was called, pipeline was running,
                        // so the agent has completed. Trust the caller.
                        task.pipeline_state == "running" || task.pipeline_state == "complete"
                    }
                }
            } else {
                false
            }
        }
        "script_success" => {
            // Check if script exited with code 0
            task.last_script_exit_code == Some(0)
        }
        "checklist_done" => {
            // Check if all checklist items are checked (using JSON parsing)
            // The task.checklist field contains inline JSON array of items with "checked" boolean
            if let Some(ref checklist_json) = task.checklist {
                // Parse checklist as JSON array
                #[derive(Deserialize)]
                struct ChecklistEntry {
                    #[serde(default)]
                    checked: bool,
                }
                match serde_json::from_str::<Vec<ChecklistEntry>>(checklist_json) {
                    Ok(items) => {
                        // All items must be checked (and there must be at least one item)
                        !items.is_empty() && items.iter().all(|item| item.checked)
                    }
                    Err(_) => false, // Invalid JSON, treat as not done
                }
            } else {
                false // No checklist, not done
            }
        }
        "time_elapsed" => {
            // Check if N seconds have passed since pipeline was triggered
            // Default timeout is 300 seconds (5 minutes)
            let timeout_secs = column
                .triggers
                .as_deref()
                .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
                .and_then(|v| v.get("exit_criteria")?.get("timeout")?.as_u64())
                .unwrap_or(300);
            if let Some(ref triggered_at) = task.pipeline_triggered_at {
                // Parse triggered_at as ISO 8601 timestamp
                if let Ok(triggered_time) = chrono::DateTime::parse_from_rfc3339(triggered_at) {
                    let now = chrono::Utc::now();
                    let elapsed = now.signed_duration_since(triggered_time);
                    elapsed.num_seconds() >= timeout_secs as i64
                } else {
                    false // Invalid timestamp format
                }
            } else {
                false // No trigger time recorded
            }
        }
        "pr_approved" => {
            // Check if PR has been approved via gh CLI
            if let Some(pr_number) = task.pr_number {
                // Get workspace to find repo_path
                if let Ok(workspace) = db::get_workspace(conn, &task.workspace_id) {
                    // Run gh pr view to check review decision
                    let output = std::process::Command::new("gh")
                        .args([
                            "pr", "view",
                            &pr_number.to_string(),
                            "--json", "reviewDecision",
                        ])
                        .current_dir(&workspace.repo_path)
                        .output();

                    if let Ok(output) = output {
                        if output.status.success() {
                            #[derive(serde::Deserialize)]
                            #[serde(rename_all = "camelCase")]
                            struct PrReview {
                                review_decision: Option<String>,
                            }

                            if let Ok(pr_review) = serde_json::from_slice::<PrReview>(&output.stdout) {
                                pr_review.review_decision.as_deref() == Some("APPROVED")
                            } else {
                                false
                            }
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                } else {
                    false
                }
            } else {
                false
            }
        }
        "manual_approval" => {
            // Check if review_status is "approved"
            task.review_status.as_deref() == Some("approved")
        }
        "notification_sent" => {
            // Check if notification has been marked as sent
            task.notification_sent_at.is_some()
        }
        _ => false,
    };

    if exit_met {
        let _ = app.emit("pipeline:exit_met", &PipelineEvent {
            task_id: task.id.clone(),
            column_id: column.id.clone(),
            event_type: "exit_met".to_string(),
            state: PipelineState::Evaluating.as_str().to_string(),
            message: Some(format!("Exit criteria met: {}", exit_type)),
        });
    }

    // Reset state to running or idle
    let new_state = if exit_met {
        PipelineState::Idle
    } else if PipelineState::from_str(&task.pipeline_state) == PipelineState::Running {
        PipelineState::Running
    } else {
        PipelineState::Idle
    };

    let _ = db::update_task_pipeline_state(
        conn,
        &task.id,
        new_state.as_str(),
        task.pipeline_triggered_at.as_deref(),
        None,
    );

    Ok(exit_met)
}

/// Auto-advance a task to the next column if criteria are met.
/// Returns the updated task if advanced, or None if no advancement.
pub fn try_auto_advance(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    current_column: &Column,
) -> Result<Option<Task>, AppError> {
    // Check if auto-advance is enabled via V2 triggers
    let auto_advance = current_column
        .triggers
        .as_deref()
        .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
        .and_then(|v| v.get("exit_criteria")?.get("auto_advance")?.as_bool())
        .unwrap_or(false);

    if !auto_advance {
        return Ok(None);
    }

    // Evaluate exit criteria
    let exit_met = evaluate_exit_criteria(conn, app, task, current_column)?;
    if !exit_met {
        return Ok(None);
    }

    // Find next column
    let next_column = db::get_next_column(conn, &task.workspace_id, current_column.position)?;

    match next_column {
        Some(next_col) => {
            // Set state to advancing
            let _ = db::update_task_pipeline_state(
                conn,
                &task.id,
                PipelineState::Advancing.as_str(),
                None,
                None,
            );

            let _ = app.emit("pipeline:advancing", &PipelineEvent {
                task_id: task.id.clone(),
                column_id: current_column.id.clone(),
                event_type: "advancing".to_string(),
                state: PipelineState::Advancing.as_str().to_string(),
                message: Some(format!("Moving to column: {}", next_col.name)),
            });

            // Get next position in target column
            let max_pos: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
                    rusqlite::params![next_col.id],
                    |row| row.get(0),
                )
                .unwrap_or(-1);

            // Move task to next column
            let ts = db::now();
            conn.execute(
                "UPDATE tasks SET column_id = ?1, position = ?2, pipeline_state = 'idle', pipeline_triggered_at = NULL, updated_at = ?3 WHERE id = ?4",
                rusqlite::params![next_col.id, max_pos + 1, ts, task.id],
            ).map_err(AppError::from)?;

            let updated_task = db::get_task(conn, &task.id)?;

            let _ = app.emit("pipeline:advanced", &PipelineEvent {
                task_id: updated_task.id.clone(),
                column_id: next_col.id.clone(),
                event_type: "advanced".to_string(),
                state: PipelineState::Idle.as_str().to_string(),
                message: Some(format!("Moved from {} to {}", current_column.name, next_col.name)),
            });

            // Notify frontend that tasks changed
            emit_tasks_changed(app, &task.workspace_id, "pipeline_advanced");

            // Fire trigger on the new column
            let _ = fire_trigger(conn, app, &updated_task, &next_col)?;

            Ok(Some(db::get_task(conn, &task.id)?))
        }
        None => {
            // No next column, reset to idle
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

/// Handle trigger failure - set error state and emit event
pub fn handle_trigger_failure(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    column: &Column,
    error_message: &str,
) -> Result<Task, AppError> {
    let updated_task = db::update_task_pipeline_state(
        conn,
        &task.id,
        PipelineState::Idle.as_str(),
        task.pipeline_triggered_at.as_deref(),
        Some(error_message),
    )?;

    let _ = app.emit("pipeline:error", &PipelineEvent {
        task_id: task.id.clone(),
        column_id: column.id.clone(),
        event_type: "error".to_string(),
        state: PipelineState::Idle.as_str().to_string(),
        message: Some(error_message.to_string()),
    });

    Ok(updated_task)
}

/// Increment the retry_count for a task.
fn increment_retry_count(conn: &Connection, task_id: &str) -> Result<(), AppError> {
    conn.execute(
        "UPDATE tasks SET retry_count = retry_count + 1 WHERE id = ?1",
        rusqlite::params![task_id],
    ).map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

/// Mark a pipeline execution as complete (called when agent/script finishes)
pub fn mark_complete(
    conn: &Connection,
    app: &AppHandle,
    task_id: &str,
    success: bool,
) -> Result<Task, AppError> {
    let task = db::get_task(conn, task_id)?;
    let column = db::get_column(conn, &task.column_id)?;

    if success {
        // Reset retry count on success
        conn.execute(
            "UPDATE tasks SET retry_count = 0 WHERE id = ?1",
            rusqlite::params![task_id],
        ).map_err(|e| AppError::DatabaseError(e.to_string()))?;

        // Check dependents - tasks waiting on this one
        let _ = dependencies::check_dependents(conn, app, &task);

        // Try to auto-advance
        if let Some(advanced_task) = try_auto_advance(conn, app, &task, &column)? {
            return Ok(advanced_task);
        }
    } else {
        // Check if auto-retry is configured
        let max_retries = column
            .triggers
            .as_deref()
            .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
            .and_then(|v| v.get("exit_criteria")?.get("max_retries")?.as_u64())
            .unwrap_or(0) as i64;

        if max_retries > 0 && task.retry_count < max_retries {
            // Increment retry count
            increment_retry_count(conn, task_id)?;

            // Log the retry
            let retry_num = task.retry_count + 1;
            log::info!("[pipeline] Auto-retrying task {} (attempt {}/{})", task_id, retry_num, max_retries);

            let _ = app.emit("pipeline:error", &PipelineEvent {
                task_id: task_id.to_string(),
                column_id: column.id.clone(),
                event_type: "retry".to_string(),
                state: PipelineState::Idle.as_str().to_string(),
                message: Some(format!("Retrying ({}/{})", retry_num, max_retries)),
            });

            // Re-fire the trigger
            let updated_task = db::get_task(conn, task_id)?;
            return fire_trigger(conn, app, &updated_task, &column);
        }
    }

    // Reset to idle
    let updated_task = db::update_task_pipeline_state(
        conn,
        task_id,
        PipelineState::Idle.as_str(),
        None,
        if success { None } else { Some("Execution failed") },
    )?;

    let _ = app.emit("pipeline:complete", &PipelineEvent {
        task_id: task_id.to_string(),
        column_id: column.id.clone(),
        event_type: "complete".to_string(),
        state: PipelineState::Idle.as_str().to_string(),
        message: Some(if success { "Success" } else { "Failed" }.to_string()),
    });

    // Notify frontend that tasks changed
    emit_tasks_changed(app, &task.workspace_id, "pipeline_complete");

    Ok(updated_task)
}
