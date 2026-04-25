//! Orchestrator commands for Tauri IPC
//!
//! The orchestrator is a dedicated agent that interprets natural language
//! and creates/manages tasks on the board.

use std::collections::HashMap;

use crate::chat::events::{ChatEvent, ToolStatus};
use crate::chat::registry::SharedSessionRegistry;
use crate::chat::session::{SessionConfig, TransportType, UnifiedChatSession};
use crate::chat::ChefSession;
use crate::db::{self, AppState, ChatMessage, ChatSession, Column, OrchestratorSession, Task};
use crate::error::AppError;
use crate::llm::types::{LlmRequest, Message};
use crate::llm::{
    calculate_cost, execute_tools, orchestrator_tools, parse_cli_action_blocks, resolve_model_id,
    tools_to_api_format, AnthropicClient,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, Mutex};
use tokio::task::AbortHandle;

// ─── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorContext {
    pub workspace_id: String,
    pub workspace_name: String,
    pub columns: Vec<Column>,
    pub tasks: Vec<Task>,
    pub recent_messages: Vec<ChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorAction {
    pub action_type: String, // create_task, update_task, split_task, etc.
    pub title: Option<String>,
    pub description: Option<String>,
    pub column_id: Option<String>,
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrchestratorResponse {
    pub message: String,
    pub actions: Vec<OrchestratorAction>,
    pub tasks_created: Vec<Task>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorEvent {
    pub workspace_id: String,
    pub session_id: String,
    pub event_type: String,
    pub message: Option<String>,
}

/// Payload for streaming chunks
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamChunkPayload {
    pub workspace_id: String,
    pub session_id: String,
    pub delta: String,
    pub finish_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use: Option<ToolUsePayload>,
}

/// Tool use info for frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolUsePayload {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
}

/// Tool execution result for frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultPayload {
    pub workspace_id: String,
    pub session_id: String,
    pub tool_use_id: String,
    pub result: String,
    pub is_error: bool,
}

/// Thinking block payload for frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingPayload {
    pub workspace_id: String,
    pub session_id: String,
    pub content: String,
    pub is_complete: bool,
}

/// Tool call status payload for frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallPayload {
    pub workspace_id: String,
    pub session_id: String,
    pub tool_id: String,
    pub tool_name: String,
    pub status: String, // "running" | "complete" | "error"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
}

/// Tracks abort handles for in-flight API orchestrator streams so cancel can stop them.
#[derive(Default)]
pub struct ApiStreamRegistry {
    handles: Mutex<HashMap<String, AbortHandle>>,
}

impl ApiStreamRegistry {
    async fn insert(&self, key: String, handle: AbortHandle) {
        let mut handles = self.handles.lock().await;
        if let Some(previous) = handles.insert(key, handle) {
            previous.abort();
        }
    }

    async fn abort(&self, key: &str) -> bool {
        let mut handles = self.handles.lock().await;
        if let Some(handle) = handles.remove(key) {
            handle.abort();
            true
        } else {
            false
        }
    }

    async fn remove(&self, key: &str) {
        self.handles.lock().await.remove(key);
    }

    #[cfg(test)]
    async fn len(&self) -> usize {
        self.handles.lock().await.len()
    }
}

fn api_stream_key(workspace_id: &str, session_id: &str) -> String {
    format!("chef-api:{}:{}", workspace_id, session_id)
}

// ─── Commands ───────────────────────────────────────────────────────────────

/// Get the orchestrator context for a workspace
#[tauri::command]
pub fn get_orchestrator_context(
    state: State<AppState>,
    workspace_id: String,
) -> Result<OrchestratorContext, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let workspace = db::get_workspace(&conn, &workspace_id)?;
    let columns = db::list_columns(&conn, &workspace_id)?;
    let tasks = db::list_tasks(&conn, &workspace_id)?;
    let recent_messages = db::list_chat_messages(&conn, &workspace_id, Some(20))?;

    Ok(OrchestratorContext {
        workspace_id: workspace.id,
        workspace_name: workspace.name,
        columns,
        tasks,
        recent_messages,
    })
}

