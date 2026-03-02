//! Orchestrator commands for Tauri IPC
//!
//! The orchestrator is a dedicated agent that interprets natural language
//! and creates/manages tasks on the board.

use crate::db::{self, AppState, ChatMessage, OrchestratorSession, Column, Task};
use crate::error::AppError;
use crate::llm::{AnthropicClient, calculate_cost, resolve_model_id};
use crate::llm::types::{LlmRequest, Message};
use tauri::{AppHandle, Emitter, State};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

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
pub struct OrchestratorEvent {
    pub workspace_id: String,
    pub event_type: String,
    pub message: Option<String>,
}

/// Payload for streaming chunks
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamChunkPayload {
    pub workspace_id: String,
    pub delta: String,
    pub finish_reason: Option<String>,
}

// ─── Commands ───────────────────────────────────────────────────────────────

/// Get the orchestrator context for a workspace
#[tauri::command]
pub fn get_orchestrator_context(
    state: State<AppState>,
    workspace_id: String,
) -> Result<OrchestratorContext, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    
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
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::get_or_create_orchestrator_session(&conn, &workspace_id)?)
}

/// Send a message to the orchestrator
#[tauri::command]
pub fn send_orchestrator_message(
    app: AppHandle,
    state: State<AppState>,
    workspace_id: String,
    message: String,
) -> Result<ChatMessage, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    
    // Store user message
    let user_msg = db::insert_chat_message(&conn, &workspace_id, "user", &message)?;
    
    // Update session status to processing
    let session = db::get_or_create_orchestrator_session(&conn, &workspace_id)?;
    let _ = db::update_orchestrator_session(&conn, &session.id, Some("processing"), None);
    
    // Emit event
    let _ = app.emit("orchestrator:processing", &OrchestratorEvent {
        workspace_id: workspace_id.clone(),
        event_type: "processing".to_string(),
        message: Some(message.clone()),
    });
    
    Ok(user_msg)
}

/// Get chat history for a workspace
#[tauri::command]
pub fn get_chat_history(
    state: State<AppState>,
    workspace_id: String,
    limit: Option<i64>,
) -> Result<Vec<ChatMessage>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_chat_messages(&conn, &workspace_id, limit)?)
}

/// Clear chat history for a workspace
#[tauri::command]
pub fn clear_chat_history(
    state: State<AppState>,
    workspace_id: String,
) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::delete_chat_messages(&conn, &workspace_id)?;
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
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    
    // Store assistant message
    let _ = db::insert_chat_message(&conn, &workspace_id, "assistant", &response_text)?;
    
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
    let _ = app.emit("orchestrator:complete", &OrchestratorEvent {
        workspace_id: workspace_id.clone(),
        event_type: "complete".to_string(),
        message: Some(format!("Created {} task(s)", tasks_created.len())),
    });
    
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
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    
    let session = db::get_or_create_orchestrator_session(&conn, &workspace_id)?;
    let updated = db::update_orchestrator_session(&conn, &session.id, Some("error"), Some(Some(&error_message)))?;
    
    // Emit error event
    let _ = app.emit("orchestrator:error", &OrchestratorEvent {
        workspace_id,
        event_type: "error".to_string(),
        message: Some(error_message),
    });

    Ok(updated)
}

/// Stream a chat message to the LLM and emit chunks
#[tauri::command(rename_all = "camelCase")]
pub async fn stream_orchestrator_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    message: String,
    connection_mode: String,
    api_key: Option<String>,
    model: Option<String>,
    cli_path: Option<String>,
) -> Result<(), AppError> {
    let model = model.unwrap_or_else(|| "sonnet".to_string());

    // Store user message and get history
    let (history, session_id) = {
        let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;

        // Store user message
        db::insert_chat_message(&conn, &workspace_id, "user", &message)?;

        // Update session status to processing
        let session = db::get_or_create_orchestrator_session(&conn, &workspace_id)?;
        let _ = db::update_orchestrator_session(&conn, &session.id, Some("processing"), None);

        // Get recent history for context
        let history = db::list_chat_messages(&conn, &workspace_id, Some(20))?;

        (history, session.id)
    };

    // Emit processing event
    let _ = app.emit("orchestrator:processing", &OrchestratorEvent {
        workspace_id: workspace_id.clone(),
        event_type: "processing".to_string(),
        message: Some(message.clone()),
    });

    // Handle based on connection mode
    match connection_mode.as_str() {
        "api" => {
            // Get API key from param or environment
            let api_key = api_key
                .or_else(|| std::env::var("ANTHROPIC_API_KEY").ok())
                .ok_or_else(|| AppError::InvalidInput("No API key provided and ANTHROPIC_API_KEY not set".to_string()))?;
            
            stream_via_api(app.clone(), state.clone(), &workspace_id, &session_id, &api_key, &model, history).await
        }
        "cli" => {
            let cli = cli_path.unwrap_or_else(|| "claude".to_string());
            stream_via_cli(app.clone(), state.clone(), &workspace_id, &session_id, &cli, &model, history).await
        }
        _ => {
            Err(AppError::InvalidInput(format!("Unknown connection mode: {}", connection_mode)))
        }
    }
}

