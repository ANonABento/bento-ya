use crate::chat::SharedSessionRegistry;
use crate::db::{self, AppState};
use crate::error::AppError;
use tauri::{AppHandle, Emitter, State};

use super::db_conn;
use super::session_registry_key;
use super::stream_api::stream_via_api;
use super::stream_cli::stream_via_unified_cli;
use super::types::{api_stream_key, ApiStreamRegistry, OrchestratorEvent};
use super::{DEFAULT_API_KEY_ENV_VAR, DEFAULT_CLI_PATH, DEFAULT_MODEL};

#[allow(clippy::too_many_arguments)]
pub(super) async fn stream_orchestrator_chat(
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
    let model = model.unwrap_or_else(|| DEFAULT_MODEL.to_string());

    let (history, orch_session_id, actual_session_id, cli_session_id) = {
        let conn = db_conn(&state)?;

        let chat_session = match db::get_chat_session(&conn, &session_id) {
            Ok(s) => s,
            Err(_) => db::get_or_create_active_session(&conn, &workspace_id)?,
        };
        let actual_session_id = chat_session.id.clone();
        let cli_session_id = chat_session.cli_session_id.clone();

        db::insert_chat_message(&conn, &workspace_id, &actual_session_id, "user", &message)?;

        let history = db::list_chat_messages(&conn, &actual_session_id, Some(20))?;

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

        let orch_session = db::get_or_create_orchestrator_session(&conn, &workspace_id)?;
        let _ = db::update_orchestrator_session(&conn, &orch_session.id, Some("processing"), None);

        (history, orch_session.id, actual_session_id, cli_session_id)
    };

    let _ = app.emit(
        "orchestrator:processing",
        &OrchestratorEvent {
            workspace_id: workspace_id.clone(),
            session_id: Some(actual_session_id.clone()),
            event_type: "processing".to_string(),
            message: Some(message.clone()),
        },
    );

    let result = match connection_mode.as_str() {
        "api" => {
            let env_var_name = api_key_env_var
                .as_deref()
                .unwrap_or(DEFAULT_API_KEY_ENV_VAR);
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
            let cli = cli_path
                .clone()
                .unwrap_or_else(|| DEFAULT_CLI_PATH.to_string());
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
                session_id: Some(actual_session_id),
                event_type: "error".to_string(),
                message: Some(error_message),
            },
        );
    }

    result
}

pub(super) async fn cancel_orchestrator_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    api_stream_registry: State<'_, ApiStreamRegistry>,
    session_id: String,
    workspace_id: String,
) -> Result<(), AppError> {
    {
        let registry_key = session_registry_key(&workspace_id, &session_id);
        let mut registry = session_registry.lock().await;
        if let Some(session) = registry.get_mut(&registry_key) {
            let _ = session.kill();
        }
    }

    let _ = api_stream_registry
        .abort(&api_stream_key(&workspace_id, &session_id))
        .await;

    {
        let conn = db_conn(&state)?;
        let session = db::get_or_create_orchestrator_session(&conn, &workspace_id)?;
        let _ = db::update_orchestrator_session(&conn, &session.id, Some("idle"), None);
    }

    let _ = app.emit(
        "orchestrator:complete",
        &OrchestratorEvent {
            workspace_id: workspace_id.clone(),
            session_id: Some(session_id),
            event_type: "cancelled".to_string(),
            message: Some("Request cancelled".to_string()),
        },
    );

    Ok(())
}