/// Get or create the orchestrator session for a workspace
#[tauri::command]
pub fn get_orchestrator_session(
    state: State<AppState>,
    workspace_id: String,
) -> Result<OrchestratorSession, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::get_or_create_orchestrator_session(
        &conn,
        &workspace_id,
    )?)
}

/// List chat sessions for a workspace
#[tauri::command]
pub fn list_chat_sessions(
    state: State<AppState>,
    workspace_id: String,
) -> Result<Vec<ChatSession>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_chat_sessions(&conn, &workspace_id)?)
}

/// Get or create active chat session for a workspace
#[tauri::command]
pub fn get_active_chat_session(
    state: State<AppState>,
    workspace_id: String,
) -> Result<ChatSession, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::get_or_create_active_session(&conn, &workspace_id)?)
}

/// Create a new chat session
#[tauri::command]
pub fn create_chat_session(
    state: State<AppState>,
    workspace_id: String,
    title: Option<String>,
) -> Result<ChatSession, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let title = title.unwrap_or_else(|| "New Chat".to_string());
    Ok(db::create_chat_session(&conn, &workspace_id, &title)?)
}

/// Delete a chat session (also kills any running CLI process)
#[tauri::command(rename_all = "camelCase")]
pub async fn delete_chat_session(
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    session_id: String,
) -> Result<(), AppError> {
    // Look up workspace_id from the session to build registry key
    let workspace_id = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        db::get_chat_session(&conn, &session_id)
            .map(|s| s.workspace_id)
            .ok()
    };

    // Kill unified session if running
    if let Some(ws_id) = &workspace_id {
        let registry_key = format!("chef:{}:{}", ws_id, session_id);
        let mut registry = session_registry.lock().await;
        registry.remove(&registry_key);
    }

    // Delete from database
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::delete_chat_session(&conn, &session_id)?;
    Ok(())
}

/// Get chat history for a session
#[tauri::command]
pub fn get_chat_history(
    state: State<AppState>,
    session_id: String,
    limit: Option<i64>,
) -> Result<Vec<ChatMessage>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_chat_messages(&conn, &session_id, limit)?)
}

/// Clear chat history for a session
#[tauri::command]
pub fn clear_chat_history(state: State<AppState>, session_id: String) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::delete_chat_messages(&conn, &session_id)?;
    Ok(())
}

/// Reset CLI session (kill process and clear cli_session_id)
/// Call this when starting a "New Chat" to ensure fresh state
#[tauri::command(rename_all = "camelCase")]
pub async fn reset_cli_session(
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    session_id: String,
) -> Result<(), AppError> {
    // Look up workspace_id from the session to build registry key
    let workspace_id = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        db::get_chat_session(&conn, &session_id)
            .map(|s| s.workspace_id)
            .ok()
    };

    // Kill unified session if running
    if let Some(ws_id) = &workspace_id {
        let registry_key = format!("chef:{}:{}", ws_id, session_id);
        let mut registry = session_registry.lock().await;
        if let Some(session) = registry.get_mut(&registry_key) {
            let _ = session.kill();
        }
    }

    // Clear cli_session_id from database
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let _ = db::update_chat_session_cli_id(&conn, &session_id, None);
    }

    Ok(())
}

