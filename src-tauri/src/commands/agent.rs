use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};

use serde::Serialize;
use tauri::{AppHandle, State};
use tokio::sync::Mutex as TokioMutex;

use crate::process::agent_runner::{AgentRunner, AgentSession};
use crate::process::agent_session::AgentSessionManager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub task_id: String,
    pub agent_type: String,
    pub status: String,
    pub pid: Option<u32>,
    pub working_dir: String,
}

impl From<&AgentSession> for AgentInfo {
    fn from(s: &AgentSession) -> Self {
        Self {
            task_id: s.task_id.clone(),
            agent_type: s.agent_type.clone(),
            status: format!("{:?}", s.status),
            pid: s.pid,
            working_dir: s.working_dir.clone(),
        }
    }
}

impl From<AgentSession> for AgentInfo {
    fn from(s: AgentSession) -> Self {
        Self {
            task_id: s.task_id.clone(),
            agent_type: s.agent_type.clone(),
            status: format!("{:?}", s.status),
            pid: s.pid,
            working_dir: s.working_dir.clone(),
        }
    }
}

// Legacy PTY-based agent start (kept for backwards compatibility)
#[tauri::command(rename_all = "camelCase")]
pub async fn start_agent(
    task_id: String,
    agent_type: String,
    working_dir: String,
    env_vars: Option<HashMap<String, String>>,
    cli_path: Option<String>,
    app_handle: AppHandle,
    agent_runner: State<'_, Arc<StdMutex<AgentRunner>>>,
) -> Result<AgentInfo, String> {
    let mut runner = agent_runner
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    let session = runner.start_agent(
        &task_id,
        &agent_type,
        &working_dir,
        env_vars,
        cli_path,
        app_handle,
    )?;

    Ok(AgentInfo::from(session))
}

#[tauri::command(rename_all = "camelCase")]
pub fn stop_agent(
    task_id: String,
    agent_runner: State<'_, Arc<StdMutex<AgentRunner>>>,
) -> Result<(), String> {
    let mut runner = agent_runner
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    runner.stop_agent(&task_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn force_stop_agent(
    task_id: String,
    agent_runner: State<'_, Arc<StdMutex<AgentRunner>>>,
) -> Result<(), String> {
    let mut runner = agent_runner
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    runner.force_stop_agent(&task_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_agent_status(
    task_id: String,
    agent_runner: State<'_, Arc<StdMutex<AgentRunner>>>,
) -> Result<AgentInfo, String> {
    let runner = agent_runner
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    runner
        .get_status(&task_id)
        .map(AgentInfo::from)
        .ok_or_else(|| format!("No agent session for task: {}", task_id))
}

#[tauri::command]
pub fn list_active_agents(
    agent_runner: State<'_, Arc<StdMutex<AgentRunner>>>,
) -> Result<Vec<AgentInfo>, String> {
    let runner = agent_runner
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    Ok(runner.list_active().into_iter().map(AgentInfo::from).collect())
}

// ─── New streaming agent commands (like orchestrator) ──────────────────────

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
    app_handle: AppHandle,
    agent_sessions: State<'_, Arc<TokioMutex<AgentSessionManager>>>,
) -> Result<(), String> {
    let mut sessions = agent_sessions.lock().await;

    // Send message and stream response
    sessions.send_message(&task_id, &message, &app_handle).await?;

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
