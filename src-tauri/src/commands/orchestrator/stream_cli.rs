use crate::chat::{
    ChatEvent, ChefSession, SessionConfig, SharedSessionRegistry, ToolStatus, TransportType,
    UnifiedChatSession,
};
use crate::db::{self, AppState};
use crate::error::AppError;
use crate::llm::{execute_tools, parse_cli_action_blocks};
use tauri::{AppHandle, Emitter, State};

use super::{
    db_conn, session_registry_key,
    types::{
        OrchestratorEvent, StreamChunkPayload, ThinkingPayload, ToolCallPayload, ToolResultPayload,
    },
};

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

    let (full_response, captured_cli_session_id) = {
        let mut registry = session_registry.lock().await;

        // Tool-based board context (opt-in): the chef reads the board via the
        // kaitencode-mcp `get_board` tool instead of embedding it in the prompt.
        // Falls back to the embedded board if disabled or the binary isn't found.
        let (mcp_config_path, allowed_tools) = if crate::config::chef_tools_enabled() {
            match resolve_chef_mcp() {
                Some((path, tools)) => (Some(path), tools),
                None => {
                    log::warn!(
                        "KAITENCODE_CHEF_TOOLS is set but kaitencode-mcp was not found; \
                         falling back to the embedded board"
                    );
                    (None, Vec::new())
                }
            }
        } else {
            (None, Vec::new())
        };
        let tools_active = mcp_config_path.is_some();

        let config = SessionConfig {
            cli_path: cli_path.to_string(),
            model: model.to_string(),
            system_prompt: String::new(),
            working_dir: None,
            effort_level: None,
            mcp_config_path,
            allowed_tools,
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

        let system_prompt = if tools_active {
            // No embedded board — the model reads it via get_board.
            prompt_builder.build_system_prompt_tools(&workspace, &columns)
        } else {
            prompt_builder.build_system_prompt(&workspace, &columns, &tasks)
        };
        session.set_system_prompt(system_prompt);

        let full_message = if tools_active {
            // Board fetched on demand via the tool — send only the user's text.
            message.to_string()
        } else if session.resume_id().is_some() {
            // The board lives in the system prompt (rebuilt fresh each turn). Only on
            // a --resume turn does Claude reuse the original session's stale system
            // prompt, so only then prepend the board; otherwise it's pure duplication
            // that bloats the prompt toward the argv/E2BIG limit.
            prompt_builder.augment_message(message, &workspace, &columns, &tasks)
        } else {
            message.to_string()
        };

        let ws_id = workspace_id.to_string();
        let chat_session_id = session_id.to_string();
        let app_for_events = app.clone();

        let result = session
            .send_message(&full_message, move |event| {
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
                    session
                        .send_message(&full_message, move |event| {
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
                session
                    .send_message(&full_message, move |event| {
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
        | ChatEvent::TurnStarted
        | ChatEvent::CommandStarted { .. }
        | ChatEvent::CommandOutput { .. }
        | ChatEvent::CommandCompleted { .. }
        | ChatEvent::RawOutput(_)
        | ChatEvent::Result(_)
        | ChatEvent::Unknown => {}
    }
}

/// Read-only MCP tools the chef may call (board reads only — writes still go
/// through the action-block protocol).
const CHEF_READ_TOOLS: &[&str] = &[
    "get_workspaces",
    "get_board",
    "get_task",
    "list_scripts",
    "list_pipeline_templates",
    "get_pipeline_template",
];

/// Resolve the chef's read-only MCP setup: locate the `kaitencode-mcp` binary,
/// write an isolated `--mcp-config` JSON to the data dir, and return its path plus
/// the allow-listed tool names. `None` if the binary can't be found (caller falls
/// back to the embedded board).
fn resolve_chef_mcp() -> Option<(String, Vec<String>)> {
    let mcp_bin = locate_kaitencode_mcp()?;
    let cfg = serde_json::json!({
        "mcpServers": { "kaitencode": { "command": mcp_bin } }
    });
    let path = crate::db::data_dir().join("chef-mcp.json");
    std::fs::write(&path, serde_json::to_string_pretty(&cfg).ok()?).ok()?;
    let allowed = CHEF_READ_TOOLS
        .iter()
        .map(|t| format!("mcp__kaitencode__{t}"))
        .collect();
    Some((path.to_string_lossy().into_owned(), allowed))
}

/// Locate the `kaitencode-mcp` binary: PATH first, then a sibling of the running
/// executable (dev: `target/release/kaitencode-mcp`).
fn locate_kaitencode_mcp() -> Option<String> {
    if let Some(p) = crate::commands::cli_detect::find_cli("kaitencode-mcp") {
        return Some(p);
    }
    let exe = std::env::current_exe().ok()?;
    let sibling = exe.parent()?.join("kaitencode-mcp");
    sibling
        .exists()
        .then(|| sibling.to_string_lossy().into_owned())
}