/// Process orchestrator response (creates tasks based on parsed actions)
/// This is called by the frontend after receiving structured output from the LLM
#[tauri::command]
pub fn process_orchestrator_response(
    app: AppHandle,
    state: State<AppState>,
    workspace_id: String,
    response_text: String,
    actions: Vec<OrchestratorAction>,
) -> Result<OrchestratorResponse, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Get active chat session
    let chat_session = db::get_or_create_active_session(&conn, &workspace_id)?;

    // Store assistant message
    let _ = db::insert_chat_message(
        &conn,
        &workspace_id,
        &chat_session.id,
        "assistant",
        &response_text,
    )?;

    // Process actions
    let mut tasks_created = Vec::new();

    for action in &actions {
        match action.action_type.as_str() {
            "create_task" => {
                if let (Some(title), Some(column_id)) = (&action.title, &action.column_id) {
                    let task = db::insert_task(
                        &conn,
                        &workspace_id,
                        column_id,
                        title,
                        action.description.as_deref(),
                    )?;
                    tasks_created.push(task);
                }
            }
            "update_task" => {
                if let Some(task_id) = &action.task_id {
                    let _ = db::update_task(
                        &conn,
                        task_id,
                        action.title.as_deref(),
                        action.description.as_ref().map(|d| Some(d.as_str())),
                        action.column_id.as_deref(),
                        None,
                        None,
                        None,
                    );
                }
            }
            _ => {}
        }
    }

    // Update session status to idle
    let session = db::get_or_create_orchestrator_session(&conn, &workspace_id)?;
    let _ = db::update_orchestrator_session(&conn, &session.id, Some("idle"), None);

    // Emit completion event
    let _ = app.emit(
        "orchestrator:complete",
        &OrchestratorEvent {
            workspace_id: workspace_id.clone(),
            session_id: chat_session.id.clone(),
            event_type: "complete".to_string(),
            message: Some(format!("Created {} task(s)", tasks_created.len())),
        },
    );

    Ok(OrchestratorResponse {
        message: response_text,
        actions: actions.clone(),
        tasks_created,
    })
}

/// Set orchestrator error state
#[tauri::command]
pub fn set_orchestrator_error(
    app: AppHandle,
    state: State<AppState>,
    workspace_id: String,
    error_message: String,
) -> Result<OrchestratorSession, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let session = db::get_or_create_orchestrator_session(&conn, &workspace_id)?;
    let chat_session = db::get_or_create_active_session(&conn, &workspace_id)?;
    let updated = db::update_orchestrator_session(
        &conn,
        &session.id,
        Some("error"),
        Some(Some(&error_message)),
    )?;

    // Emit error event
    let _ = app.emit(
        "orchestrator:error",
        &OrchestratorEvent {
            workspace_id,
            session_id: chat_session.id,
            event_type: "error".to_string(),
            message: Some(error_message),
        },
    );

    Ok(updated)
}

