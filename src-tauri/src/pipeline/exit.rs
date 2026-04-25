use crate::db::{self, Column, Task};
use crate::error::AppError;
use rusqlite::Connection;
use serde::Deserialize;
use tauri::AppHandle;

use super::events::emit_pipeline;
use super::state::PipelineState;
use super::triggers;

/// Maximum duration (in seconds) for unbounded siege retry (`max_retries = -1`).
const SIEGE_TIMEOUT_SECS: i64 = 1800; // 30 minutes

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
            if task.agent_session_id.is_none() {
                Some(
                    task.pipeline_state == PipelineState::Running.as_str()
                        || task.pipeline_state == "complete",
                )
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Evaluate exit criteria for a task.
/// Returns true if exit criteria are met and the task should advance.
pub fn evaluate_exit_criteria(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    column: &Column,
) -> Result<bool, AppError> {
    let exit_type = triggers::parse_column_triggers(column.triggers.as_deref())
        .exit_criteria
        .map(|exit| exit.criteria_type)
        .unwrap_or_default();

    let _ = db::update_task_pipeline_state(
        conn,
        &task.id,
        PipelineState::Evaluating.as_str(),
        task.pipeline_triggered_at.as_deref(),
        None,
    );

    emit_pipeline(
        app,
        "pipeline:evaluating",
        &task.id,
        &column.id,
        PipelineState::Evaluating,
        Some(format!("Exit type: {}", exit_type.as_str())),
    );

    let exit_met = match check_exit_met(task, exit_type.as_str()) {
        Some(result) => result,
        None => match exit_type {
            triggers::ExitCriteriaTypeV2::AgentComplete => {
                if let Some(ref session_id) = task.agent_session_id {
                    match db::get_agent_session(conn, session_id) {
                        Ok(session) => {
                            session.status == "completed"
                                || (session.status == "stopped" && session.exit_code == Some(0))
                        }
                        Err(_) => {
                            task.pipeline_state == PipelineState::Running.as_str()
                                || task.pipeline_state == "complete"
                        }
                    }
                } else {
                    false
                }
            }
            triggers::ExitCriteriaTypeV2::TimeElapsed => {
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
            triggers::ExitCriteriaTypeV2::PrApproved => {
                if let Some(pr_number) = task.pr_number {
                    if let Ok(workspace) = db::get_workspace(conn, &task.workspace_id) {
                        let output = std::process::Command::new("gh")
                            .args([
                                "pr",
                                "view",
                                &pr_number.to_string(),
                                "--json",
                                "reviewDecision",
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

                                serde_json::from_slice::<PrReview>(&output.stdout)
                                    .map(|pr| pr.review_decision.as_deref() == Some("APPROVED"))
                                    .unwrap_or(false)
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
            _ => false,
        },
    };

    if exit_met {
        emit_pipeline(
            app,
            "pipeline:exit_met",
            &task.id,
            &column.id,
            PipelineState::Evaluating,
            Some(format!("Exit criteria met: {}", exit_type.as_str())),
        );
    }

    let new_state = if exit_met {
        PipelineState::Idle
    } else if PipelineState::from_storage(&task.pipeline_state) == PipelineState::Running {
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

/// Parse the exit_criteria type from a column's triggers JSON.
pub fn parse_exit_type(triggers_json: Option<&str>) -> String {
    get_exit_criteria_field(triggers_json, "type")
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "manual".to_string())
}

pub(crate) fn parse_trigger_field_bool(triggers_json: Option<&str>, field: &str) -> bool {
    get_exit_criteria_field(triggers_json, field)
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

pub(crate) fn parse_trigger_field_u64(triggers_json: Option<&str>, field: &str) -> u64 {
    get_exit_criteria_field(triggers_json, field)
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
}

pub(crate) fn parse_trigger_field_i64(triggers_json: Option<&str>, field: &str) -> Option<i64> {
    get_exit_criteria_field(triggers_json, field).and_then(|v| v.as_i64())
}

pub(crate) fn is_siege_timed_out(triggered_at: Option<&str>) -> bool {
    let Some(ts) = triggered_at else {
        return false;
    };
    let Ok(started) = chrono::DateTime::parse_from_rfc3339(ts) else {
        return false;
    };

    chrono::Utc::now().signed_duration_since(started)
        >= chrono::Duration::seconds(SIEGE_TIMEOUT_SECS)
}

fn get_exit_criteria_field(triggers_json: Option<&str>, field: &str) -> Option<serde_json::Value> {
    triggers_json
        .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
        .and_then(|v| v.get("exit_criteria")?.get(field).cloned())
}

#[cfg(test)]
mod tests {
    use crate::db::Task;

    use super::{check_exit_met, is_siege_timed_out, parse_exit_type};

    fn make_task(pipeline_state: &str) -> Task {
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
            retry_count: 0,
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

    #[test]
    fn test_siege_timeout_none_timestamp() {
        assert!(!is_siege_timed_out(None));
    }

    #[test]
    fn test_siege_timeout_recent() {
        let ts = (chrono::Utc::now() - chrono::Duration::minutes(10)).to_rfc3339();
        assert!(!is_siege_timed_out(Some(&ts)));
    }

    #[test]
    fn test_siege_timeout_expired() {
        let ts = (chrono::Utc::now() - chrono::Duration::minutes(31)).to_rfc3339();
        assert!(is_siege_timed_out(Some(&ts)));
    }

    #[test]
    fn test_siege_timeout_invalid_timestamp() {
        assert!(!is_siege_timed_out(Some("not-a-date")));
    }

    #[test]
    fn test_exit_manual_never_met() {
        let task = make_task("running");
        assert_eq!(check_exit_met(&task, "manual"), Some(false));
    }

    #[test]
    fn test_exit_script_success_met() {
        let mut task = make_task("running");
        task.last_script_exit_code = Some(0);
        assert_eq!(check_exit_met(&task, "script_success"), Some(true));
    }

    #[test]
    fn test_exit_script_success_not_met() {
        let mut task = make_task("running");
        task.last_script_exit_code = Some(1);
        assert_eq!(check_exit_met(&task, "script_success"), Some(false));
    }

    #[test]
    fn test_exit_script_success_no_code() {
        let task = make_task("running");
        assert_eq!(check_exit_met(&task, "script_success"), Some(false));
    }

    #[test]
    fn test_exit_checklist_all_checked() {
        let mut task = make_task("running");
        task.checklist = Some(r#"[{"checked":true},{"checked":true}]"#.into());
        assert_eq!(check_exit_met(&task, "checklist_done"), Some(true));
    }

    #[test]
    fn test_exit_checklist_partial() {
        let mut task = make_task("running");
        task.checklist = Some(r#"[{"checked":true},{"checked":false}]"#.into());
        assert_eq!(check_exit_met(&task, "checklist_done"), Some(false));
    }

    #[test]
    fn test_exit_checklist_empty() {
        let mut task = make_task("running");
        task.checklist = Some("[]".into());
        assert_eq!(check_exit_met(&task, "checklist_done"), Some(false));
    }

    #[test]
    fn test_exit_checklist_no_checklist() {
        let task = make_task("running");
        assert_eq!(check_exit_met(&task, "checklist_done"), Some(false));
    }

    #[test]
    fn test_exit_checklist_invalid_json() {
        let mut task = make_task("running");
        task.checklist = Some("not json".into());
        assert_eq!(check_exit_met(&task, "checklist_done"), Some(false));
    }

    #[test]
    fn test_exit_manual_approval_approved() {
        let mut task = make_task("running");
        task.review_status = Some("approved".into());
        assert_eq!(check_exit_met(&task, "manual_approval"), Some(true));
    }

    #[test]
    fn test_exit_manual_approval_rejected() {
        let mut task = make_task("running");
        task.review_status = Some("rejected".into());
        assert_eq!(check_exit_met(&task, "manual_approval"), Some(false));
    }

    #[test]
    fn test_exit_manual_approval_none() {
        let task = make_task("running");
        assert_eq!(check_exit_met(&task, "manual_approval"), Some(false));
    }

    #[test]
    fn test_exit_notification_sent() {
        let mut task = make_task("running");
        task.notification_sent_at = Some("2024-01-01T00:00:00Z".into());
        assert_eq!(check_exit_met(&task, "notification_sent"), Some(true));
    }

    #[test]
    fn test_exit_notification_not_sent() {
        let task = make_task("running");
        assert_eq!(check_exit_met(&task, "notification_sent"), Some(false));
    }

    #[test]
    fn test_exit_agent_complete_no_session_running() {
        let task = make_task("running");
        assert_eq!(check_exit_met(&task, "agent_complete"), Some(true));
    }

    #[test]
    fn test_exit_agent_complete_no_session_idle() {
        let task = make_task("idle");
        assert_eq!(check_exit_met(&task, "agent_complete"), Some(false));
    }

    #[test]
    fn test_exit_agent_complete_with_session_needs_db() {
        let mut task = make_task("running");
        task.agent_session_id = Some("session-123".into());
        assert_eq!(check_exit_met(&task, "agent_complete"), None);
    }

    #[test]
    fn test_exit_pr_approved_needs_external() {
        let task = make_task("running");
        assert_eq!(check_exit_met(&task, "pr_approved"), None);
    }

    #[test]
    fn test_exit_unknown_type_needs_external() {
        let task = make_task("running");
        assert_eq!(check_exit_met(&task, "some_future_type"), None);
    }

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
}
