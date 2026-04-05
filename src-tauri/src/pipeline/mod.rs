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

// ─── Pure Decision Functions (testable without AppHandle) ──────────────────

/// What to do when a pipeline execution completes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompletionAction {
    /// Success + auto-advance enabled → move to next column
    Advance,
    /// Failure + retries remaining → retry the trigger
    Retry { attempt: i64, max: i64 },
    /// Success, no auto-advance → stay in column, idle
    Complete,
    /// Failure, no retries left → stay in column, set error
    Failed,
}

/// Pure decision: given task state and column triggers, what should happen on completion?
pub fn decide_completion(
    task: &Task,
    triggers_json: Option<&str>,
    success: bool,
) -> CompletionAction {
    if success {
        let auto_advance = parse_trigger_field_bool(triggers_json, "auto_advance");
        if auto_advance {
            return CompletionAction::Advance;
        }
        return CompletionAction::Complete;
    }

    // Failure path
    let max_retries = parse_trigger_field_u64(triggers_json, "max_retries") as i64;
    if max_retries > 0 && task.retry_count < max_retries {
        CompletionAction::Retry {
            attempt: task.retry_count + 1,
            max: max_retries,
        }
    } else {
        CompletionAction::Failed
    }
}

/// Pure decision: is the exit criteria met for a given task?
///
/// Handles all exit types except `pr_approved` (needs external `gh` call)
/// and `agent_complete` with DB session (needs DB lookup).
/// Those cases return `None` to signal the caller should check externally.
pub fn check_exit_met(task: &Task, exit_type: &str) -> Option<bool> {
    match exit_type {
        "manual" => Some(false),
        "script_success" => Some(task.last_script_exit_code == Some(0)),
        "checklist_done" => {
            if let Some(ref checklist_json) = task.checklist {
                #[derive(Deserialize)]
                struct Entry {
                    #[serde(default)]
                    checked: bool,
                }
                match serde_json::from_str::<Vec<Entry>>(checklist_json) {
                    Ok(items) => Some(!items.is_empty() && items.iter().all(|e| e.checked)),
                    Err(_) => Some(false),
                }
            } else {
                Some(false)
            }
        }
        "manual_approval" => Some(task.review_status.as_deref() == Some("approved")),
        "notification_sent" => Some(task.notification_sent_at.is_some()),
        "agent_complete" => {
            // If no session ID, check pipeline state as fallback
            if task.agent_session_id.is_none() {
                Some(task.pipeline_state == "running" || task.pipeline_state == "complete")
            } else {
                None // Needs DB lookup — caller handles
            }
        }
        // pr_approved and time_elapsed need external resources — caller handles
        _ => None,
    }
}

/// Parse the exit_criteria type from a column's triggers JSON.
pub fn parse_exit_type(triggers_json: Option<&str>) -> String {
    triggers_json
        .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
        .and_then(|v| v.get("exit_criteria")?.get("type")?.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "manual".to_string())
}

/// Parse a boolean field from exit_criteria in triggers JSON.
fn parse_trigger_field_bool(triggers_json: Option<&str>, field: &str) -> bool {
    triggers_json
        .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
        .and_then(|v| v.get("exit_criteria")?.get(field)?.as_bool())
        .unwrap_or(false)
}