/// Stream a chat message to the LLM and emit chunks
#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "camelCase")]
pub async fn stream_orchestrator_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    api_stream_registry: State<'_, ApiStreamRegistry>,
    workspace_id: String,
    session_id: String,
    message: String,
    connection_mode: String,
    api_key: Option<String>,
    api_key_env_var: Option<String>,
    model: Option<String>,
    cli_path: Option<String>,
) -> Result<(), AppError> {
    let model = model.unwrap_or_else(|| "sonnet".to_string());

    // Store user message and get history
    let (history, orch_session_id, actual_session_id, cli_session_id) = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        // Verify session exists, or fall back to active session
        let chat_session = match db::get_chat_session(&conn, &session_id) {
            Ok(s) => s,
            Err(_) => {
                // Session doesn't exist (maybe deleted), get or create active session
                db::get_or_create_active_session(&conn, &workspace_id)?
            }
        };
        let actual_session_id = chat_session.id.clone();
        let cli_session_id = chat_session.cli_session_id.clone();

        // Store user message
        db::insert_chat_message(&conn, &workspace_id, &actual_session_id, "user", &message)?;

        // Get recent history for context
        let history = db::list_chat_messages(&conn, &actual_session_id, Some(20))?;

        // If this is the first message, update session title
        if history.len() == 1 {
            let title: String = message.chars().take(40).collect();
            let title = title.trim();
            let title = if message.chars().count() > 40 {
                format!("{}...", title)
            } else {
                title.to_string()
            };
            let _ = db::update_chat_session(&conn, &actual_session_id, Some(&title));
        }

        // Update orchestrator session status to processing
        let orch_session = db::get_or_create_orchestrator_session(&conn, &workspace_id)?;
        let _ = db::update_orchestrator_session(&conn, &orch_session.id, Some("processing"), None);

        (history, orch_session.id, actual_session_id, cli_session_id)
    };

    // Emit processing event
    let _ = app.emit(
        "orchestrator:processing",
        &OrchestratorEvent {
            workspace_id: workspace_id.clone(),
            session_id: actual_session_id.clone(),
            event_type: "processing".to_string(),
            message: Some(message.clone()),
        },
    );

    // Handle based on connection mode
    let result = match connection_mode.as_str() {
        "api" => {
            // Get API key: explicit param > env var from provider config > ANTHROPIC_API_KEY fallback
            let env_var_name = api_key_env_var.as_deref().unwrap_or("ANTHROPIC_API_KEY");
            let api_key = api_key
                .or_else(|| std::env::var(env_var_name).ok())
                .ok_or_else(|| {
                    AppError::InvalidInput(format!(
                        "No API key provided and {} not set",
                        env_var_name
                    ))
                })?;

            stream_via_api(
                app.clone(),
                state.clone(),
                api_stream_registry.inner(),
                &workspace_id,
                &actual_session_id,
                &orch_session_id,
                &api_key,
                &model,
                history,
            )
            .await
        }
        "cli" => {
            let cli = cli_path.clone().unwrap_or_else(|| "claude".to_string());
            stream_via_unified_cli(
                app.clone(),
                state.clone(),
                session_registry.clone(),
                &workspace_id,
                &actual_session_id,
                &orch_session_id,
                &cli,
                &model,
                &message,
                cli_session_id.as_deref(),
            )
            .await
        }
        _ => Err(AppError::InvalidInput(format!(
            "Unknown connection mode: {}",
            connection_mode
        ))),
    };

    if let Err(err) = &result {
        let error_message = err.to_string();

        if let Ok(conn) = state.db.lock() {
            let _ = db::update_orchestrator_session(
                &conn,
                &orch_session_id,
                Some("error"),
                Some(Some(error_message.as_str())),
            );
        }

        let _ = app.emit(
            "orchestrator:error",
            &OrchestratorEvent {
                workspace_id,
                session_id: actual_session_id,
                event_type: "error".to_string(),
                message: Some(error_message),
            },
        );
    }

    result
}

