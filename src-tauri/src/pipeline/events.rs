use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::state::PipelineState;

/// Event name constants for cross-module use.
pub const EVT_TRIGGERED: &str = "pipeline:triggered";
pub const EVT_RUNNING: &str = "pipeline:running";
pub const EVT_ADVANCED: &str = "pipeline:advanced";
pub const EVT_UNBLOCKED: &str = "pipeline:unblocked";
pub const EVT_DEP_MOVED: &str = "pipeline:dependency_moved";

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

/// Emit a global `tasks:changed` event so the frontend re-fetches.
pub fn emit_tasks_changed(app: &AppHandle, workspace_id: &str, reason: &str) {
    let _ = app.emit(
        "tasks:changed",
        &TasksChangedEvent {
            workspace_id: workspace_id.to_string(),
            reason: reason.to_string(),
        },
    );
}

/// Payload sent to webhook URLs.
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
