use crate::chat::{
    events::TokenUsage as ChatTokenUsage, ChatEvent, ChefSession, SessionConfig,
    SharedSessionRegistry, ToolStatus, TransportType, UnifiedChatSession,
};
use crate::db::{self, AppState};
use crate::error::AppError;
use crate::llm::{
    calculate_cost, execute_tools, infer_provider_id, parse_cli_action_blocks, types::TokenUsage,
};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

use super::{
    db_conn, session_registry_key,
    types::{
        OrchestratorEvent, StreamChunkPayload, ThinkingPayload, ToolCallPayload, ToolResultPayload,
    },
};

type SharedTokenUsage = Arc<Mutex<Option<ChatTokenUsage>>>;

fn remember_result_usage(final_usage: &SharedTokenUsage, event: &ChatEvent) {
    if let ChatEvent::Result(usage) = event {
        if let Ok(mut lock) = final_usage.lock() {
            *lock = Some(usage.clone());
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn stream_via_unified_cli(
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
    let registry_key = session_registry_key(workspace_id, session_id);
    let final_usage = Arc::new(Mutex::new(None::<ChatTokenUsage>));
    let usage_provider = infer_provider_id(cli_path, model);

    let (full_response, captured_cli_session_id) = {
        let mut registry = session_registry.lock().await;

        let config = SessionConfig {
            cli_path: cli_path.to_string(),
            model: model.to_string(),
            system_prompt: String::new(),
            working_dir: None,
            effort_level: None,
        };
        let prompt_builder = ChefSession::new_cli(workspace_id.to_string(), config.clone());

        if !registry.has(&registry_key) {
            let mut session = UnifiedChatSession::new(config, TransportType::Pipe);
            if let Some(rid) = resume_id {
                session.set_resume_id(Some(rid.to_string()));
            }
            registry.insert(&registry_key, session);
        }

        let session = registry.get_mut(&registry_key).ok_or_else(|| {
            AppError::CommandError(format!(
                "Failed to initialize orchestrator CLI session for {registry_key}"
            ))
        })?;

        let model_changed = session.model() != model;
        session.set_model(model.to_string());

        if !model_changed && session.resume_id().is_none() {
            if let Some(rid) = resume_id {
                session.set_resume_id(Some(rid.to_string()));
            }
        }

        let (workspace, columns, tasks) = {
            let conn = db_conn(&state)?;
            let workspace = db::get_workspace(&conn, workspace_id)?;
            let columns = db::list_columns(&conn, workspace_id)?;
            let tasks = db::list_tasks(&conn, workspace_id)?;
            (workspace, columns, tasks)
        };

        let system_prompt = prompt_builder.build_system_prompt(&workspace, &columns, &tasks);
        session.set_system_prompt(system_prompt);
        let full_message = prompt_builder.augment_message(message, &workspace, &columns, &tasks);

        let ws_id = workspace_id.to_string();
        let chat_session_id = session_id.to_string();
        let app_for_events = app.clone();

        let final_usage_for_events = final_usage.clone();
        let result = session
            .send_message(&full_message, move |event| {
                remember_result_usage(&final_usage_for_events, &event);
                emit_orchestrator_cli_event(&app_for_events, &ws_id, &chat_session_id, event);
            })
            .await;

        match result {
            Ok((response, sid)) => {
                if response.is_empty() {
                    log::warn!(
                        "Empty CLI response — likely stale --resume, retrying without resume"
                    );
                    session.set_resume_id(None);

                    {
                        let conn = db_conn(&state)?;
                        let _ = db::update_chat_session_cli_id(&conn, session_id, None);
                    }

                    let ws_id2 = workspace_id.to_string();
                    let chat_session_id2 = session_id.to_string();
                    let app_retry = app.clone();
                    let final_usage_retry = final_usage.clone();
                    session
                        .send_message(&full_message, move |event| {
                            remember_result_usage(&final_usage_retry, &event);
                            emit_orchestrator_cli_event(
                                &app_retry,
                                &ws_id2,
                                &chat_session_id2,
                                event,
                            );
                        })
                        .await
                        .map_err(AppError::InvalidInput)?
                } else {
                    (response, sid)
                }
            }
            Err(e) => {
                log::warn!("CLI send failed: {}, retrying without resume", e);
                session.set_resume_id(None);

                let ws_id2 = workspace_id.to_string();
                let chat_session_id2 = session_id.to_string();
                let app_retry = app.clone();
                let final_usage_retry = final_usage.clone();
                session
                    .send_message(&full_message, move |event| {
                        remember_result_usage(&final_usage_retry, &event);
                        emit_orchestrator_cli_event(&app_retry, &ws_id2, &chat_session_id2, event);
                    })
                    .await
                    .map_err(AppError::InvalidInput)?
            }
        }
    };

    if let Some(cli_sid) = &captured_cli_session_id {
        let conn = db_conn(&state)?;
        let _ = db::update_chat_session_cli_id(&conn, session_id, Some(cli_sid));
    }

    if let Some(usage) = final_usage.lock().ok().and_then(|usage| usage.clone()) {
        let resolved_model = usage.model.unwrap_or_else(|| model.to_string());
        let cost = calculate_cost(
            &resolved_model,
            &TokenUsage {
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
            },
        );

        let conn = db_conn(&state)?;
        let record = db::insert_usage_record(
            &conn,
            workspace_id,
            None,
            Some(orch_session_id),
            usage_provider,
            &resolved_model,
            usage.input_tokens,
            usage.output_tokens,
            cost,
            None,
            0,
        )?;
        let _ = app.emit("usage:recorded", &record);
    }

    {
        let conn = db_conn(&state)?;
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
                            session_id: Some(session_id.to_string()),
                            event_type: "warning".to_string(),
                            message: Some(format!("Action execution failed: {}", e)),
                        },
                    );
                }
            }
        }
    }

    {
        let conn = db_conn(&state)?;
        let assistant_msg =
            db::insert_chat_message(&conn, workspace_id, session_id, "assistant", &full_response)?;
        let _ = db::update_orchestrator_session(&conn, orch_session_id, Some("idle"), None);

        let _ = app.emit(
            "orchestrator:complete",
            &OrchestratorEvent {
                workspace_id: workspace_id.to_string(),
                session_id: Some(session_id.to_string()),
                event_type: "complete".to_string(),
                message: Some(assistant_msg.id.clone()),
            },
        );
    }

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
        | ChatEvent::Result(_)
        | ChatEvent::Unknown => {}
    }
}