/// Cancel an ongoing orchestrator chat (kills the CLI process)
#[tauri::command(rename_all = "camelCase")]
pub async fn cancel_orchestrator_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    api_stream_registry: State<'_, ApiStreamRegistry>,
    session_id: String,
    workspace_id: String,
) -> Result<(), AppError> {
    // Kill via unified session registry
    {
        let registry_key = format!("chef:{}:{}", workspace_id, session_id);
        let mut registry = session_registry.lock().await;
        if let Some(session) = registry.get_mut(&registry_key) {
            let _ = session.kill();
        }
    }

    let _ = api_stream_registry
        .abort(&api_stream_key(&workspace_id, &session_id))
        .await;

    // Update orchestrator session to idle
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let session = db::get_or_create_orchestrator_session(&conn, &workspace_id)?;
        let _ = db::update_orchestrator_session(&conn, &session.id, Some("idle"), None);
    }

    // Emit cancelled event
    let _ = app.emit(
        "orchestrator:complete",
        &OrchestratorEvent {
            workspace_id: workspace_id.clone(),
            session_id: session_id.clone(),
            event_type: "cancelled".to_string(),
            message: Some("Request cancelled".to_string()),
        },
    );

    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn stream_via_api(
    app: AppHandle,
    state: State<'_, AppState>,
    api_stream_registry: &ApiStreamRegistry,
    workspace_id: &str,
    session_id: &str,
    orch_session_id: &str,
    api_key: &str,
    model: &str,
    history: Vec<ChatMessage>,
) -> Result<(), AppError> {
    // Resolve model alias to full API ID (e.g., "sonnet" -> "claude-sonnet-4-6-20260217")
    let model_id = resolve_model_id(model);
    let chef = ChefSession::new_api(
        workspace_id.to_string(),
        SessionConfig {
            cli_path: String::new(),
            model: model.to_string(),
            system_prompt: String::new(),
            working_dir: None,
            effort_level: None,
        },
    );

    // Get workspace context for system prompt
    let (workspace, columns, tasks) = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let workspace = db::get_workspace(&conn, workspace_id)?;
        let columns = db::list_columns(&conn, workspace_id)?;
        let tasks = db::list_tasks(&conn, workspace_id)?;
        (workspace, columns, tasks)
    };

    // Build system prompt with board context
    let system_prompt = chef.build_system_prompt(&workspace, &columns, &tasks);

    // Build messages from history, injecting board context into the last user message
    let mut messages: Vec<Message> = Vec::new();
    let history_len = history.len();

    for (i, m) in history.iter().enumerate() {
        if m.role == "system" {
            continue;
        }

        // For the last user message, prepend board context
        if m.role == "user" && i == history_len - 1 {
            messages.push(Message {
                role: m.role.clone(),
                content: chef.augment_message(&m.content, &workspace, &columns, &tasks),
            });
        } else {
            messages.push(Message {
                role: m.role.clone(),
                content: m.content.clone(),
            });
        }
    }

    // Build tool definitions
    let tools = orchestrator_tools();
    let tools_json = tools_to_api_format(&tools);

    let request = LlmRequest {
        model: model_id.to_string(),
        messages,
        system: Some(system_prompt),
        max_tokens: Some(4096),
        temperature: None,
        stream: true,
        tools: Some(tools_json),
    };

    // Create channel for streaming
    let (tx, mut rx) = mpsc::channel(100);

    // Spawn the streaming task
    let client = AnthropicClient::new(api_key.to_string());
    let app_clone = app.clone();
    let workspace_id_clone = workspace_id.to_string();
    let mut pending_tool_calls: HashMap<String, (String, serde_json::Value)> = HashMap::new();

    let stream_handle = tokio::spawn(async move { client.stream_chat(request, tx).await });
    let stream_registry_key = api_stream_key(workspace_id, session_id);
    api_stream_registry
        .insert(stream_registry_key.clone(), stream_handle.abort_handle())
        .await;

    // Forward chunks to frontend
    while let Some(chunk) = rx.recv().await {
        let tool_use_payload = chunk.tool_use.as_ref().map(|tu| {
            pending_tool_calls.insert(tu.id.clone(), (tu.name.clone(), tu.input.clone()));

            let _ = app_clone.emit(
                "orchestrator:tool_call",
                &ToolCallPayload {
                    workspace_id: workspace_id_clone.clone(),
                    session_id: session_id.to_string(),
                    tool_id: tu.id.clone(),
                    tool_name: tu.name.clone(),
                    status: "running".to_string(),
                    input: Some(tu.input.clone()),
                    result: None,
                },
            );

            ToolUsePayload {
                id: tu.id.clone(),
                name: tu.name.clone(),
                input: tu.input.clone(),
            }
        });

        let _ = app_clone.emit(
            "orchestrator:stream",
            &StreamChunkPayload {
                workspace_id: workspace_id_clone.clone(),
                session_id: session_id.to_string(),
                delta: chunk.delta,
                finish_reason: chunk.finish_reason.clone(),
                tool_use: tool_use_payload,
            },
        );
    }

    // Wait for streaming to complete and get response
    api_stream_registry.remove(&stream_registry_key).await;
    let response = match stream_handle.await {
        Ok(result) => result.map_err(AppError::DatabaseError)?,
        Err(err) if err.is_cancelled() => return Ok(()),
        Err(err) => {
            return Err(AppError::DatabaseError(format!(
                "Stream task failed: {}",
                err
            )))
        }
    };

    // Execute any tool calls
    let mut tool_results_summary = String::new();
    if !response.tool_uses.is_empty() {
        let tool_uses: Vec<crate::llm::ToolUse> = response
            .tool_uses
            .iter()
            .map(|tu| crate::llm::ToolUse {
                id: tu.id.clone(),
                name: tu.name.clone(),
                input: tu.input.clone(),
            })
            .collect();

        let execution_result = {
            let conn = state
                .db
                .lock()
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;
            execute_tools(&conn, &app, workspace_id, &tool_uses, &columns)?
        };

        // Emit tool results to frontend
        for result in &execution_result.results {
            let (tool_name, tool_input) = pending_tool_calls
                .get(&result.tool_use_id)
                .cloned()
                .unwrap_or_else(|| ("unknown".to_string(), serde_json::Value::Null));

            let _ = app.emit(
                "orchestrator:tool_result",
                &ToolResultPayload {
                    workspace_id: workspace_id.to_string(),
                    session_id: session_id.to_string(),
                    tool_use_id: result.tool_use_id.clone(),
                    result: result.content.clone(),
                    is_error: result.is_error,
                },
            );

            let _ = app.emit(
                "orchestrator:tool_call",
                &ToolCallPayload {
                    workspace_id: workspace_id.to_string(),
                    session_id: session_id.to_string(),
                    tool_id: result.tool_use_id.clone(),
                    tool_name,
                    status: if result.is_error { "error" } else { "complete" }.to_string(),
                    input: if tool_input.is_null() {
                        None
                    } else {
                        Some(tool_input)
                    },
                    result: Some(result.content.clone()),
                },
            );
        }

        tool_results_summary = execution_result.summary;
    }

    // Build final assistant message content
    let assistant_content = if tool_results_summary.is_empty() {
        response.content.clone()
    } else if response.content.is_empty() {
        tool_results_summary
    } else {
        format!("{}\n\n{}", response.content, tool_results_summary)
    };

    // Store assistant message and usage
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        // Store assistant response
        let assistant_msg = db::insert_chat_message(
            &conn,
            workspace_id,
            session_id,
            "assistant",
            &assistant_content,
        )?;

        // Record usage (use original alias for cost lookup since model info uses aliases)
        let cost = calculate_cost(model, &response.usage);
        let _ = db::insert_usage_record(
            &conn,
            workspace_id,
            None, // task_id
            Some(orch_session_id),
            "anthropic",
            &response.model,
            response.usage.input_tokens,
            response.usage.output_tokens,
            cost,
        );

        // Update orchestrator session to idle
        let _ = db::update_orchestrator_session(&conn, orch_session_id, Some("idle"), None);

        // Emit complete event
        let _ = app.emit(
            "orchestrator:complete",
            &OrchestratorEvent {
                workspace_id: workspace_id.to_string(),
                session_id: session_id.to_string(),
                event_type: "complete".to_string(),
                message: Some(assistant_msg.id),
            },
        );
    }

    Ok(())
}

