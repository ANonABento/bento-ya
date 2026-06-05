//! Pipeline Engine
//!
//! Handles column triggers and exit criteria evaluation.
//! When a task enters a column, the pipeline fires the column's trigger.
//! When exit criteria are met, the task auto-advances to the next column.

pub mod dependencies;
pub mod hygiene;
pub mod spawn;
pub mod template;
pub mod templates;
pub mod triggers;

use crate::db::{self, Column, Task};
use crate::error::AppError;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// Maximum duration (in seconds) for unbounded siege retry (max_retries = -1).
const SIEGE_TIMEOUT_SECS: i64 = 1800; // 30 minutes

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
    /// Setup is queued — another setup is running in this workspace
    SetupQueued,
    /// Trigger hit a provider rate limit. Re-fire is scheduled; this is NOT
    /// counted as a normal failure for retry/crash-loop purposes.
    RateLimited,
}

impl PipelineState {
    pub fn as_str(&self) -> &'static str {
        match self {
            PipelineState::Idle => "idle",
            PipelineState::Triggered => "triggered",
            PipelineState::Running => "running",
            PipelineState::Evaluating => "evaluating",
            PipelineState::Advancing => "advancing",
            PipelineState::SetupQueued => "setup_queued",
            PipelineState::RateLimited => "rate_limited",
        }
    }

    pub fn from_db_str(s: &str) -> Self {
        match s {
            "triggered" => PipelineState::Triggered,
            "running" => PipelineState::Running,
            "evaluating" => PipelineState::Evaluating,
            "advancing" => PipelineState::Advancing,
            "setup_queued" => PipelineState::SetupQueued,
            "rate_limited" => PipelineState::RateLimited,
            _ => PipelineState::Idle,
        }
    }
}

// ─── Pipeline Event Names ──────────────────────────────────────────────────

/// Event name constants for cross-module use (triggers.rs, dependencies.rs).
pub const EVT_TRIGGERED: &str = "pipeline:triggered";
pub const EVT_RUNNING: &str = "pipeline:running";
pub const EVT_ADVANCED: &str = "pipeline:advanced";
pub const EVT_UNBLOCKED: &str = "pipeline:unblocked";
pub const EVT_DEP_MOVED: &str = "pipeline:dependency_moved";
pub const EVT_DEP_CLEARED: &str = "pipeline:dependency_cleared";

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

/// Emit a pipeline lifecycle event to the frontend.
pub fn emit_pipeline(
    app: &AppHandle,
    event_name: &str,
    task_id: &str,
    column_id: &str,
    state: PipelineState,
    message: Option<String>,
) {
    let _ = app.emit(
        event_name,
        &PipelineEvent {
            task_id: task_id.to_string(),
            column_id: column_id.to_string(),
            event_type: event_name.trim_start_matches("pipeline:").to_string(),
            state: state.as_str().to_string(),
            message,
        },
    );
}

/// Emit a global tasks:changed event so the frontend re-fetches.
pub fn emit_tasks_changed(app: &AppHandle, workspace_id: &str, reason: &str) {
    let _ = app.emit(
        "tasks:changed",
        &TasksChangedEvent {
            workspace_id: workspace_id.to_string(),
            reason: reason.to_string(),
        },
    );
}

/// Global event emitted when a non-task entity (workspace, column, script) is
/// mutated out of band — e.g. by MCP or the chef. `kind` is one of
/// `workspace` | `column` | `script`. The frontend's entity-sync hook reloads
/// the matching store so external changes refresh the UI (the per-entity stores
/// otherwise only refresh via optimistic updates after a direct invoke()).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntitiesChangedEvent {
    pub workspace_id: String,
    pub kind: String,
}

pub fn emit_entities_changed(app: &AppHandle, workspace_id: &str, kind: &str) {
    let _ = app.emit(
        "entities:changed",
        &EntitiesChangedEvent {
            workspace_id: workspace_id.to_string(),
            kind: kind.to_string(),
        },
    );
}

/// True if `column` is the terminal stage of the workspace's pipeline.
///
/// "Terminal" means: case-insensitive name "Done" OR no column with a higher
/// `position` exists. Used by:
/// - `cleanup_task_worktree_if_terminal` — to remove per-task worktrees once
///   they're no longer needed.
/// - `pipeline::triggers::execute_spawn_cli` — to force a fresh tmux pane
///   when firing a trigger on a terminal column. The persistent per-task
///   tmux session is rooted at the worktree, which `cleanup_task_worktree_if_terminal`
///   has already deleted by the time the terminal trigger fires; reusing
///   that pane causes zsh's `getcwd()` to fail and the script never runs.
pub fn column_is_terminal(conn: &Connection, column: &Column) -> Result<bool, AppError> {
    if column.name.eq_ignore_ascii_case("done") {
        return Ok(true);
    }

    Ok(db::get_next_column(conn, &column.workspace_id, column.position)?.is_none())
}

