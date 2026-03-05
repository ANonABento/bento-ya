use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::db::{self, AppState, AgentMessage};
use crate::error::AppError;
use crate::process::agent_cli_session::{
    AgentCompletePayload, SharedAgentCliSessionManager,
};
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

#[tauri::command(rename_all = "camelCase")]
pub async fn start_agent(
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

#[tauri::command(rename_all = "camelCase")]
pub fn stop_agent(
    task_id: String,
    agent_runner: State<'_, Arc<Mutex<AgentRunner>>>,
) -> Result<(), String> {
    let mut runner = agent_runner
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    runner.stop_agent(&task_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn force_stop_agent(
    task_id: String,
    agent_runner: State<'_, Arc<Mutex<AgentRunner>>>,
) -> Result<(), String> {
    let mut runner = agent_runner
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    runner.force_stop_agent(&task_id)
}

#[tauri::command(rename_all = "camelCase")]
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

// ─── Agent Message Commands ────────────────────────────────────────────────

#[tauri::command(rename_all = "camelCase")]
pub fn save_agent_message(
    state: State<AppState>,
    task_id: String,
    role: String,
    content: String,
    model: Option<String>,
    effort_level: Option<String>,
    tool_calls: Option<String>,
    thinking_content: Option<String>,
) -> Result<AgentMessage, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::insert_agent_message(
        &conn,
        &task_id,
        &role,
        &content,
        model.as_deref(),
        effort_level.as_deref(),
        tool_calls.as_deref(),
        thinking_content.as_deref(),
    )?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_agent_messages(
    state: State<AppState>,
    task_id: String,
) -> Result<Vec<AgentMessage>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_agent_messages(&conn, &task_id)?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn clear_agent_messages(
    state: State<AppState>,
    task_id: String,
) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::clear_agent_messages(&conn, &task_id)?;
    Ok(())
}

// ─── Agent CLI Session Commands ────────────────────────────────────────────

/// Stream a message to the per-task agent CLI and emit response chunks
#[tauri::command(rename_all = "camelCase")]
pub async fn stream_agent_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    agent_cli_manager: State<'_, SharedAgentCliSessionManager>,
    task_id: String,
    message: String,
    working_dir: String,
    cli_path: String,
    model: Option<String>,
    effort_level: Option<String>,
) -> Result<(), AppError> {
    let model = model.unwrap_or_else(|| "sonnet".to_string());

    // 1. Save user message to DB
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        db::insert_agent_message(
            &conn,
            &task_id,
            "user",
            &message,
            Some(&model),
            effort_level.as_deref(),
            None,
            None,
        )?;
    }

    // 2. Build agent system prompt
    let system_prompt = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let task = db::get_task(&conn, &task_id)?;
        format!(
            r#"You are an AI assistant helping with the task: "{}"

Task Description:
{}

Work in the current directory. You have access to tools for reading/editing files, running commands, etc.
Be concise and helpful."#,
            task.title,
            task.description.unwrap_or_default()
        )
    };

    // 3. Get stored CLI session ID for resume
    let stored_cli_id = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        db::list_agent_sessions(&conn, &task_id)?
            .first()
            .and_then(|s| s.cli_session_id.clone())
    };

    // 4. Get or spawn CLI session
    let mut manager = agent_cli_manager.lock().await;

    let model_changed = manager
        .get_model(&task_id)
        .map(|m| m != model)
        .unwrap_or(false);
    let needs_spawn =
        !manager.has_session(&task_id) || !manager.is_alive(&task_id) || model_changed;

    if needs_spawn {
        manager
            .spawn(
                &task_id,
                &cli_path,
                &working_dir,
                &model,
                effort_level.as_deref(),
                &system_prompt,
                stored_cli_id.as_deref(),
            )
            .await
            .map_err(|e| AppError::InvalidInput(e))?;
    }

    // 5. Send message and stream response
    let (full_response, captured_cli_session_id) =
        match manager.send_message(&task_id, &message, &app).await {
            Ok(result) => result,
            Err(_) => {
                // Process died, try respawn with --resume
                let resume_id = manager.get_cli_session_id(&task_id);
                manager.kill(&task_id).await;

                manager
                    .spawn(
                        &task_id,
                        &cli_path,
                        &working_dir,
                        &model,
                        effort_level.as_deref(),
                        &system_prompt,
                        resume_id.as_deref(),
                    )
                    .await
                    .map_err(|e| AppError::InvalidInput(e))?;

                manager
                    .send_message(&task_id, &message, &app)
                    .await
                    .map_err(|e| AppError::InvalidInput(e))?
            }
        };

    // Drop manager lock before DB operations
    drop(manager);

    // 6. Save cli_session_id and assistant message
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        // Update agent_session with cli_session_id if we have one
        if let Some(cli_sid) = &captured_cli_session_id {
            let agent_session =
                db::get_or_create_agent_session_for_task(&conn, &task_id, "claude", Some(&working_dir))?;
            db::update_agent_session_cli(
                &conn,
                &agent_session.id,
                Some(cli_sid),
                Some(&model),
                effort_level.as_deref(),
            )?;
        }

        // Save assistant message
        db::insert_agent_message(
            &conn,
            &task_id,
            "assistant",
            &full_response,
            Some(&model),
            effort_level.as_deref(),
            None,
            None,
        )?;
    }

    // 7. Emit completion event
    let _ = app.emit(
        "agent:complete",
        &AgentCompletePayload {
            task_id: task_id.clone(),
            success: true,
            message: None,
        },
    );

    Ok(())
}

/// Cancel an ongoing agent chat (kills the CLI process)
#[tauri::command(rename_all = "camelCase")]
pub async fn cancel_agent_chat(
    app: AppHandle,
    agent_cli_manager: State<'_, SharedAgentCliSessionManager>,
    task_id: String,
) -> Result<(), AppError> {
    {
        let mut manager = agent_cli_manager.lock().await;
        manager.kill(&task_id).await;
    }

    // Emit cancelled event
    let _ = app.emit(
        "agent:complete",
        &AgentCompletePayload {
            task_id: task_id.clone(),
            success: false,
            message: Some("Cancelled".to_string()),
        },
    );

    Ok(())
}
