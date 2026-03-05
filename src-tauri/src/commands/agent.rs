use std::sync::Arc;

use tauri::{AppHandle, State};
use tokio::sync::Mutex as TokioMutex;

use crate::process::agent_session::AgentSessionManager;

// ─── Streaming agent commands (--print mode like orchestrator) ──────────────

/// Initialize an agent chat session for a task
#[tauri::command(rename_all = "camelCase")]
pub async fn init_agent_session(
    task_id: String,
    working_dir: String,
    cli_path: String,
    agent_sessions: State<'_, Arc<TokioMutex<AgentSessionManager>>>,
) -> Result<(), String> {
    let mut sessions = agent_sessions.lock().await;
    sessions.init_session(&task_id, &working_dir, &cli_path, None);
    Ok(())
}

/// Send a message to an agent and stream the response
#[tauri::command(rename_all = "camelCase")]
pub async fn stream_agent_chat(
    task_id: String,
    message: String,
    model: Option<String>,
    effort_level: Option<String>,
    app_handle: AppHandle,
    agent_sessions: State<'_, Arc<TokioMutex<AgentSessionManager>>>,
) -> Result<(), String> {
    let mut sessions = agent_sessions.lock().await;

    // Send message and stream response
    sessions
        .send_message(
            &task_id,
            &message,
            model.as_deref(),
            effort_level.as_deref(),
            &app_handle,
        )
        .await?;

    Ok(())
}

/// Cancel an ongoing agent chat
#[tauri::command(rename_all = "camelCase")]
pub async fn cancel_agent_chat(
    task_id: String,
    agent_sessions: State<'_, Arc<TokioMutex<AgentSessionManager>>>,
) -> Result<(), String> {
    let mut sessions = agent_sessions.lock().await;
    sessions.reset_session(&task_id);
    Ok(())
}

/// Reset agent session for a fresh start
#[tauri::command(rename_all = "camelCase")]
pub async fn reset_agent_session(
    task_id: String,
    agent_sessions: State<'_, Arc<TokioMutex<AgentSessionManager>>>,
) -> Result<(), String> {
    let mut sessions = agent_sessions.lock().await;
    sessions.kill_session(&task_id);
    Ok(())
}