/// Clean up the per-task worktree after a task reaches the terminal Done column.
///
/// This intentionally leaves branch deletion to the merge flow. The worktree path
/// is cleared only after git reports the worktree was removed.
pub fn cleanup_task_worktree_if_terminal(
    conn: &Connection,
    task: &Task,
    column: &Column,
    reason: &str,
) -> Result<Task, AppError> {
    if task.worktree_path.as_deref().unwrap_or("").is_empty() || !column_is_terminal(conn, column)?
    {
        return Ok(task.clone());
    }

    let workspace = db::get_workspace(conn, &task.workspace_id)?;
    match crate::git::branch_manager::remove_task_worktree(&workspace.repo_path, &task.id) {
        Ok(()) => {
            log::info!(
                "[worktree-cleanup] Removed worktree for completed task {} ({})",
                task.id,
                reason
            );
            Ok(db::update_task_worktree_path(conn, &task.id, None)?)
        }
        Err(e) => {
            log::warn!(
                "[worktree-cleanup] Failed to remove worktree for completed task {}: {}",
                task.id,
                e
            );
            Ok(task.clone())
        }
    }
}

/// Move a task back to the first (Setup/Backlog) column with a
/// `pipeline_error` set. Used by the empty-branch gate when a task tries
/// to advance into a Merge/Done column without any feature commits — that
/// usually means the implementation agent silently failed, and quietly
/// marking the task Done would lose the failure.
///
/// If the task is already in the first column, no move occurs but the
/// error message is still recorded so the user sees why we refused to
/// advance.
pub fn requeue_to_first_column(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    current_column: &Column,
    error_msg: &str,
) -> Result<Task, AppError> {
    let columns = db::list_columns(conn, &task.workspace_id)?;
    let first = columns
        .into_iter()
        .next()
        .ok_or_else(|| AppError::NotFound("workspace has no columns".to_string()))?;

    if first.id == current_column.id {
        // Already at first column — record the error, keep position.
        let updated = db::update_task_pipeline_state(
            conn,
            &task.id,
            PipelineState::Idle.as_str(),
            None,
            Some(error_msg),
        )?;
        emit_pipeline(
            app,
            "pipeline:error",
            &task.id,
            &current_column.id,
            PipelineState::Idle,
            Some(error_msg.to_string()),
        );
        emit_tasks_changed(app, &task.workspace_id, "branch_gate_already_at_first");
        return Ok(updated);
    }

    let max_pos: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
            rusqlite::params![first.id],
            |row| row.get(0),
        )
        .unwrap_or(-1);

    let ts = db::now();
    conn.execute(
        "UPDATE tasks SET column_id = ?1, position = ?2, pipeline_state = 'idle', \
         pipeline_triggered_at = NULL, pipeline_error = ?3, updated_at = ?4 WHERE id = ?5",
        rusqlite::params![first.id, max_pos + 1, error_msg, ts, task.id],
    )
    .map_err(AppError::from)?;

    log::warn!(
        "[branch-gate] Requeued task {} from column '{}' to '{}': {}",
        task.id,
        current_column.name,
        first.name,
        error_msg
    );

    emit_pipeline(
        app,
        "pipeline:requeued",
        &task.id,
        &first.id,
        PipelineState::Idle,
        Some(error_msg.to_string()),
    );
    emit_tasks_changed(app, &task.workspace_id, "branch_gate_requeued");

    Ok(db::get_task(conn, &task.id)?)
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
    let max_retries = parse_trigger_field_i64(triggers_json, "max_retries").unwrap_or(0);

    if max_retries == -1 {
        // Unbounded siege mode: retry until time cap reached
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
                Some(
                    task.pipeline_state == PipelineState::Running.as_str()
                        || task.pipeline_state == "complete",
                )
            } else {
                None // Needs DB lookup — caller handles
            }
        }
        // pr_approved and time_elapsed need external resources — caller handles
        _ => None,
    }
}

/// Extract a single field from the `exit_criteria` object in a triggers JSON blob.
fn get_exit_criteria_field(triggers_json: Option<&str>, field: &str) -> Option<serde_json::Value> {
    triggers_json
        .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
        .and_then(|v| v.get("exit_criteria")?.get(field).cloned())
}

