use std::collections::HashMap;

use crate::chat::{ChefSession, SessionConfig};
use crate::db::{self, AppState, ChatMessage};
use crate::error::AppError;
use crate::llm::types::{LlmRequest, Message};
use crate::llm::{
    calculate_cost, execute_tools, orchestrator_tools, resolve_model_id, tools_to_api_format,
    AnthropicClient,
};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;

use super::{
    db_conn,
    types::{
        api_stream_key, ApiStreamRegistry, OrchestratorEvent, StreamChunkPayload, ToolCallPayload,
        ToolResultPayload, ToolUsePayload,
    },
};

#[allow(clippy::too_many_arguments)]
pub(super) async fn stream_via_api(
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

    let (workspace, columns, tasks) = {
        let conn = db_conn(&state)?;
        let workspace = db::get_workspace(&conn, workspace_id)?;
        let columns = db::list_columns(&conn, workspace_id)?;
        let tasks = db::list_tasks(&conn, workspace_id)?;
        (workspace, columns, tasks)
    };

    let system_prompt = chef.build_system_prompt(&workspace, &columns, &tasks);

    let mut messages: Vec<Message> = Vec::new();
    let history_len = history.len();

    for (i, m) in history.iter().enumerate() {
        if m.role == "system" {
            continue;
        }

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

    let (tx, mut rx) = mpsc::channel(100);

    let client = AnthropicClient::new(api_key.to_string());
    let app_clone = app.clone();
    let workspace_id_clone = workspace_id.to_string();
    let mut pending_tool_calls: HashMap<String, (String, serde_json::Value)> = HashMap::new();

    let stream_handle = tokio::spawn(async move { client.stream_chat(request, tx).await });
    let stream_registry_key = api_stream_key(workspace_id, session_id);
    api_stream_registry
        .insert(stream_registry_key.clone(), stream_handle.abort_handle())
        .await;

    while let Some(chunk) = rx.recv().await {
        let tool_use_payload = chunk.tool_use.as_ref().map(|tu| {
            pending_tool_calls.insert(tu.id.clone(), (tu.name.clone(), tu.input.clone()));

            let _ = app_clone.emit(
                "orchestrator:tool_call",
                &ToolCallPayload {
                    workspace_id: workspace_id_clone.clone(),
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
                delta: chunk.delta,
                finish_reason: chunk.finish_reason.clone(),
                tool_use: tool_use_payload,
            },
        );
    }

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
            let conn = db_conn(&state)?;
            execute_tools(&conn, &app, workspace_id, &tool_uses, &columns)?
        };

        for result in &execution_result.results {
            let (tool_name, tool_input) = pending_tool_calls
                .get(&result.tool_use_id)
                .cloned()
                .unwrap_or_else(|| ("unknown".to_string(), serde_json::Value::Null));

            let _ = app.emit(
                "orchestrator:tool_result",
                &ToolResultPayload {
                    workspace_id: workspace_id.to_string(),
                    tool_use_id: result.tool_use_id.clone(),
                    result: result.content.clone(),
                    is_error: result.is_error,
                },
            );

            let _ = app.emit(
                "orchestrator:tool_call",
                &ToolCallPayload {
                    workspace_id: workspace_id.to_string(),
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

    let assistant_content = if tool_results_summary.is_empty() {
        response.content.clone()
    } else if response.content.is_empty() {
        tool_results_summary
    } else {
        format!("{}\n\n{}", response.content, tool_results_summary)
    };

    {
        let conn = db_conn(&state)?;

        let assistant_msg = db::insert_chat_message(
            &conn,
            workspace_id,
            session_id,
            "assistant",
            &assistant_content,
        )?;

        let cost = calculate_cost(model, &response.usage);
        let _ = db::insert_usage_record(
            &conn,
            workspace_id,
            None,
            Some(orch_session_id),
            "anthropic",
            &response.model,
            response.usage.input_tokens,
            response.usage.output_tokens,
            cost,
            None,
            0,
        );

        let _ = db::update_orchestrator_session(&conn, orch_session_id, Some("idle"), None);

        let _ = app.emit(
            "orchestrator:complete",
            &OrchestratorEvent {
                workspace_id: workspace_id.to_string(),
                event_type: "complete".to_string(),
                message: Some(assistant_msg.id),
            },
        );
    }

    Ok(())
}