/// Parse a u64 field from exit_criteria in triggers JSON.
fn parse_trigger_field_u64(triggers_json: Option<&str>, field: &str) -> u64 {
    triggers_json
        .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
        .and_then(|v| v.get("exit_criteria")?.get(field)?.as_u64())
        .unwrap_or(0)
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
    let exit_type = parse_exit_type(column.triggers.as_deref());

    // Set state to evaluating
    let _ = db::update_task_pipeline_state(
        conn, &task.id, PipelineState::Evaluating.as_str(),
        task.pipeline_triggered_at.as_deref(), None,
    );

    let _ = app.emit("pipeline:evaluating", &PipelineEvent {
        task_id: task.id.clone(),
        column_id: column.id.clone(),
        event_type: "evaluating".to_string(),
        state: PipelineState::Evaluating.as_str().to_string(),
        message: Some(format!("Exit type: {}", exit_type)),
    });

    // Try pure check first, fall back to external checks
    let exit_met = match check_exit_met(task, &exit_type) {
        Some(result) => result,
        None => {
            // Needs external resources — handle here
            match exit_type.as_str() {
                "agent_complete" => {
                    // Has session ID — needs DB lookup
                    if let Some(ref session_id) = task.agent_session_id {
                        match db::get_agent_session(conn, session_id) {
                            Ok(session) => {
                                session.status == "completed"
                                    || (session.status == "stopped" && session.exit_code == Some(0))
                            }
                            Err(_) => {
                                task.pipeline_state == "running" || task.pipeline_state == "complete"
                            }
                        }
                    } else {
                        false
                    }
                }
                "time_elapsed" => {
                    let timeout_secs = parse_trigger_field_u64(column.triggers.as_deref(), "timeout");
                    let timeout_secs = if timeout_secs == 0 { 300 } else { timeout_secs };
                    if let Some(ref triggered_at) = task.pipeline_triggered_at {
                        if let Ok(triggered_time) = chrono::DateTime::parse_from_rfc3339(triggered_at) {
                            let elapsed = chrono::Utc::now().signed_duration_since(triggered_time);
                            elapsed.num_seconds() >= timeout_secs as i64
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                }
                "pr_approved" => {
                    if let Some(pr_number) = task.pr_number {
                        if let Ok(workspace) = db::get_workspace(conn, &task.workspace_id) {
                            let output = std::process::Command::new("gh")
                                .args(["pr", "view", &pr_number.to_string(), "--json", "reviewDecision"])
                                .current_dir(&workspace.repo_path)
                                .output();
                            if let Ok(output) = output {
                                if output.status.success() {
                                    #[derive(serde::Deserialize)]
                                    #[serde(rename_all = "camelCase")]
                                    struct PrReview { review_decision: Option<String> }
                                    serde_json::from_slice::<PrReview>(&output.stdout)
                                        .map(|pr| pr.review_decision.as_deref() == Some("APPROVED"))
                                        .unwrap_or(false)
                                } else { false }
                            } else { false }
                        } else { false }
                    } else { false }
                }
                _ => false,
            }
        }
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
        conn, &task.id, new_state.as_str(),
        task.pipeline_triggered_at.as_deref(), None,
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
    let auto_advance = parse_trigger_field_bool(current_column.triggers.as_deref(), "auto_advance");

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

    let action = decide_completion(&task, column.triggers.as_deref(), success);

    match action {
        CompletionAction::Advance => {
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

            // Auto-advance not possible (no next column), fall through to complete
            let updated_task = db::update_task_pipeline_state(
                conn, task_id, PipelineState::Idle.as_str(), None, None,
            )?;
            emit_completion_event(app, task_id, &column.id, &task.workspace_id, true);
            Ok(updated_task)
        }
        CompletionAction::Complete => {
            // Reset retry count on success
            conn.execute(
                "UPDATE tasks SET retry_count = 0 WHERE id = ?1",
                rusqlite::params![task_id],
            ).map_err(|e| AppError::DatabaseError(e.to_string()))?;

            // Check dependents
            let _ = dependencies::check_dependents(conn, app, &task);

            let updated_task = db::update_task_pipeline_state(
                conn, task_id, PipelineState::Idle.as_str(), None, None,
            )?;
            emit_completion_event(app, task_id, &column.id, &task.workspace_id, true);
            Ok(updated_task)
        }
        CompletionAction::Retry { attempt, max } => {
            increment_retry_count(conn, task_id)?;
            log::info!("[pipeline] Auto-retrying task {} (attempt {}/{})", task_id, attempt, max);

            let _ = app.emit("pipeline:error", &PipelineEvent {
                task_id: task_id.to_string(),
                column_id: column.id.clone(),
                event_type: "retry".to_string(),
                state: PipelineState::Idle.as_str().to_string(),
                message: Some(format!("Retrying ({}/{})", attempt, max)),
            });

            let updated_task = db::get_task(conn, task_id)?;
            fire_trigger(conn, app, &updated_task, &column)
        }
        CompletionAction::Failed => {
            let updated_task = db::update_task_pipeline_state(
                conn, task_id, PipelineState::Idle.as_str(), None, Some("Execution failed"),
            )?;
            emit_completion_event(app, task_id, &column.id, &task.workspace_id, false);
            Ok(updated_task)
        }
    }
}

fn emit_completion_event(app: &AppHandle, task_id: &str, column_id: &str, workspace_id: &str, success: bool) {
    let _ = app.emit("pipeline:complete", &PipelineEvent {
        task_id: task_id.to_string(),
        column_id: column_id.to_string(),
        event_type: "complete".to_string(),
        state: PipelineState::Idle.as_str().to_string(),
        message: Some(if success { "Success" } else { "Failed" }.to_string()),
    });
    emit_tasks_changed(app, workspace_id, "pipeline_complete");
}

// ─── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    /// Create a minimal task for testing decision logic.
    fn make_task(retry_count: i64, pipeline_state: &str) -> Task {
        Task {
            id: "task-1".into(),
            workspace_id: "ws-1".into(),
            column_id: "col-1".into(),
            title: "Test Task".into(),
            description: None,
            position: 0,
            priority: "medium".into(),
            agent_mode: None,
            agent_status: None,
            queued_at: None,
            branch_name: None,
            files_touched: "[]".into(),
            checklist: None,
            pipeline_state: pipeline_state.into(),
            pipeline_triggered_at: None,
            pipeline_error: None,
            retry_count,
            model: None,
            agent_session_id: None,
            last_script_exit_code: None,
            review_status: None,
            pr_number: None,
            pr_url: None,
            siege_iteration: 0,
            siege_active: false,
            siege_max_iterations: 5,
            siege_last_checked: None,
            pr_mergeable: None,
            pr_ci_status: None,
            pr_review_decision: None,
            pr_comment_count: 0,
            pr_is_draft: false,
            pr_labels: "[]".into(),
            pr_last_fetched: None,
            pr_head_sha: None,
            notify_stakeholders: None,
            notification_sent_at: None,
            trigger_overrides: None,
            trigger_prompt: None,
            last_output: None,
            dependencies: None,
            blocked: false,
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
        }
    }

    fn triggers_json(auto_advance: bool, max_retries: u64) -> String {
        serde_json::json!({
            "exit_criteria": {
                "type": "agent_complete",
                "auto_advance": auto_advance,
                "max_retries": max_retries
            }
        }).to_string()
    }

    // ─── decide_completion tests ──────────────────────────────────────

    #[test]
    fn test_decide_success_no_auto_advance() {
        let task = make_task(0, "running");
        let triggers = triggers_json(false, 0);
        let action = decide_completion(&task, Some(&triggers), true);
        assert_eq!(action, CompletionAction::Complete);
    }

    #[test]
    fn test_decide_success_with_auto_advance() {
        let task = make_task(0, "running");
        let triggers = triggers_json(true, 0);
        let action = decide_completion(&task, Some(&triggers), true);
        assert_eq!(action, CompletionAction::Advance);
    }

    #[test]
    fn test_decide_failure_no_retries() {
        let task = make_task(0, "running");
        let triggers = triggers_json(false, 0);
        let action = decide_completion(&task, Some(&triggers), false);
        assert_eq!(action, CompletionAction::Failed);
    }

    #[test]
    fn test_decide_failure_with_retries_remaining() {
        let task = make_task(1, "running");
        let triggers = triggers_json(false, 3);
        let action = decide_completion(&task, Some(&triggers), false);
        assert_eq!(action, CompletionAction::Retry { attempt: 2, max: 3 });
    }

    #[test]
    fn test_decide_failure_retries_exhausted() {
        let task = make_task(3, "running");
        let triggers = triggers_json(false, 3);
        let action = decide_completion(&task, Some(&triggers), false);
        assert_eq!(action, CompletionAction::Failed);
    }

    #[test]
    fn test_decide_failure_first_retry() {
        let task = make_task(0, "running");
        let triggers = triggers_json(false, 2);
        let action = decide_completion(&task, Some(&triggers), false);
        assert_eq!(action, CompletionAction::Retry { attempt: 1, max: 2 });
    }

    #[test]
    fn test_decide_no_triggers_json() {
        let task = make_task(0, "running");
        // No triggers configured at all
        let action = decide_completion(&task, None, true);
        assert_eq!(action, CompletionAction::Complete);
    }

    #[test]
    fn test_decide_empty_triggers_json() {
        let task = make_task(0, "running");
        let action = decide_completion(&task, Some("{}"), false);
        assert_eq!(action, CompletionAction::Failed);
    }

    // ─── check_exit_met tests ─────────────────────────────────────────

    #[test]
    fn test_exit_manual_never_met() {
        let task = make_task(0, "running");
        assert_eq!(check_exit_met(&task, "manual"), Some(false));
    }

    #[test]
    fn test_exit_script_success_met() {
        let mut task = make_task(0, "running");
        task.last_script_exit_code = Some(0);
        assert_eq!(check_exit_met(&task, "script_success"), Some(true));
    }

    #[test]
    fn test_exit_script_success_not_met() {
        let mut task = make_task(0, "running");
        task.last_script_exit_code = Some(1);
        assert_eq!(check_exit_met(&task, "script_success"), Some(false));
    }

    #[test]
    fn test_exit_script_success_no_code() {
        let task = make_task(0, "running");
        assert_eq!(check_exit_met(&task, "script_success"), Some(false));
    }

    #[test]
    fn test_exit_checklist_all_checked() {
        let mut task = make_task(0, "running");
        task.checklist = Some(r#"[{"checked":true},{"checked":true}]"#.into());
        assert_eq!(check_exit_met(&task, "checklist_done"), Some(true));
    }

    #[test]
    fn test_exit_checklist_partial() {
        let mut task = make_task(0, "running");
        task.checklist = Some(r#"[{"checked":true},{"checked":false}]"#.into());
        assert_eq!(check_exit_met(&task, "checklist_done"), Some(false));
    }

    #[test]
    fn test_exit_checklist_empty() {
        let mut task = make_task(0, "running");
        task.checklist = Some("[]".into());
        assert_eq!(check_exit_met(&task, "checklist_done"), Some(false));
    }

    #[test]
    fn test_exit_checklist_no_checklist() {
        let task = make_task(0, "running");
        assert_eq!(check_exit_met(&task, "checklist_done"), Some(false));
    }

    #[test]
    fn test_exit_checklist_invalid_json() {
        let mut task = make_task(0, "running");
        task.checklist = Some("not json".into());
        assert_eq!(check_exit_met(&task, "checklist_done"), Some(false));
    }

    #[test]
    fn test_exit_manual_approval_approved() {
        let mut task = make_task(0, "running");
        task.review_status = Some("approved".into());
        assert_eq!(check_exit_met(&task, "manual_approval"), Some(true));
    }

    #[test]
    fn test_exit_manual_approval_rejected() {
        let mut task = make_task(0, "running");
        task.review_status = Some("rejected".into());
        assert_eq!(check_exit_met(&task, "manual_approval"), Some(false));
    }

    #[test]
    fn test_exit_manual_approval_none() {
        let task = make_task(0, "running");
        assert_eq!(check_exit_met(&task, "manual_approval"), Some(false));
    }

    #[test]
    fn test_exit_notification_sent() {
        let mut task = make_task(0, "running");
        task.notification_sent_at = Some("2024-01-01T00:00:00Z".into());
        assert_eq!(check_exit_met(&task, "notification_sent"), Some(true));
    }

    #[test]
    fn test_exit_notification_not_sent() {
        let task = make_task(0, "running");
        assert_eq!(check_exit_met(&task, "notification_sent"), Some(false));
    }

    #[test]
    fn test_exit_agent_complete_no_session_running() {
        let mut task = make_task(0, "running");
        task.agent_session_id = None;
        assert_eq!(check_exit_met(&task, "agent_complete"), Some(true));
    }

    #[test]
    fn test_exit_agent_complete_no_session_idle() {
        let mut task = make_task(0, "idle");
        task.agent_session_id = None;
        assert_eq!(check_exit_met(&task, "agent_complete"), Some(false));
    }

    #[test]
    fn test_exit_agent_complete_with_session_needs_db() {
        let mut task = make_task(0, "running");
        task.agent_session_id = Some("session-123".into());
        // Returns None because it needs a DB lookup
        assert_eq!(check_exit_met(&task, "agent_complete"), None);
    }

    #[test]
    fn test_exit_pr_approved_needs_external() {
        let task = make_task(0, "running");
        assert_eq!(check_exit_met(&task, "pr_approved"), None);
    }

    #[test]
    fn test_exit_unknown_type_needs_external() {
        let task = make_task(0, "running");
        assert_eq!(check_exit_met(&task, "some_future_type"), None);
    }

    // ─── parse_exit_type tests ────────────────────────────────────────

    #[test]
    fn test_parse_exit_type_present() {
        let json = r#"{"exit_criteria":{"type":"script_success"}}"#;
        assert_eq!(parse_exit_type(Some(json)), "script_success");
    }

    #[test]
    fn test_parse_exit_type_missing() {
        assert_eq!(parse_exit_type(None), "manual");
        assert_eq!(parse_exit_type(Some("{}")), "manual");
    }

    // ─── PipelineState tests ──────────────────────────────────────────

    #[test]
    fn test_pipeline_state_roundtrip() {
        for state in [PipelineState::Idle, PipelineState::Triggered, PipelineState::Running, PipelineState::Evaluating, PipelineState::Advancing] {
            assert_eq!(PipelineState::from_str(state.as_str()), state);
        }
    }

    #[test]
    fn test_pipeline_state_unknown_defaults_idle() {
        assert_eq!(PipelineState::from_str("garbage"), PipelineState::Idle);
        assert_eq!(PipelineState::from_str(""), PipelineState::Idle);
    }
}
