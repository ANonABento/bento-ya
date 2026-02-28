use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::AppHandle;

use super::pty_manager::PtyManager;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentStatus {
    Running,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub task_id: String,
    pub agent_type: String,
    pub status: AgentStatus,
    pub pid: Option<u32>,
    pub working_dir: String,
}

pub struct AgentRunner {
    sessions: HashMap<String, AgentSession>,
    pty_manager: Arc<Mutex<PtyManager>>,
}

impl AgentRunner {
    pub fn new(pty_manager: Arc<Mutex<PtyManager>>) -> Self {
        Self {
            sessions: HashMap::new(),
            pty_manager,
        }
    }

    pub fn start_agent(
        &mut self,
        task_id: &str,
        agent_type: &str,
        working_dir: &str,
        env_vars: Option<HashMap<String, String>>,
        app_handle: AppHandle,
    ) -> Result<AgentSession, String> {
        if self.sessions.contains_key(task_id) {
            return Err(format!("Agent already running for task: {}", task_id));
        }

        let (command, args) = agent_command(agent_type);

        let pid = {
            let mut pty = self
                .pty_manager
                .lock()
                .map_err(|e| format!("Lock error: {}", e))?;

            pty.spawn(
                task_id,
                &command,
                &args,
                Some(working_dir),
                env_vars.as_ref(),
                120,
                40,
                app_handle,
            )
            .map_err(|e| e.to_string())?
        };

        let session = AgentSession {
            task_id: task_id.to_string(),
            agent_type: agent_type.to_string(),
            status: AgentStatus::Running,
            pid: Some(pid),
            working_dir: working_dir.to_string(),
        };

        self.sessions.insert(task_id.to_string(), session.clone());
        Ok(session)
    }

    pub fn stop_agent(&mut self, task_id: &str) -> Result<(), String> {
        // First try SIGINT via writing Ctrl+C to the PTY
        {
            let mut pty = self
                .pty_manager
                .lock()
                .map_err(|e| format!("Lock error: {}", e))?;

            // Send Ctrl+C (ETX byte)
            let _ = pty.write(task_id, &[0x03]);
        }

        if let Some(session) = self.sessions.get_mut(task_id) {
            session.status = AgentStatus::Stopped;
        }

        Ok(())
    }

    pub fn force_stop_agent(&mut self, task_id: &str) -> Result<(), String> {
        {
            let mut pty = self
                .pty_manager
                .lock()
                .map_err(|e| format!("Lock error: {}", e))?;

            pty.kill(task_id).map_err(|e| e.to_string())?;
        }

        if let Some(session) = self.sessions.get_mut(task_id) {
            session.status = AgentStatus::Stopped;
        }

        Ok(())
    }

    pub fn get_status(&self, task_id: &str) -> Option<&AgentSession> {
        self.sessions.get(task_id)
    }

    pub fn list_active(&self) -> Vec<&AgentSession> {
        self.sessions
            .values()
            .filter(|s| matches!(s.status, AgentStatus::Running))
            .collect()
    }

    pub fn mark_exited(&mut self, task_id: &str) {
        if let Some(session) = self.sessions.get_mut(task_id) {
            session.status = AgentStatus::Stopped;
        }
    }
}

fn agent_command(agent_type: &str) -> (String, Vec<String>) {
    match agent_type {
        "claude" | _ => ("claude".to_string(), Vec::new()),
    }
}
