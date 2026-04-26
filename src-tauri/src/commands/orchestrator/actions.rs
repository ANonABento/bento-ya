use crate::db::{self, AppState, OrchestratorSession};
use crate::error::AppError;
use crate::llm::{execute_tools, parse_cli_action_blocks, ToolUse};
use tauri::{AppHandle, Emitter, State};

use super::{
    db_conn,
    types::{OrchestratorAction, OrchestratorEvent, OrchestratorResponse},
};

pub(super) fn process_orchestrator_response(
    app: AppHandle,
    state: State<AppState>,
    workspace_id: String,
    response_text: String,
    actions: Vec<OrchestratorAction>,
) -> Result<OrchestratorResponse, AppError> {
    let conn = db_conn(&state)?;

    let chat_session = db::get_or_create_active_session(&conn, &workspace_id)?;

    let _ = db::insert_chat_message(
        &conn,
        &workspace_id,
        &chat_session.id,
        "assistant",
        &response_text,
    )?;

    let mut tasks_created = Vec::new();
    let mut execution_summary = "No changes made".to_string();

    let mut tool_uses = actions_to_tool_uses(&actions);
    tool_uses.extend(parse_cli_action_blocks(&response_text));

    if !tool_uses.is_empty() {
        let columns = db::list_columns(&conn, &workspace_id)?;
        let execution = execute_tools(&conn, &app, &workspace_id, &tool_uses, &columns)?;
        tasks_created = execution.tasks_created;
        execution_summary = execution.summary;
    }

    let session = db::get_or_create_orchestrator_session(&conn, &workspace_id)?;
    let _ = db::update_orchestrator_session(&conn, &session.id, Some("idle"), None);

    let _ = app.emit(
        "orchestrator:complete",
        &OrchestratorEvent {
            workspace_id: workspace_id.clone(),
            event_type: "complete".to_string(),
            message: Some(execution_summary),
        },
    );

    Ok(OrchestratorResponse {
        message: response_text,
        actions: actions.clone(),
        tasks_created,
    })
}

fn actions_to_tool_uses(actions: &[OrchestratorAction]) -> Vec<ToolUse> {
    actions
        .iter()
        .enumerate()
        .filter_map(|(index, action)| {
            let name = normalize_action_type(&action.action_type)?;
            let mut input = serde_json::Map::new();

            if let Some(title) = &action.title {
                input.insert(
                    "title".to_string(),
                    serde_json::Value::String(title.clone()),
                );
            }
            if let Some(description) = &action.description {
                input.insert(
                    "description".to_string(),
                    serde_json::Value::String(description.clone()),
                );
            }
            if let Some(column_id) = &action.column_id {
                input.insert(
                    "column_id".to_string(),
                    serde_json::Value::String(column_id.clone()),
                );
            }
            if let Some(task_id) = &action.task_id {
                input.insert(
                    "task_id".to_string(),
                    serde_json::Value::String(task_id.clone()),
                );
            }

            Some(ToolUse {
                id: format!("orchestrator_action_{}", index),
                name: name.to_string(),
                input: serde_json::Value::Object(input),
            })
        })
        .collect()
}

fn normalize_action_type(action_type: &str) -> Option<&'static str> {
    match action_type {
        "create_task" => Some("create_task"),
        "update_task" | "edit_task" => Some("update_task"),
        "move_task" => Some("move_task"),
        "delete_task" | "remove_task" => Some("delete_task"),
        _ => None,
    }
}

pub(super) fn set_orchestrator_error(
    app: AppHandle,
    state: State<AppState>,
    workspace_id: String,
    error_message: String,
) -> Result<OrchestratorSession, AppError> {
    let conn = db_conn(&state)?;

    let session = db::get_or_create_orchestrator_session(&conn, &workspace_id)?;
    let updated = db::update_orchestrator_session(
        &conn,
        &session.id,
        Some("error"),
        Some(Some(&error_message)),
    )?;

    let _ = app.emit(
        "orchestrator:error",
        &OrchestratorEvent {
            workspace_id,
            event_type: "error".to_string(),
            message: Some(error_message),
        },
    );

    Ok(updated)
}
