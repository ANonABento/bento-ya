use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::db::{self, AppState};
use tauri::Manager;

// ─── Event channel name helpers ────────────────────────────────────────────

pub fn pty_output_channel(task_id: &str) -> String {
    format!("pty:{}:output", task_id)
}

pub fn pty_exit_channel(task_id: &str) -> String {
    format!("pty:{}:exit", task_id)
}

pub fn agent_transcript_event_channel(task_id: &str) -> String {
    format!("agent:{}:transcript_event", task_id)
}

pub fn agent_status_channel(task_id: &str) -> String {
    format!("agent:{}:status", task_id)
}

pub fn task_updated_channel(task_id: &str) -> String {
    format!("task:{}:updated", task_id)
}

pub fn git_changes_channel(task_id: &str) -> String {
    format!("git:{}:changes", task_id)
}

pub fn workspace_updated_channel(workspace_id: &str) -> String {
    format!("workspace:{}:updated", workspace_id)
}

// ─── Event payloads ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtyOutputPayload {
    pub task_id: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyExitPayload {
    pub task_id: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTranscriptEventPayload {
    pub id: String,
    pub task_id: String,
    pub session_id: Option<String>,
    pub event_type: String,
    pub content: Option<String>,
    pub metadata_json: Option<String>,
    pub sequence: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStatusPayload {
    pub task_id: String,
    pub status: AgentStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Running,
    Completed,
    Failed,
    NeedsAttention,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskUpdatedPayload {
    pub task_id: String,
    pub column_id: Option<String>,
    pub title: Option<String>,
    pub position: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitChangesPayload {
    pub task_id: String,
    pub files: Vec<FileChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub status: FileChangeStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileChangeStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceUpdatedPayload {
    pub workspace_id: String,
    pub name: Option<String>,
}

// ─── Emit helpers ──────────────────────────────────────────────────────────

pub fn emit_pty_output(app: &AppHandle, payload: PtyOutputPayload) {
    let channel = pty_output_channel(&payload.task_id);
    let _ = app.emit(&channel, &payload);
}

pub fn emit_pty_exit(app: &AppHandle, payload: PtyExitPayload) {
    let channel = pty_exit_channel(&payload.task_id);
    let _ = app.emit(&channel, &payload);
}

pub fn emit_agent_transcript_event(app: &AppHandle, payload: AgentTranscriptEventPayload) {
    let channel = agent_transcript_event_channel(&payload.task_id);
    let _ = app.emit(&channel, &payload);
}

pub fn persist_and_emit_agent_transcript_event(
    app: &AppHandle,
    task_id: &str,
    session_id: Option<&str>,
    event_type: &str,
    content: Option<&str>,
    metadata_json: Option<&str>,
) -> Option<db::AgentTranscriptEvent> {
    // Use the shared AppState mutex instead of opening a new sqlite handle
    // per call. Streaming agents emit hundreds of events/sec; the previous
    // pattern fanned out to thousands of concurrent fresh connections under
    // load and contended for the WAL writer lock.
    let state = app.try_state::<AppState>()?;
    let event = {
        let conn = match state.db.lock() {
            Ok(guard) => guard,
            Err(e) => {
                eprintln!(
                    "[events] transcript persist for task {} failed: db mutex poisoned: {}",
                    task_id, e
                );
                return None;
            }
        };
        match db::insert_agent_transcript_event(
            &conn,
            task_id,
            session_id,
            event_type,
            content,
            metadata_json,
        ) {
            Ok(event) => event,
            Err(e) => {
                eprintln!(
                    "[events] transcript persist for task {} event_type={} failed: {}",
                    task_id, event_type, e
                );
                return None;
            }
        }
    };
    emit_agent_transcript_event(
        app,
        AgentTranscriptEventPayload {
            id: event.id.clone(),
            task_id: event.task_id.clone(),
            session_id: event.session_id.clone(),
            event_type: event.event_type.clone(),
            content: event.content.clone(),
            metadata_json: event.metadata_json.clone(),
            sequence: event.sequence,
            created_at: event.created_at.clone(),
        },
    );
    Some(event)
}

pub fn persist_and_emit_agent_runtime_event(
    app: &AppHandle,
    task_id: &str,
    session_id: Option<&str>,
    event: crate::chat::AgentRuntimeEvent,
) -> Option<db::AgentTranscriptEvent> {
    let (event_type, content, metadata_json) = event.into_transcript_parts();
    persist_and_emit_agent_transcript_event(
        app,
        task_id,
        session_id,
        event_type,
        content.as_deref(),
        metadata_json.as_deref(),
    )
}

pub fn emit_agent_status(app: &AppHandle, payload: AgentStatusPayload) {
    let channel = agent_status_channel(&payload.task_id);
    let _ = app.emit(&channel, &payload);
}

pub fn emit_task_updated(app: &AppHandle, payload: TaskUpdatedPayload) {
    let channel = task_updated_channel(&payload.task_id);
    let _ = app.emit(&channel, &payload);
}

pub fn emit_git_changes(app: &AppHandle, payload: GitChangesPayload) {
    let channel = git_changes_channel(&payload.task_id);
    let _ = app.emit(&channel, &payload);
}

pub fn emit_workspace_updated(app: &AppHandle, payload: WorkspaceUpdatedPayload) {
    let channel = workspace_updated_channel(&payload.workspace_id);
    let _ = app.emit(&channel, &payload);
}