/// Pipeline v3: read `exit_criteria.on_failure.target` when on_failure is a
/// move_column action. Used by `mark_complete_with_error` to route failed
/// tasks (e.g. failed Verify → back to Working, failed Rebase → ConflictResolver)
/// instead of resetting to Backlog.
pub fn get_on_failure_move_target(triggers_json: Option<&str>) -> Option<String> {
    let on_failure = get_exit_criteria_field(triggers_json, "on_failure")?;
    let action_type = on_failure.get("type")?.as_str()?;
    if action_type != "move_column" {
        return None;
    }
    on_failure.get("target")?.as_str().map(String::from)
}

/// Parse the exit_criteria type from a column's triggers JSON.
pub fn parse_exit_type(triggers_json: Option<&str>) -> String {
    get_exit_criteria_field(triggers_json, "type")
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "manual".to_string())
}

/// Parse a boolean field from exit_criteria in triggers JSON.
fn parse_trigger_field_bool(triggers_json: Option<&str>, field: &str) -> bool {
    get_exit_criteria_field(triggers_json, field)
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// Parse a u64 field from exit_criteria in triggers JSON.
fn parse_trigger_field_u64(triggers_json: Option<&str>, field: &str) -> u64 {
    get_exit_criteria_field(triggers_json, field)
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
}

/// Parse an i64 field from exit_criteria in triggers JSON.
fn parse_trigger_field_i64(triggers_json: Option<&str>, field: &str) -> Option<i64> {
    get_exit_criteria_field(triggers_json, field).and_then(|v| v.as_i64())
}

/// Check if a siege retry has exceeded the time cap.
/// Returns true if `pipeline_triggered_at` is older than `SIEGE_TIMEOUT_SECS`.
fn is_siege_timed_out(triggered_at: Option<&str>) -> bool {
    let Some(ts) = triggered_at else {
        // No timestamp means we can't measure — allow retry
        return false;
    };
    let Ok(started) = chrono::DateTime::parse_from_rfc3339(ts) else {
        return false;
    };
    chrono::Utc::now().signed_duration_since(started)
        >= chrono::Duration::seconds(SIEGE_TIMEOUT_SECS)
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
        log::warn!(
            "Column {} deleted before trigger could fire for task {}",
            column.id,
            task.id
        );
        return Ok(task.clone());
    }

    // Record timing: task entering this column
    if let Err(e) = db::insert_pipeline_timing(conn, &task.id, &column.id, &column.name) {
        log::warn!(
            "Failed to insert pipeline timing for task {}: {}",
            task.id,
            e
        );
    }

    // Check for V2 triggers
    if let Some(ref triggers_json) = column.triggers {
        if triggers_json != "{}" && !triggers_json.is_empty() {
            if let Ok(col_triggers) =
                serde_json::from_str::<triggers::ColumnTriggersV2>(triggers_json)
            {
                if col_triggers.on_entry.is_some() {
                    return triggers::fire_on_entry(conn, app, task, column, &col_triggers, None);
                }
            }
        }
    }

    // No trigger configured, stay idle
    Ok(task.clone())
}

/// The single create-a-task service path. Every human/agent surface (Tauri
/// command, HTTP API, MCP-via-API) funnels through here so a task created from
/// anywhere is identical: same DB row (via [`db::insert_task_full`]), same
/// blocked-from-dependencies derivation, same trigger-firing rule, same
/// `tasks:changed` event.
///
/// `fire_triggers` lets callers opt out of trigger firing (e.g. bulk import);
/// when true, the on-entry trigger fires only if the task is not blocked by
/// unmet dependencies — matching the long-standing UI/chef behavior.
pub fn create_task_service(
    conn: &Connection,
    app: &AppHandle,
    new: &db::NewTask,
    fire_triggers: bool,
) -> Result<Task, AppError> {
    if new.title.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Task title cannot be empty".to_string(),
        ));
    }

    let task = db::insert_task_full(conn, new)?;

    let task = if fire_triggers && !task.blocked {
        let column = db::get_column(conn, &task.column_id)?;
        fire_trigger(conn, app, &task, &column)?
    } else {
        task
    };

    emit_tasks_changed(app, new.workspace_id, "task_created");
    Ok(task)
}