/// Stream orchestrator chat via unified CLI session.
///
/// Replaces the old `stream_via_cli` which used `CliSessionManager`.
/// Uses `UnifiedChatSession` from the `SessionRegistry` with board
/// context injection and retry logic for stale resume IDs.
#[allow(clippy::too_many_arguments)]
async fn stream_via_unified_cli(
    app: AppHandle,
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    workspace_id: &str,
    session_id: &str,
    orch_session_id: &str,
    cli_path: &str,
    model: &str,
    message: &str,
    resume_id: Option<&str>,
) -> Result<(), AppError> {
    let registry_key = format!("chef:{}:{}", workspace_id, session_id);

    // Send message via unified session
    let (full_response, captured_cli_session_id) = {
        let mut registry = session_registry.lock().await;

        let config = SessionConfig {
            cli_path: cli_path.to_string(),
            model: model.to_string(),
            system_prompt: String::new(), // Built from workspace state below
            working_dir: None,
            effort_level: None,
        };
        let prompt_builder = ChefSession::new_cli(workspace_id.to_string(), config.clone());

        // Get or create session
        if !registry.has(&registry_key) {
            let mut session = UnifiedChatSession::new(config, TransportType::Pipe);
            // Set resume ID from DB if available
            if let Some(rid) = resume_id {
                session.set_resume_id(Some(rid.to_string()));
            }
            registry.insert(&registry_key, session);
        }

        let session = registry.get_mut(&registry_key).unwrap();

        // Check model change before updating (set_model clears resume if changed)
        let model_changed = session.model() != model;
        session.set_model(model.to_string());

        // Restore resume from DB only if model hasn't changed and session
        // lost its resume (e.g. after cancel). Don't restore on model change
        // — the DB resume is for the old model and would be stale.
        if !model_changed && session.resume_id().is_none() {
            if let Some(rid) = resume_id {
                session.set_resume_id(Some(rid.to_string()));
            }
        }

        // Build system prompt + board context, then send
        let (workspace, columns, tasks) = {
            let conn = state
                .db
                .lock()
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;
            let workspace = db::get_workspace(&conn, workspace_id)?;
            let columns = db::list_columns(&conn, workspace_id)?;
            let tasks = db::list_tasks(&conn, workspace_id)?;
            (workspace, columns, tasks)
        };

        let system_prompt = prompt_builder.build_system_prompt(&workspace, &columns, &tasks);
        session.set_system_prompt(system_prompt);
        let full_message = prompt_builder.augment_message(message, &workspace, &columns, &tasks);

        // Forward events to frontend
        let ws_id = workspace_id.to_string();
        let session_id_for_events = session_id.to_string();
        let app_for_events = app.clone();

        let result = session
            .send_message(&full_message, move |event| {
                emit_orchestrator_cli_event(&app_for_events, &ws_id, &session_id_for_events, event);
            })
            .await;

        match result {
            Ok((response, sid)) => {
                // Check for empty response (stale resume)
                if response.is_empty() {
                    log::warn!(
                        "Empty CLI response — likely stale --resume, retrying without resume"
                    );
                    session.set_resume_id(None);

                    // Clear stale cli_session_id from DB
                    {
                        let conn = state
                            .db
                            .lock()
                            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
                        let _ = db::update_chat_session_cli_id(&conn, session_id, None);
                    }

                    // Rebuild context and retry
                    let ws_id2 = workspace_id.to_string();
                    let session_id2 = session_id.to_string();
                    let app_retry = app.clone();
                    session
                        .send_message(&full_message, move |event| {
                            emit_orchestrator_cli_event(&app_retry, &ws_id2, &session_id2, event);
                        })
                        .await
                        .map_err(AppError::InvalidInput)?
                } else {
                    (response, sid)
                }
            }
            Err(e) => {
                // Send failed — clear resume and retry once
                log::warn!("CLI send failed: {}, retrying without resume", e);
                session.set_resume_id(None);

                let ws_id2 = workspace_id.to_string();
                let session_id2 = session_id.to_string();
                let app_retry = app.clone();
                session
                    .send_message(&full_message, move |event| {
                        emit_orchestrator_cli_event(&app_retry, &ws_id2, &session_id2, event);
                    })
                    .await
                    .map_err(AppError::InvalidInput)?
            }
        }
    };

    // Save cli_session_id to database
    if let Some(cli_sid) = &captured_cli_session_id {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let _ = db::update_chat_session_cli_id(&conn, session_id, Some(cli_sid));
    }

    // Parse action blocks and execute tools
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let tool_uses = parse_cli_action_blocks(&full_response);

        if !tool_uses.is_empty() {
            let columns = db::list_columns(&conn, workspace_id)?;
            match execute_tools(&conn, &app, workspace_id, &tool_uses, &columns) {
                Ok(result) => {
                    for tool_result in &result.results {
                        if tool_result.is_error {
                            log::warn!("CLI action error: {}", tool_result.content);
                        }
                        let _ = app.emit(
                            "orchestrator:tool_result",
                            &ToolResultPayload {
                                workspace_id: workspace_id.to_string(),
                                session_id: session_id.to_string(),
                                tool_use_id: tool_result.tool_use_id.clone(),
                                result: tool_result.content.clone(),
                                is_error: tool_result.is_error,
                            },
                        );
                    }
                }
                Err(e) => {
                    log::error!("CLI action execution failed: {}", e);
                    let _ = app.emit(
                        "orchestrator:error",
                        &OrchestratorEvent {
                            workspace_id: workspace_id.to_string(),
                            session_id: session_id.to_string(),
                            event_type: "warning".to_string(),
                            message: Some(format!("Action execution failed: {}", e)),
                        },
                    );
                }
            }
        }
    }

    // Store assistant message and emit completion
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let assistant_msg =
            db::insert_chat_message(&conn, workspace_id, session_id, "assistant", &full_response)?;
        let _ = db::update_orchestrator_session(&conn, orch_session_id, Some("idle"), None);

        let _ = app.emit(
            "orchestrator:complete",
            &OrchestratorEvent {
                workspace_id: workspace_id.to_string(),
                session_id: session_id.to_string(),
                event_type: "complete".to_string(),
                message: Some(assistant_msg.id.clone()),
            },
        );
    }

    // Emit finish event (empty delta with finish_reason)
    let _ = app.emit(
        "orchestrator:stream",
        &StreamChunkPayload {
            workspace_id: workspace_id.to_string(),
            session_id: session_id.to_string(),
            delta: String::new(),
            finish_reason: Some("stop".to_string()),
            tool_use: None,
        },
    );

    Ok(())
}