async fn stream_via_api(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: &str,
    api_key: &str,
    model: &str,
    history: Vec<ChatMessage>,
) -> Result<(), AppError> {
    // Resolve model alias to full API ID (e.g., "sonnet" -> "claude-sonnet-4-6-20260217")
    let model_id = resolve_model_id(model);

    // Build messages from history
    let messages: Vec<Message> = history
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| Message {
            role: m.role.clone(),
            content: m.content.clone(),
        })
        .collect();

    let request = LlmRequest {
        model: model_id.to_string(),
        messages,
        max_tokens: Some(4096),
        temperature: None,
        stream: true,
    };

    // Create channel for streaming
    let (tx, mut rx) = mpsc::channel(100);

    // Spawn the streaming task
    let client = AnthropicClient::new(api_key.to_string());
    let app_clone = app.clone();
    let workspace_id_clone = workspace_id.to_string();

    let stream_handle = tokio::spawn(async move {
        client.stream_chat(request, tx).await
    });

    // Forward chunks to frontend
    while let Some(chunk) = rx.recv().await {
        let _ = app_clone.emit("orchestrator:stream", &StreamChunkPayload {
            workspace_id: workspace_id_clone.clone(),
            delta: chunk.delta,
            finish_reason: chunk.finish_reason,
        });
    }

    // Wait for streaming to complete and get response
    let response = stream_handle
        .await
        .map_err(|e| AppError::DatabaseError(format!("Stream task failed: {}", e)))?
        .map_err(|e| AppError::DatabaseError(e))?;

    // Store assistant message and usage
    {
        let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;

        // Store assistant response
        let assistant_msg = db::insert_chat_message(&conn, workspace_id, "assistant", &response.content)?;

        // Record usage (use original alias for cost lookup since model info uses aliases)
        let cost = calculate_cost(model, &response.usage);
        let _ = db::insert_usage_record(
            &conn,
            workspace_id,
            None, // task_id
            Some(session_id),
            "anthropic",
            &response.model,
            response.usage.input_tokens,
            response.usage.output_tokens,
            cost,
        );

        // Update session to idle
        let _ = db::update_orchestrator_session(&conn, session_id, Some("idle"), None);

        // Emit complete event
        let _ = app.emit("orchestrator:complete", &OrchestratorEvent {
            workspace_id: workspace_id.to_string(),
            event_type: "complete".to_string(),
            message: Some(assistant_msg.id),
        });
    }

    Ok(())
}