/// The single move-a-task path. Updates column+position, and when the column
/// changes runs the full transition: cancel a running agent (unless the target
/// also spawns one), fire the old column's `on_exit`, clean up a worktree if the
/// target is terminal, re-check dependents against the post-move state, emit
/// `tasks:changed`, and fire the target column's `on_entry`. Every surface
/// (Tauri command, HTTP API, chef) funnels through here so the transition is
/// identical and triggers fire exactly once.
pub fn move_task_service(
    conn: &Connection,
    app: &AppHandle,
    id: &str,
    target_column_id: &str,
    position: i64,
) -> Result<Task, AppError> {
    if position < 0 {
        return Err(AppError::InvalidInput(
            "Position must be non-negative".to_string(),
        ));
    }

    let task_before = db::get_task(conn, id)?;
    let old_column_id = task_before.column_id.clone();
    let column_changed = old_column_id != target_column_id;

    let ts = db::now();
    if column_changed {
        conn.execute(
            "UPDATE tasks SET column_id = ?1, position = ?2, pipeline_state = 'idle', pipeline_triggered_at = NULL, pipeline_error = NULL, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![target_column_id, position, ts, id],
        )?;
    } else {
        conn.execute(
            "UPDATE tasks SET column_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![target_column_id, position, ts, id],
        )?;
    }

    let task = db::get_task(conn, id)?;
    if !column_changed {
        return Ok(task);
    }

    let old_column = db::get_column(conn, &old_column_id)?;
    let target_column = db::get_column(conn, target_column_id)?;

    // Cancel a running agent if the target column has no spawn_cli trigger.
    // If the target also has a trigger, the new agent replaces the old one.
    if task_before.agent_status.as_deref() == Some("running") {
        let target_has_trigger = target_column
            .triggers
            .as_deref()
            .map(|t| t.contains("spawn_cli"))
            .unwrap_or(false);
        if !target_has_trigger {
            crate::chat::tmux_transport::cancel_task_agent(
                conn,
                id,
                task_before.agent_session_id.as_deref(),
            );
        }
    }

    let _ = triggers::fire_on_exit(conn, app, &task_before, &old_column, Some(&target_column));

    let task = cleanup_task_worktree_if_terminal(conn, &task, &target_column, "manual_move")?;

    emit_tasks_changed(app, &task.workspace_id, "task_moved");

    // Second dependents pass with post-move state (fire_on_exit's pre-move pass
    // only saw the old column).
    let _ = dependencies::check_dependents(conn, app, &task);

    fire_trigger(conn, app, &task, &target_column)
}

/// Optional field set for a task update. `None` = leave unchanged; `Some(None)`
/// (for nullable fields) = set to NULL. Mirrors the Tauri command's argument
/// shape so the command, HTTP API, and chef share one update path.
#[derive(Debug, Default)]
pub struct UpdateTaskFields<'a> {
    pub title: Option<&'a str>,
    pub description: Option<Option<&'a str>>,
    pub column_id: Option<&'a str>,
    pub position: Option<i64>,
    pub agent_mode: Option<Option<&'a str>>,
    pub priority: Option<&'a str>,
    pub model: Option<Option<&'a str>>,
    pub estimated_hours: Option<Option<f64>>,
}

/// The single field-update path. Applies the core columns via `db::update_task`,
/// then the model and time-tracking side-updates, and emits `tasks:changed` so
/// every surface refreshes the UI identically (the Tauri command historically
/// emitted nothing; MCP wrote the DB directly and skipped the event entirely).
pub fn update_task_service(
    conn: &Connection,
    app: &AppHandle,
    id: &str,
    fields: &UpdateTaskFields,
) -> Result<Task, AppError> {
    let mut task = db::update_task(
        conn,
        id,
        fields.title,
        fields.description,
        fields.column_id,
        fields.position,
        fields.agent_mode,
        fields.priority,
    )?;

    if let Some(model) = fields.model {
        let ts = db::now();
        conn.execute(
            "UPDATE tasks SET model = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![model, ts, id],
        )?;
        task = db::get_task(conn, id)?;
    }

    if let Some(hours) = fields.estimated_hours {
        task = db::update_task_time_tracking(conn, id, hours)?;
    }

    emit_tasks_changed(app, &task.workspace_id, "task_updated");
    Ok(task)
}