/// Forward ChatEvent to orchestrator-specific Tauri events.
fn emit_orchestrator_cli_event(
    app: &AppHandle,
    workspace_id: &str,
    session_id: &str,
    event: ChatEvent,
) {
    match event {
        ChatEvent::TextContent(content) => {
            let _ = app.emit(
                "orchestrator:stream",
                &StreamChunkPayload {
                    workspace_id: workspace_id.to_string(),
                    session_id: session_id.to_string(),
                    delta: content,
                    finish_reason: None,
                    tool_use: None,
                },
            );
        }
        ChatEvent::ThinkingContent {
            content,
            is_complete,
        } => {
            let _ = app.emit(
                "orchestrator:thinking",
                &ThinkingPayload {
                    workspace_id: workspace_id.to_string(),
                    session_id: session_id.to_string(),
                    content,
                    is_complete,
                },
            );
        }
        ChatEvent::ToolUse {
            id, name, status, ..
        } => {
            let status_str = match status {
                ToolStatus::Running => "running",
                ToolStatus::Complete => "complete",
            };
            let _ = app.emit(
                "orchestrator:tool_call",
                &ToolCallPayload {
                    workspace_id: workspace_id.to_string(),
                    session_id: session_id.to_string(),
                    tool_id: id,
                    tool_name: name,
                    status: status_str.to_string(),
                    input: None,
                    result: None,
                },
            );
        }
        ChatEvent::Complete
        | ChatEvent::SessionId(_)
        | ChatEvent::RawOutput(_)
        | ChatEvent::Unknown => {}
    }
}