async fn stream_via_cli(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: &str,
    session_id: &str,
    cli_path: &str,
    model: &str,
    history: Vec<ChatMessage>,
) -> Result<(), AppError> {
    // Build conversation context from history
    let last_message = history.last()
        .map(|m| m.content.clone())
        .unwrap_or_default();

    // Build resume context from previous messages (excluding the last user message)
    let context: String = history.iter()
        .rev()
        .skip(1) // Skip the last message (current user input)
        .take(10) // Take up to 10 previous messages for context
        .rev()
        .map(|m| format!("{}: {}", if m.role == "user" { "Human" } else { "Assistant" }, m.content))
        .collect::<Vec<_>>()
        .join("\n\n");

    // Build the prompt with context if available
    let prompt = if context.is_empty() {
        last_message
    } else {
        format!("Previous conversation:\n{}\n\nCurrent request: {}", context, last_message)
    };

    // Get home directory for CLI working dir
    let home_dir = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());

    // Spawn Claude CLI with streaming output
    // Note: --verbose is required when using --output-format stream-json with -p
    let mut child = Command::new(cli_path)
        .current_dir(&home_dir)
        .arg("-p")
        .arg(&prompt)
        .arg("--model")
        .arg(model)
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AppError::InvalidInput(format!("Failed to spawn CLI '{}': {}", cli_path, e)))?;

    let stdout = child.stdout.take()
        .ok_or_else(|| AppError::InvalidInput("Failed to capture CLI stdout".to_string()))?;
    
    let stderr = child.stderr.take()
        .ok_or_else(|| AppError::InvalidInput("Failed to capture CLI stderr".to_string()))?;

    let mut reader = BufReader::new(stdout).lines();
    let mut full_response = String::new();
    let workspace_id_clone = workspace_id.to_string();

    // Spawn a task to read stderr
    let stderr_handle = tokio::spawn(async move {
        let mut stderr_reader = BufReader::new(stderr).lines();
        let mut stderr_output = String::new();
        while let Ok(Some(line)) = stderr_reader.next_line().await {
            stderr_output.push_str(&line);
            stderr_output.push('\n');
        }
        stderr_output
    });

    // Read streaming output line by line
    while let Some(line) = reader.next_line().await
        .map_err(|e| AppError::InvalidInput(format!("Failed to read CLI output: {}", e)))?
    {
        // Try to parse as JSON streaming format
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
            // Handle different event types from Claude CLI stream-json format
            if let Some(event_type) = json.get("type").and_then(|t| t.as_str()) {
                match event_type {
                    "system" => {
                        // Init event - skip
                    }
                    "assistant" => {
                        // Assistant message - extract content from message.content[0].text
                        if let Some(text) = json.get("message")
                            .and_then(|m| m.get("content"))
                            .and_then(|c| c.as_array())
                            .and_then(|arr| arr.first())
                            .and_then(|item| item.get("text"))
                            .and_then(|t| t.as_str())
                        {
                            full_response = text.to_string();
                            let _ = app.emit("orchestrator:stream", &StreamChunkPayload {
                                workspace_id: workspace_id_clone.clone(),
                                delta: text.to_string(),
                                finish_reason: None,
                            });
                        }
                    }
                    "result" => {
                        // Final result message with summary
                        if let Some(result_text) = json.get("result").and_then(|r| r.as_str()) {
                            // Only use if we didn't get content from assistant event
                            if full_response.is_empty() {
                                full_response = result_text.to_string();
                                let _ = app.emit("orchestrator:stream", &StreamChunkPayload {
                                    workspace_id: workspace_id_clone.clone(),
                                    delta: result_text.to_string(),
                                    finish_reason: None,
                                });
                            }
                        }
                        // Send finish event
                        let _ = app.emit("orchestrator:stream", &StreamChunkPayload {
                            workspace_id: workspace_id_clone.clone(),
                            delta: String::new(),
                            finish_reason: Some("stop".to_string()),
                        });
                    }
                    "content_block_delta" => {
                        // Streaming delta events (if CLI is doing real streaming)
                        if let Some(delta) = json.get("delta")
                            .and_then(|d| d.get("text"))
                            .and_then(|t| t.as_str())
                        {
                            full_response.push_str(delta);
                            let _ = app.emit("orchestrator:stream", &StreamChunkPayload {
                                workspace_id: workspace_id_clone.clone(),
                                delta: delta.to_string(),
                                finish_reason: None,
                            });
                        }
                    }
                    _ => {}
                }
            }
        } else if !line.trim().is_empty() {
            // Plain text output (fallback for non-JSON mode)
            full_response.push_str(&line);
            full_response.push('\n');
            let _ = app.emit("orchestrator:stream", &StreamChunkPayload {
                workspace_id: workspace_id_clone.clone(),
                delta: format!("{}\n", line),
                finish_reason: None,
            });
        }
    }

    // Wait for stderr to be fully read
    let stderr_content = stderr_handle.await.unwrap_or_default();

    // Wait for process to complete
    let status = child.wait().await
        .map_err(|e| AppError::InvalidInput(format!("CLI process failed: {}", e)))?;

    if !status.success() {
        let error_msg = if stderr_content.is_empty() {
            format!("CLI exited with status: {}", status)
        } else {
            format!("CLI error: {}", stderr_content.trim())
        };
        let _ = app.emit("orchestrator:error", &OrchestratorEvent {
            workspace_id: workspace_id.to_string(),
            event_type: "error".to_string(),
            message: Some(error_msg.clone()),
        });
        return Err(AppError::InvalidInput(error_msg));
    }

    // Store assistant message
    {
        let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;

        // Store assistant response
        let assistant_msg = db::insert_chat_message(&conn, workspace_id, "assistant", &full_response)?;

        // Update session to idle
        let _ = db::update_orchestrator_session(&conn, session_id, Some("idle"), None);

        // Emit complete event
        let _ = app.emit("orchestrator:complete", &OrchestratorEvent {
            workspace_id: workspace_id.to_string(),
            event_type: "complete".to_string(),
            message: Some(assistant_msg.id.clone()),
        });
    }

    Ok(())
}
