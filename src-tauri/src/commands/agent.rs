use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::process::agent_runner::{AgentRunner, AgentSession};

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

#[tauri::command]
pub fn start_agent(
    task_id: String,
    agent_type: String,
    working_dir: String,
    env_vars: Option<HashMap<String, String>>,
    cli_path: Option<String>,
    app_handle: AppHandle,
    agent_runner: State<'_, Arc<Mutex<AgentRunner>>>,
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

#[tauri::command]
pub fn stop_agent(
    task_id: String,
    agent_runner: State<'_, Arc<Mutex<AgentRunner>>>,
) -> Result<(), String> {
    let mut runner = agent_runner
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    runner.stop_agent(&task_id)
}

#[tauri::command]
pub fn force_stop_agent(
    task_id: String,
    agent_runner: State<'_, Arc<Mutex<AgentRunner>>>,
) -> Result<(), String> {
    let mut runner = agent_runner
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    runner.force_stop_agent(&task_id)
}

#[tauri::command]
pub fn get_agent_status(
    task_id: String,
    agent_runner: State<'_, Arc<Mutex<AgentRunner>>>,
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
    agent_runner: State<'_, Arc<Mutex<AgentRunner>>>,
) -> Result<Vec<AgentInfo>, String> {
    let runner = agent_runner
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;

    Ok(runner.list_active().into_iter().map(AgentInfo::from).collect())
}