#[cfg(test)]
mod tests {
    use super::{api_stream_key, ApiStreamRegistry};

    #[test]
    fn test_api_stream_key() {
        assert_eq!(
            api_stream_key("ws-1", "session-1"),
            "chef-api:ws-1:session-1"
        );
    }

    #[tokio::test]
    async fn test_api_stream_registry_abort() {
        let registry = ApiStreamRegistry::default();
        let handle = tokio::spawn(async {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        });

        registry
            .insert("stream-1".to_string(), handle.abort_handle())
            .await;
        assert_eq!(registry.len().await, 1);

        assert!(registry.abort("stream-1").await);
        assert_eq!(registry.len().await, 0);
        assert!(handle.await.unwrap_err().is_cancelled());
    }

    #[tokio::test]
    async fn test_api_stream_registry_replaces_existing_handle() {
        let registry = ApiStreamRegistry::default();
        let first = tokio::spawn(async {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        });
        let second = tokio::spawn(async {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        });

        registry
            .insert("stream-1".to_string(), first.abort_handle())
            .await;
        registry
            .insert("stream-1".to_string(), second.abort_handle())
            .await;

        assert_eq!(registry.len().await, 1);
        assert!(first.await.unwrap_err().is_cancelled());

        assert!(registry.abort("stream-1").await);
        assert!(second.await.unwrap_err().is_cancelled());
    }
}
