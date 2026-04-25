use crate::db::{self, Column, Task};
use crate::error::AppError;
use rusqlite::Connection;
use tauri::AppHandle;

use super::dependencies;
use super::engine::{fire_trigger, try_auto_advance};
use super::events::{emit_pipeline, emit_tasks_changed};
use super::exit::{is_siege_timed_out, parse_trigger_field_bool, parse_trigger_field_i64};
use super::state::PipelineState;

/// What to do when a pipeline execution completes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CompletionAction {
    /// Success + auto-advance enabled - move to next column
    Advance,
    /// Failure + retries remaining - retry the trigger
    Retry { attempt: i64, max: i64 },
    /// Success, no auto-advance - stay in column, idle
    Complete,
    /// Failure, no retries left - stay in column, set error
    Failed,
}

/// Pure decision: given task state and column triggers, what should happen on completion?
pub fn decide_completion(
    task: &Task,
    triggers_json: Option<&str>,
    success: bool,
) -> CompletionAction {
    if success {
        if parse_trigger_field_bool(triggers_json, "auto_advance") {
            return CompletionAction::Advance;
        }
        return CompletionAction::Complete;
    }

    let max_retries = parse_trigger_field_i64(triggers_json, "max_retries").unwrap_or(0);

    if max_retries == -1 {
        if is_siege_timed_out(task.pipeline_triggered_at.as_deref()) {
            return CompletionAction::Failed;
        }
        return CompletionAction::Retry {
            attempt: task.retry_count + 1,
            max: -1,
        };
    }

    if max_retries > 0 && task.retry_count < max_retries {
        CompletionAction::Retry {
            attempt: task.retry_count + 1,
            max: max_retries,
        }
    } else {
        CompletionAction::Failed
    }
}

/// Handle trigger failure - set error state and emit event.
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

    emit_pipeline(
        app,
        "pipeline:error",
        &task.id,
        &column.id,
        PipelineState::Idle,
        Some(error_message.to_string()),
    );

    Ok(updated_task)
}

/// Mark a pipeline execution as complete (called when agent/script finishes).
pub fn mark_complete(
    conn: &Connection,
    app: &AppHandle,
    task_id: &str,
    success: bool,
) -> Result<Task, AppError> {
    mark_complete_with_error(conn, app, task_id, success, None)
}

/// Mark a pipeline execution as complete with optional error details.
pub fn mark_complete_with_error(
    conn: &Connection,
    app: &AppHandle,
    task_id: &str,
    success: bool,
    error_detail: Option<&str>,
) -> Result<Task, AppError> {
    let task = db::get_task(conn, task_id)?;
    let column = db::get_column(conn, &task.column_id)?;

    if let Err(e) =
        db::complete_pipeline_timing(conn, task_id, &column.id, success, task.retry_count)
    {
        log::warn!(
            "Failed to complete pipeline timing for task {}: {}",
            task_id,
            e
        );
    }

    let action = decide_completion(&task, column.triggers.as_deref(), success);

    match action {
        CompletionAction::Advance => {
            reset_retry_count(conn, task_id)?;
            let _ = dependencies::check_dependents(conn, app, &task);

            if let Some(advanced_task) = try_auto_advance(conn, app, &task, &column)? {
                return Ok(advanced_task);
            }

            let updated_task = db::update_task_pipeline_state(
                conn,
                task_id,
                PipelineState::Idle.as_str(),
                None,
                None,
            )?;
            emit_completion_event(app, task_id, &column.id, &task.workspace_id, true);
            Ok(updated_task)
        }
        CompletionAction::Complete => {
            reset_retry_count(conn, task_id)?;
            let _ = dependencies::check_dependents(conn, app, &task);

            let updated_task = db::update_task_pipeline_state(
                conn,
                task_id,
                PipelineState::Idle.as_str(),
                None,
                None,
            )?;
            emit_completion_event(app, task_id, &column.id, &task.workspace_id, true);
            Ok(updated_task)
        }
        CompletionAction::Retry { attempt, max } => {
            increment_retry_count(conn, task_id)?;

            let retry_message = format_retry_message(attempt, max, error_detail);
            log::info!("[pipeline] {}: {}", task_id, retry_message);
            emit_pipeline(
                app,
                "pipeline:error",
                task_id,
                &column.id,
                PipelineState::Idle,
                Some(retry_message),
            );

            let updated_task = db::get_task(conn, task_id)?;
            fire_trigger(conn, app, &updated_task, &column)
        }
        CompletionAction::Failed => {
            let error_msg = error_detail.unwrap_or("Execution failed");
            let updated_task = db::update_task_pipeline_state(
                conn,
                task_id,
                PipelineState::Idle.as_str(),
                None,
                Some(error_msg),
            )?;
            emit_completion_event(app, task_id, &column.id, &task.workspace_id, false);
            Ok(updated_task)
        }
    }
}

fn emit_completion_event(
    app: &AppHandle,
    task_id: &str,
    column_id: &str,
    workspace_id: &str,
    success: bool,
) {
    emit_pipeline(
        app,
        "pipeline:complete",
        task_id,
        column_id,
        PipelineState::Idle,
        Some(if success { "Success" } else { "Failed" }.to_string()),
    );
    emit_tasks_changed(app, workspace_id, "pipeline_complete");
}