/// Evaluate exit criteria for a task.
/// Returns true if exit criteria are met and task should advance.
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

    // Set state to evaluating
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

    // Try pure check first, fall back to external checks
    let exit_met = match check_exit_met(task, exit_type.as_str()) {
        Some(result) => result,
        None => {
            // Needs external resources — handle here
            match exit_type {
                triggers::ExitCriteriaTypeV2::AgentComplete => {
                    // Has session ID — needs DB lookup
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
                    let timeout_secs =
                        parse_trigger_field_u64(column.triggers.as_deref(), "timeout");
                    let timeout_secs = if timeout_secs == 0 { 300 } else { timeout_secs };
                    if let Some(ref triggered_at) = task.pipeline_triggered_at {
                        if let Ok(triggered_time) =
                            chrono::DateTime::parse_from_rfc3339(triggered_at)
                        {
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
            }
        }
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

    // Reset state to running or idle
    let new_state = if exit_met {
        PipelineState::Idle
    } else if PipelineState::from_db_str(&task.pipeline_state) == PipelineState::Running {
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
    // Check workspace-level auto-advance toggle (defaults to true)
    if let Ok(workspace) = db::get_workspace(conn, &task.workspace_id) {
        if let Ok(cfg) = serde_json::from_str::<serde_json::Value>(&workspace.config) {
            if let Some(false) = cfg.get("autoAdvance").and_then(|v| v.as_bool()) {
                return Ok(None);
            }
        }
    }

    // Check if auto-advance is enabled via V2 triggers
    let auto_advance = parse_trigger_field_bool(current_column.triggers.as_deref(), "auto_advance");

    if !auto_advance {
        return Ok(None);
    }

    if task.held_by_user {
        emit_pipeline(
            app,
            "pipeline:auto_advance_deferred",
            &task.id,
            &current_column.id,
            PipelineState::Idle,
            Some("Auto-advance held while user is steering the task".to_string()),
        );
        return Ok(None);
    }

    // Evaluate exit criteria
    let exit_met = evaluate_exit_criteria(conn, app, task, current_column)?;
    if !exit_met {
        return Ok(None);
    }

    // Post-merge verification gate: when leaving a "Merge main" / "Merge"
    // column the agent claims success by exiting 0, but the actual git merge
    // can silently fail (race against another in-flight merge, dirty working
    // tree, agent declined to act on a foreign mid-merge state). Without this
    // check, the task advances to Done even though main never received the
    // branch's commits -- a "ghost merge".
    let is_merge_column = current_column.name.eq_ignore_ascii_case("Merge main")
        || current_column.name.eq_ignore_ascii_case("Merge");
    if is_merge_column {
        // Auto-advance is the normal path out of Merge main, so fire the
        // column's on_exit action here before verification. For the default
        // Slothing template this is the serialized `merge_to_main` push that
        // fast-forwards origin/main to the task branch.
        triggers::fire_on_exit(conn, app, task, current_column, None)?;

        if let Some(branch) = task.branch_name.as_deref() {
            if !branch.is_empty() {
                if let Ok(workspace) = db::get_workspace(conn, &task.workspace_id) {
                    let _ = std::process::Command::new("git")
                        .args(["fetch", "origin", "main"])
                        .current_dir(&workspace.repo_path)
                        .output();
                    match crate::git::branch_manager::branch_feature_commit_count(
                        &workspace.repo_path,
                        "origin/main",
                        branch,
                    ) {
                        Ok(0) => { /* fully merged — proceed */ }
                        Ok(n) => {
                            let msg = format!(
                                "Post-merge verification failed: branch '{}' still has {} \
                                 commit(s) not on 'origin/main'. The merge step claimed success but \
                                 origin/main did not advance. Requeued to first column for human review.",
                                branch, n
                            );
                            log::warn!(
                                "[post-merge-verify] task={} branch={} ahead-of-main={} — refusing to advance",
                                task.id, branch, n
                            );
                            return Ok(Some(requeue_to_first_column(
                                conn,
                                app,
                                task,
                                current_column,
                                &msg,
                            )?));
                        }
                        Err(e) => {
                            log::warn!(
                                "[post-merge-verify] task={} branch={}: count failed: {} — \
                                 proceeding with advance (cannot verify)",
                                task.id,
                                branch,
                                e
                            );
                        }
                    }
                }
            }
        }
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

            emit_pipeline(
                app,
                "pipeline:advancing",
                &task.id,
                &current_column.id,
                PipelineState::Advancing,
                Some(format!("Moving to column: {}", next_col.name)),
            );

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
            let updated_task =
                cleanup_task_worktree_if_terminal(conn, &updated_task, &next_col, "auto_advance")?;

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

            // Notify frontend that tasks changed
            emit_tasks_changed(app, &task.workspace_id, "pipeline_advanced");

            // Re-check dependents now that the source has settled into its new column.
            // The pre-advance call inside mark_complete cannot see this column, so the
            // `completed` / `at_or_past_column` conditions need this second pass.
            let _ = dependencies::check_dependents(conn, app, &updated_task);

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

/// Increment the retry_count for a task.
fn increment_retry_count(conn: &Connection, task_id: &str) -> Result<(), AppError> {
    conn.execute(
        "UPDATE tasks SET retry_count = retry_count + 1 WHERE id = ?1",
        rusqlite::params![task_id],
    )
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

/// Mark a pipeline execution as complete (called when agent/script finishes)
pub fn mark_complete(
    conn: &Connection,
    app: &AppHandle,
    task_id: &str,
    success: bool,
) -> Result<Task, AppError> {
    mark_complete_with_error(conn, app, task_id, success, None)
}

/// Mark a pipeline execution as complete with optional error details
pub fn mark_complete_with_error(
    conn: &Connection,
    app: &AppHandle,
    task_id: &str,
    success: bool,
    error_detail: Option<&str>,
) -> Result<Task, AppError> {
    let task = db::get_task(conn, task_id)?;
    let column = db::get_column(conn, &task.column_id)?;

    // Record timing: task exiting this column
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
            // Reset retry count on success
            conn.execute(
                "UPDATE tasks SET retry_count = 0 WHERE id = ?1",
                rusqlite::params![task_id],
            )
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;

            // Check dependents - tasks waiting on this one
            let _ = dependencies::check_dependents(conn, app, &task);

            // Try to auto-advance
            if let Some(advanced_task) = try_auto_advance(conn, app, &task, &column)? {
                return Ok(advanced_task);
            }

            // Auto-advance not possible (no next column), fall through to complete
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
            // Reset retry count on success
            conn.execute(
                "UPDATE tasks SET retry_count = 0 WHERE id = ?1",
                rusqlite::params![task_id],
            )
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;

            // Check dependents
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
            let retry_msg = match error_detail {
                Some(detail) => format!("Retrying ({}/{}) — {}", attempt, max, detail),
                None => format!("Retrying ({}/{})", attempt, max),
            };
            log::info!("[pipeline] {}: {}", task_id, retry_msg);

            emit_pipeline(
                app,
                "pipeline:error",
                task_id,
                &column.id,
                PipelineState::Idle,
                Some(retry_msg),
            );
            let msg = if max == -1 {
                format!("Siege retry #{}", attempt)
            } else {
                format!("Retrying ({}/{})", attempt, max)
            };
            log::info!("[pipeline] {} task {}", msg, task_id);

            emit_pipeline(
                app,
                "pipeline:error",
                task_id,
                &column.id,
                PipelineState::Idle,
                Some(msg),
            );

            let updated_task = db::get_task(conn, task_id)?;
            fire_trigger(conn, app, &updated_task, &column)
        }
        CompletionAction::Failed => {
            // Pipeline v3: column triggers can declare on_failure routing. When a
            // column has `exit_criteria.on_failure: { type: "move_column", target: "<id>" }`,
            // route the failed task there instead of resetting to Backlog. This enables
            // patterns like Verify-fail → Working (with error context) and
            // Rebase-fail → ConflictResolver.
            if let Some(target_col_id) = get_on_failure_move_target(column.triggers.as_deref()) {
                if let Ok(target_col) = db::get_column(conn, &target_col_id) {
                    let error_msg = error_detail.unwrap_or("Execution failed");
                    log::info!(
                        "[pipeline] task {} failed in column '{}' — routing to '{}' via on_failure",
                        task_id,
                        column.name,
                        target_col.name
                    );
                    let _ = db::update_task_pipeline_state(
                        conn,
                        task_id,
                        PipelineState::Advancing.as_str(),
                        None,
                        Some(error_msg),
                    );
                    let max_pos: i64 = conn
                        .query_row(
                            "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
                            rusqlite::params![target_col.id],
                            |row| row.get(0),
                        )
                        .unwrap_or(-1);
                    let ts = db::now();
                    conn.execute(
                        "UPDATE tasks SET column_id = ?1, position = ?2, pipeline_state = 'idle', pipeline_triggered_at = NULL, retry_count = 0, updated_at = ?3 WHERE id = ?4",
                        rusqlite::params![target_col.id, max_pos + 1, ts, task_id],
                    )
                    .map_err(AppError::from)?;
                    let routed_task = db::get_task(conn, task_id)?;
                    emit_pipeline(
                        app,
                        "pipeline:advanced",
                        task_id,
                        &target_col.id,
                        PipelineState::Idle,
                        Some(format!(
                            "on_failure: {} → {} ({})",
                            column.name, target_col.name, error_msg
                        )),
                    );
                    emit_tasks_changed(app, &task.workspace_id, "on_failure_route");
                    return fire_trigger(conn, app, &routed_task, &target_col);
                }
            }

            // If retries were exhausted (task was retried at least once), reset the task
            // to the Backlog column for a clean-slate re-run instead of leaving it stuck.
            if task.retry_count > 0 {
                match crate::commands::task::reset_task_to_backlog(conn, app, task_id) {
                    Ok(reset_task) => {
                        emit_completion_event(app, task_id, &column.id, &task.workspace_id, false);
                        return Ok(reset_task);
                    }
                    Err(e) => {
                        log::error!(
                            "[pipeline] Failed to reset task {} to Backlog, falling back to idle+error: {}",
                            task_id, e
                        );
                    }
                }
            }

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

    // Promote queued tasks now that a slot may have opened up
    promote_queued_tasks(app, workspace_id);
}

/// Walk queued tasks FIFO and promote every task whose workspace + column
/// caps both have room. Called after every task completion/failure so freed
/// slots drain promptly.
///
/// Three behaviors worth knowing:
///   1. Uses the workspace-effective cap (honoring per-workspace overrides
///      stored in `workspaces.config`), not the source default. Earlier
///      revisions used `triggers::DEFAULT_MAX_CONCURRENT_AGENTS` here, which
///      drifted from `execute_spawn_cli`'s actual gate.
///   2. Promotes multiple tasks in one call. Earlier revisions only promoted
///      one, so multiple simultaneously-freed slots took several events to
///      drain.
///   3. Honors per-column `triggers.max_concurrent` — if a queued task's
///      column is at its column cap, skip it and try the next queued task.
fn promote_queued_tasks(app: &AppHandle, workspace_id: &str) {
    let conn = match Connection::open(db::db_path()) {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[pipeline] promote_queued_tasks: DB open failed: {}", e);
            return;
        }
    };
    let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");

    let workspace = match db::get_workspace(&conn, workspace_id) {
        Ok(w) => w,
        Err(e) => {
            log::warn!(
                "[pipeline] promote_queued_tasks: workspace read failed: {}",
                e
            );
            return;
        }
    };
    let max_workspace =
        crate::config::effective_pipeline_settings(&workspace.config).max_concurrent_agents;

    let running = db::get_running_agent_count(&conn, workspace_id).unwrap_or(0);
    if running >= max_workspace {
        return;
    }

    let queued = match db::get_queued_tasks(&conn, workspace_id) {
        Ok(q) => q,
        Err(_) => return,
    };
    if queued.is_empty() {
        return;
    }

    let columns = match db::list_columns(&conn, workspace_id) {
        Ok(c) => c,
        Err(_) => return,
    };

    let mut current_running = running;
    let mut promoted = 0usize;

    for next in &queued {
        if current_running >= max_workspace {
            break;
        }
        let col = match columns.iter().find(|c| c.id == next.column_id) {
            Some(c) => c,
            None => continue,
        };
        let col_triggers = triggers::parse_column_triggers(col.triggers.as_deref());

        // Column-scoped cap (if set & positive). Re-read the count per
        // iteration since we may have just promoted into the same column.
        if let Some(col_cap) = triggers::effective_column_max_concurrent(&col_triggers) {
            let col_running = db::get_active_execution_count_in_column_excluding(
                &conn,
                workspace_id,
                &col.id,
                &next.id,
            )
            .unwrap_or(0);
            if col_running >= col_cap {
                continue;
            }
        }

        log::info!(
            "[pipeline] Promoting queued task {} (workspace {}/{}; column '{}')",
            next.id,
            current_running,
            max_workspace,
            col.name,
        );
        let _ = db::update_task_agent_status(&conn, &next.id, Some("idle"), None);
        match triggers::fire_on_entry(&conn, app, next, col, &col_triggers, None) {
            Ok(_) => {
                promoted += 1;
                current_running += 1;
            }
            Err(e) => log::warn!(
                "[pipeline] Failed to promote queued task {}: {}",
                next.id,
                e
            ),
        }
    }

    if promoted > 1 {
        log::info!(
            "[pipeline] Promoted {} queued tasks (running now: {}/{})",
            promoted,
            current_running,
            max_workspace
        );
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

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
            batch_id: None,
            files_touched: "[]".into(),
            checklist: None,
            estimated_hours: None,
            actual_hours: 0.0,
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
            labels: Vec::new(),
            created_by_task_id: None,
            created_by_agent_session_id: None,
            recursion_depth: 0,
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
            github_issue_number: None,
            github_issue_commented: false,
            github_issue_pr_linked: false,
            archived_at: None,
            last_user_input_at: None,
            held_by_user: false,
            runtime_mode_override: None,
            agent_paused_at: None,
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
        })
        .to_string()
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

    // ─── siege (unbounded retry) tests ───────────────────────────────

    fn siege_triggers_json(auto_advance: bool) -> String {
        serde_json::json!({
            "exit_criteria": {
                "type": "agent_complete",
                "auto_advance": auto_advance,
                "max_retries": -1
            }
        })
        .to_string()
    }

    #[test]
    fn test_decide_siege_retries_when_recent() {
        let mut task = make_task(3, "running");
        // Started 5 minutes ago — well within 30-min cap
        task.pipeline_triggered_at =
            Some((chrono::Utc::now() - chrono::Duration::minutes(5)).to_rfc3339());
        let triggers = siege_triggers_json(true);
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
        let mut task = make_task(50, "running");
        // Started 31 minutes ago — past the 30-min cap
        task.pipeline_triggered_at =
            Some((chrono::Utc::now() - chrono::Duration::minutes(31)).to_rfc3339());
        let triggers = siege_triggers_json(true);
        let action = decide_completion(&task, Some(&triggers), false);
        assert_eq!(action, CompletionAction::Failed);
    }

    #[test]
    fn test_decide_siege_retries_without_timestamp() {
        let mut task = make_task(5, "running");
        task.pipeline_triggered_at = None; // No timestamp — allow retry
        let triggers = siege_triggers_json(false);
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
        let mut task = make_task(3, "running");
        task.pipeline_triggered_at = Some(chrono::Utc::now().to_rfc3339());
        let triggers = siege_triggers_json(true);
        // Success should advance regardless of siege mode
        let action = decide_completion(&task, Some(&triggers), true);
        assert_eq!(action, CompletionAction::Advance);
    }

    // ─── is_siege_timed_out tests ────────────────────────────────────

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
        for state in [
            PipelineState::Idle,
            PipelineState::Triggered,
            PipelineState::Running,
            PipelineState::Evaluating,
            PipelineState::Advancing,
            PipelineState::SetupQueued,
        ] {
            assert_eq!(PipelineState::from_db_str(state.as_str()), state);
        }
    }

    #[test]
    fn test_pipeline_state_unknown_defaults_idle() {
        assert_eq!(PipelineState::from_db_str("garbage"), PipelineState::Idle);
        assert_eq!(PipelineState::from_db_str(""), PipelineState::Idle);
    }

    // ─── column_is_terminal ───────────────────────────────────────────────

    #[test]
    fn test_column_is_terminal_done_by_name() {
        // Even with a higher-positioned column following, a column named
        // "Done" (case-insensitive) is still considered terminal — that's
        // the canonical Done stage convention.
        let conn = db::init_test().expect("init test db");
        let workspace = db::insert_workspace(&conn, "ws", "/tmp/repo").expect("ws");
        let done = db::insert_column(&conn, &workspace.id, "Done", 0).expect("done col");
        let _post = db::insert_column(&conn, &workspace.id, "PostDone", 1).expect("post col");

        assert!(column_is_terminal(&conn, &done).expect("terminal check"));
    }

    #[test]
    fn test_column_is_terminal_done_case_insensitive() {
        let conn = db::init_test().expect("init test db");
        let workspace = db::insert_workspace(&conn, "ws", "/tmp/repo").expect("ws");
        let done = db::insert_column(&conn, &workspace.id, "DONE", 0).expect("done col");

        assert!(column_is_terminal(&conn, &done).expect("terminal check"));
    }

    #[test]
    fn test_column_is_terminal_last_position_when_no_done_name() {
        // Workspaces that don't use "Done" as the literal name still get
        // terminal status on the highest-positioned column.
        let conn = db::init_test().expect("init test db");
        let workspace = db::insert_workspace(&conn, "ws", "/tmp/repo").expect("ws");
        let _first = db::insert_column(&conn, &workspace.id, "Backlog", 0).expect("first");
        let last = db::insert_column(&conn, &workspace.id, "Shipped", 1).expect("last col");

        assert!(column_is_terminal(&conn, &last).expect("terminal check"));
    }

    #[test]
    fn test_column_is_terminal_false_for_non_last_named_column() {
        let conn = db::init_test().expect("init test db");
        let workspace = db::insert_workspace(&conn, "ws", "/tmp/repo").expect("ws");
        let middle = db::insert_column(&conn, &workspace.id, "Working", 1).expect("middle col");
        let _later = db::insert_column(&conn, &workspace.id, "Review", 2).expect("later col");

        assert!(!column_is_terminal(&conn, &middle).expect("terminal check"));
    }
}