fn format_retry_message(attempt: i64, max: i64, error_detail: Option<&str>) -> String {
    let base = if max == -1 {
        format!("Siege retry #{}", attempt)
    } else {
        format!("Retrying ({}/{})", attempt, max)
    };

    match error_detail {
        Some(detail) => format!("{} - {}", base, detail),
        None => base,
    }
}

fn reset_retry_count(conn: &Connection, task_id: &str) -> Result<(), AppError> {
    conn.execute(
        "UPDATE tasks SET retry_count = 0 WHERE id = ?1",
        rusqlite::params![task_id],
    )
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

fn increment_retry_count(conn: &Connection, task_id: &str) -> Result<(), AppError> {
    conn.execute(
        "UPDATE tasks SET retry_count = retry_count + 1 WHERE id = ?1",
        rusqlite::params![task_id],
    )
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::db::Task;

    use super::{decide_completion, CompletionAction};

    fn make_task(retry_count: i64) -> Task {
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
            pipeline_state: "running".into(),
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
            worktree_path: None,
            created_at: "2024-01-01T00:00:00Z".into(),
            updated_at: "2024-01-01T00:00:00Z".into(),
        }
    }

    fn triggers_json(auto_advance: bool, max_retries: i64) -> String {
        serde_json::json!({
            "exit_criteria": {
                "type": "agent_complete",
                "auto_advance": auto_advance,
                "max_retries": max_retries
            }
        })
        .to_string()
    }

    #[test]
    fn test_decide_success_no_auto_advance() {
        let task = make_task(0);
        let triggers = triggers_json(false, 0);
        let action = decide_completion(&task, Some(&triggers), true);
        assert_eq!(action, CompletionAction::Complete);
    }

    #[test]
    fn test_decide_success_with_auto_advance() {
        let task = make_task(0);
        let triggers = triggers_json(true, 0);
        let action = decide_completion(&task, Some(&triggers), true);
        assert_eq!(action, CompletionAction::Advance);
    }

    #[test]
    fn test_decide_failure_no_retries() {
        let task = make_task(0);
        let triggers = triggers_json(false, 0);
        let action = decide_completion(&task, Some(&triggers), false);
        assert_eq!(action, CompletionAction::Failed);
    }

    #[test]
    fn test_decide_failure_with_retries_remaining() {
        let task = make_task(1);
        let triggers = triggers_json(false, 3);
        let action = decide_completion(&task, Some(&triggers), false);
        assert_eq!(action, CompletionAction::Retry { attempt: 2, max: 3 });
    }

    #[test]
    fn test_decide_failure_retries_exhausted() {
        let task = make_task(3);
        let triggers = triggers_json(false, 3);
        let action = decide_completion(&task, Some(&triggers), false);
        assert_eq!(action, CompletionAction::Failed);
    }

    #[test]
    fn test_decide_failure_first_retry() {
        let task = make_task(0);
        let triggers = triggers_json(false, 2);
        let action = decide_completion(&task, Some(&triggers), false);
        assert_eq!(action, CompletionAction::Retry { attempt: 1, max: 2 });
    }

    #[test]
    fn test_decide_no_triggers_json() {
        let task = make_task(0);
        let action = decide_completion(&task, None, true);
        assert_eq!(action, CompletionAction::Complete);
    }

    #[test]
    fn test_decide_empty_triggers_json() {
        let task = make_task(0);
        let action = decide_completion(&task, Some("{}"), false);
        assert_eq!(action, CompletionAction::Failed);
    }

    #[test]
    fn test_decide_siege_retries_when_recent() {
        let mut task = make_task(3);
        task.pipeline_triggered_at =
            Some((chrono::Utc::now() - chrono::Duration::minutes(5)).to_rfc3339());
        let triggers = triggers_json(true, -1);
        let action = decide_completion(&task, Some(&triggers), false);
        assert_eq!(
            action,
            CompletionAction::Retry {
                attempt: 4,
                max: -1
            }
        );
    }

    #[test]
    fn test_decide_siege_fails_when_timed_out() {
        let mut task = make_task(50);
        task.pipeline_triggered_at =
            Some((chrono::Utc::now() - chrono::Duration::minutes(31)).to_rfc3339());
        let triggers = triggers_json(true, -1);
        let action = decide_completion(&task, Some(&triggers), false);
        assert_eq!(action, CompletionAction::Failed);
    }

    #[test]
    fn test_decide_siege_retries_without_timestamp() {
        let mut task = make_task(5);
        task.pipeline_triggered_at = None;
        let triggers = triggers_json(false, -1);
        let action = decide_completion(&task, Some(&triggers), false);
        assert_eq!(
            action,
            CompletionAction::Retry {
                attempt: 6,
                max: -1
            }
        );
    }

    #[test]
    fn test_decide_siege_success_still_advances() {
        let mut task = make_task(3);
        task.pipeline_triggered_at = Some(chrono::Utc::now().to_rfc3339());
        let triggers = triggers_json(true, -1);
        let action = decide_completion(&task, Some(&triggers), true);
        assert_eq!(action, CompletionAction::Advance);
    }
}
