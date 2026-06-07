use serde::Serialize;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

use crate::chat::registry::SharedSessionRegistry;
use crate::chat::runtime::{
    decide_input_delivery, drain_pending_runtime_inputs_for_turn, run_managed_runtime_turn,
    AgentAdapterKind, AgentInputSource, AgentRuntimeError, AgentRuntimeEvent, ClaudeCliAdapter,
    CodexCliAdapter, ManagedRuntimeStreamParser, ManagedRuntimeTurnConfig,
    ManagedRuntimeTurnResult, ProviderRuntimeLine,
};
use crate::chat::session::{SessionConfig, SessionState, TransportType};
use crate::chat::tmux_transport::{capture_scrollback, default_user_shell};
use crate::db::{self, AgentMessage, AppState};
use crate::error::AppError;

// ─── Types ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub task_id: String,
    pub agent_type: String,
    pub status: String,
    pub pid: Option<u32>,
    pub working_dir: String,
    /// Base64-encoded scrollback from previous session (for terminal restore)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scrollback: Option<String>,
}

/// Agent completion payload for frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCompletePayload {
    pub task_id: String,
    pub success: bool,
    pub message: Option<String>,
}

struct TaskInputLine {
    line: String,
    completion: Option<TaskInputCompletion>,
}

struct TaskInputCompletion {
    wait_channel: String,
    exit_path: String,
    semantic_log_path: Option<String>,
    adapter_kind: AgentAdapterKind,
}

const TASK_INPUT_COMPLETION_TIMEOUT: Duration = Duration::from_secs(60 * 60 * 2);

pub(crate) fn validate_agent_cli_path(cli_path: &str) -> Result<String, AppError> {
    let cli = cli_path.trim();
    if cli.is_empty() {
        return Err(AppError::InvalidInput(
            "Agent CLI path cannot be empty".to_string(),
        ));
    }

    if !cli.contains('/') && !cli.contains('\\') {
        return match cli {
            "claude" | "codex" => Ok(cli.to_string()),
            other => Err(AppError::InvalidInput(format!(
                "Unsupported agent CLI binary: {}",
                other
            ))),
        };
    }

    let path = Path::new(cli);
    if !path.exists() || !path.is_file() {
        return Err(AppError::InvalidInput(format!(
            "Agent CLI path is not an executable file: {}",
            cli
        )));
    }

    #[cfg(unix)]
    {
        let executable = path
            .metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false);
        if !executable {
            return Err(AppError::InvalidInput(format!(
                "Agent CLI path is not executable: {}",
                cli
            )));
        }
    }

    let binary_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if !matches!(binary_name, "claude" | "codex") {
        return Err(AppError::InvalidInput(format!(
            "Unsupported agent CLI executable: {}",
            binary_name
        )));
    }

    path.canonicalize()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|e| AppError::InvalidInput(format!("Invalid agent CLI path: {}", e)))
}

fn canonical_existing_dir(path: &str) -> Result<PathBuf, AppError> {
    let path_ref = Path::new(path.trim());
    if path.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Working directory cannot be empty".to_string(),
        ));
    }
    let canonical = path_ref.canonicalize().map_err(|e| {
        AppError::InvalidInput(format!(
            "Working directory does not exist: {} ({})",
            path, e
        ))
    })?;
    if !canonical.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Working directory is not a directory: {}",
            path
        )));
    }
    Ok(canonical)
}

/// **Validate** a caller-supplied working directory against the task's allowed
/// roots: it must canonicalize to either the workspace repo root or the task's
/// worktree, else this errors. This is a guard on untrusted input, distinct
/// from the spawn-time *resolver*
/// [`crate::pipeline::triggers::resolve_working_dir`], which simply *picks*
/// worktree-or-repo with no validation. Don't collapse the two — this one's job
/// is to reject anything outside the sandbox.
fn validate_requested_working_dir(
    task: &db::Task,
    workspace: &db::Workspace,
    requested_working_dir: &str,
) -> Result<String, AppError> {
    let requested = canonical_existing_dir(requested_working_dir)?;
    let workspace_root = canonical_existing_dir(&workspace.repo_path)?;
    if requested == workspace_root {
        return Ok(requested.to_string_lossy().to_string());
    }

    if let Some(worktree_path) = task.worktree_path.as_deref() {
        let worktree_root = canonical_existing_dir(worktree_path)?;
        if requested == worktree_root {
            return Ok(requested.to_string_lossy().to_string());
        }
    }

    Err(AppError::InvalidInput(format!(
        "Working directory must match the task's workspace or worktree: {}",
        requested_working_dir
    )))
}

fn validate_task_launch_inputs(
    state: &State<'_, AppState>,
    task_id: &str,
    working_dir: &str,
    cli_path: Option<&str>,
) -> Result<(String, String), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let task = db::get_task(&conn, task_id)?;
    let workspace = db::get_workspace(&conn, &task.workspace_id)?;
    let working_dir = validate_requested_working_dir(&task, &workspace, working_dir)?;
    let cli = validate_agent_cli_path(cli_path.unwrap_or("claude"))?;
    Ok((working_dir, cli))
}

fn validate_task_exists(state: &State<'_, AppState>, task_id: &str) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let _ = db::get_task(&conn, task_id)?;
    Ok(())
}

// ─── PTY Agent Commands (via SessionRegistry) ──────────────────────────────

#[tauri::command(rename_all = "camelCase")]
#[allow(clippy::too_many_arguments)]
pub async fn start_agent(
    state: State<'_, AppState>,
    task_id: String,
    _agent_type: String,
    working_dir: String,
    _env_vars: Option<std::collections::HashMap<String, String>>,
    cli_path: Option<String>,
    app_handle: AppHandle,
    session_registry: State<'_, SharedSessionRegistry>,
) -> Result<AgentInfo, String> {
    let (working_dir, cli) =
        validate_task_launch_inputs(&state, &task_id, &working_dir, cli_path.as_deref())
            .map_err(|e| e.to_string())?;

    let mut registry = session_registry.lock().await;

    // Clean up any existing session (handles React strict mode double-mount
    // and stale sessions from previous app instances)
    registry.remove(&task_id);

    let config = SessionConfig {
        cli_path: cli.clone(),
        model: "sonnet".to_string(),
        system_prompt: String::new(),
        working_dir: Some(working_dir.clone()),
        effort_level: None,
    };

    let session = registry
        .get_or_create(&task_id, config, TransportType::Pty)
        .map_err(|e| e.to_string())?;

    let _mpsc_rx = session.start_pty(120, 40)?;
    let pid = session.pid();

    // Start managed bridge via broadcast
    if let Some(rx) = session.resubscribe() {
        let bridge = crate::chat::bridge::ManagedBridge::start(app_handle, task_id.clone(), rx);
        registry.set_bridge(&task_id, bridge);
    }

    Ok(AgentInfo {
        task_id,
        agent_type: "claude".to_string(),
        status: "Running".to_string(),
        pid,
        working_dir,
        scrollback: None,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn stop_agent(
    task_id: String,
    session_registry: State<'_, SharedSessionRegistry>,
) -> Result<(), String> {
    let mut registry = session_registry.lock().await;
    if let Some(session) = registry.get_mut(&task_id) {
        // Send Ctrl+C via PTY write
        session.write_pty(&[0x03]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn force_stop_agent(
    task_id: String,
    session_registry: State<'_, SharedSessionRegistry>,
) -> Result<(), String> {
    let mut registry = session_registry.lock().await;
    if let Some(session) = registry.get_mut(&task_id) {
        session.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_agent_status(
    task_id: String,
    session_registry: State<'_, SharedSessionRegistry>,
) -> Result<AgentInfo, String> {
    let registry = session_registry.lock().await;
    let session = registry
        .get(&task_id)
        .ok_or_else(|| format!("No agent session for task: {}", task_id))?;

    let status = match session.state() {
        SessionState::Running => "Running",
        SessionState::Idle => "Idle",
        SessionState::Suspended => "Suspended",
    };

    Ok(AgentInfo {
        task_id: task_id.clone(),
        agent_type: "claude".to_string(),
        status: status.to_string(),
        pid: session.pid(),
        working_dir: String::new(),
        scrollback: None,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn list_active_agents(
    session_registry: State<'_, SharedSessionRegistry>,
) -> Result<Vec<AgentInfo>, String> {
    let registry = session_registry.lock().await;
    Ok(registry
        .list()
        .into_iter()
        .filter(|(_, state)| *state == SessionState::Running)
        .map(|(key, _)| AgentInfo {
            task_id: key,
            agent_type: "claude".to_string(),
            status: "Running".to_string(),
            pid: None,
            working_dir: String::new(),
            scrollback: None,
        })
        .collect())
}

// ─── Agent Message Commands ────────────────────────────────────────────────

#[tauri::command(rename_all = "camelCase")]
#[allow(clippy::too_many_arguments)]
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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_agent_messages(&conn, &task_id)?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_agent_transcript_events(
    state: State<AppState>,
    task_id: String,
) -> Result<Vec<db::AgentTranscriptEvent>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_agent_transcript_events(&conn, &task_id)?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn clear_agent_messages(state: State<AppState>, task_id: String) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::clear_agent_messages(&conn, &task_id)?;
    Ok(())
}

// ─── Agent CLI Chat (via UnifiedChatSession) ──────────────────────────────

/// Send a user message into the per-task PTY/tmux session.
///
/// Persistent task chat is a terminal input lane: the panel output is already
/// streamed by `ensure_pty_session`, so task chat must not create a separate
/// request/response Pipe process.
#[tauri::command(rename_all = "camelCase")]
#[allow(clippy::too_many_arguments)]
pub async fn send_task_input(
    app: AppHandle,
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    task_id: String,
    text: String,
    source: String,
    working_dir: String,
    cli_path: String,
    model: Option<String>,
    effort_level: Option<String>,
) -> Result<(), AppError> {
    let (working_dir, cli_path) =
        validate_task_launch_inputs(&state, &task_id, &working_dir, Some(&cli_path))?;
    let requested_model = model;
    let requested_effort_level = effort_level;
    let is_user_input = matches!(source.as_str(), "chat" | "voice" | "command");

    let (
        resume_id,
        should_launch_prompt_command,
        input_delivery,
        should_queue_runtime_input,
        session_id,
        runtime_mode,
        adapter_kind,
        column_name,
        pipeline_state,
        model,
        effort_level,
    ) = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let previous_task = db::get_task(&conn, &task_id)?;
        let column_name = db::get_column(&conn, &previous_task.column_id)
            .ok()
            .map(|column| column.name);

        let agent_type = agent_type_from_cli_path(&cli_path);
        let agent_session = db::get_or_create_agent_session_for_task(
            &conn,
            &task_id,
            agent_type,
            Some(&working_dir),
        )?;
        let model = requested_model
            .clone()
            .or_else(|| agent_session.model.clone())
            .or_else(|| previous_task.model.clone())
            .unwrap_or_else(|| "sonnet".to_string());
        let effort_level = requested_effort_level
            .clone()
            .or_else(|| agent_session.effort_level.clone());

        db::insert_agent_message(
            &conn,
            &task_id,
            "user",
            &text,
            Some(&model),
            effort_level.as_deref(),
            None,
            None,
        )?;

        if is_user_input {
            let task = db::stamp_task_user_input(&conn, &task_id)?;
            crate::pipeline::emit_tasks_changed(&app, &task.workspace_id, "task_user_input");
        }

        let tmux_name = tmux_session_name_for_task(&task_id);
        let runtime_mode = chat_turn_runtime_mode(
            previous_task
                .agent_mode
                .as_deref()
                .or(Some(agent_session.runtime_mode.as_str())),
        )
        .to_string();
        let adapter_kind = db::adapter_kind_for_agent_type(agent_type).to_string();
        let _ = db::update_agent_session_runtime(
            &conn,
            &agent_session.id,
            Some(&adapter_kind),
            Some(&runtime_mode),
            None,
            Some(Some(&tmux_name)),
        )?;
        let _ = db::update_agent_session_model(
            &conn,
            &agent_session.id,
            Some(&model),
            effort_level.as_deref(),
        )?;
        let should_launch_prompt_command = matches!(source.as_str(), "chat" | "voice")
            && previous_task.agent_status.as_deref() != Some("running");
        let resume_id = agent_session
            .provider_session_id
            .clone()
            .or_else(|| agent_session.cli_session_id.clone());
        let input_delivery = decide_input_delivery(
            previous_task.agent_status.as_deref() == Some("running"),
            resume_id.is_some(),
            runtime_mode == "terminal",
        );
        let should_queue_runtime_input = input_delivery == crate::chat::AgentInputDelivery::Queued;

        if let Ok(event) = crate::chat::persist_runtime_event(
            &conn,
            &task_id,
            Some(&agent_session.id),
            AgentRuntimeEvent::UserInput {
                source: agent_input_source(&source),
                delivery: input_delivery,
                content: text.clone(),
            },
        ) {
            crate::events::emit_agent_transcript_event(
                &app,
                crate::events::AgentTranscriptEventPayload {
                    id: event.id,
                    task_id: event.task_id,
                    session_id: event.session_id,
                    event_type: event.event_type,
                    content: event.content,
                    metadata_json: event.metadata_json,
                    sequence: event.sequence,
                    created_at: event.created_at,
                },
            );
        }
        if should_queue_runtime_input {
            let source_key = agent_input_source_key(agent_input_source(&source));
            db::enqueue_agent_runtime_input(
                &conn,
                &task_id,
                Some(&agent_session.id),
                source_key,
                &text,
                Some(&model),
                effort_level.as_deref(),
                "queued",
            )?;
        }
        let _ = db::update_task_agent_status(&conn, &task_id, Some("running"), None)?;
        (
            resume_id,
            should_launch_prompt_command,
            input_delivery,
            should_queue_runtime_input,
            agent_session.id,
            runtime_mode,
            adapter_kind,
            column_name,
            previous_task.pipeline_state,
            model,
            effort_level,
        )
    };

    if should_queue_runtime_input {
        return Ok(());
    }

    if runtime_mode == "managed" && should_launch_prompt_command {
        let resume_available = resume_id.is_some();
        let metadata = serde_json::json!({
            "cli": cli_path,
            "model": model,
            "workdir": working_dir,
            "effortLevel": effort_level,
            "resumeAvailable": resume_available,
            "inputDelivery": input_delivery,
            "columnName": column_name,
            "pipelineState": pipeline_state,
            "runtimeMode": runtime_mode,
        })
        .to_string();
        let _ = crate::events::persist_and_emit_agent_transcript_event(
            &app,
            &task_id,
            Some(&session_id),
            db::EVENT_SESSION_STARTED,
            None,
            Some(&metadata),
        );
        let _ = crate::events::persist_and_emit_agent_transcript_event(
            &app,
            &task_id,
            Some(&session_id),
            db::EVENT_AGENT_STARTED,
            None,
            Some(&metadata),
        );

        spawn_managed_task_turn(
            app.clone(),
            task_id.clone(),
            session_id,
            adapter_kind,
            cli_path,
            model,
            effort_level,
            working_dir,
            text,
            resume_id,
        );
        return Ok(());
    }

    let pre_command_scrollback = if should_launch_prompt_command {
        Some(crate::chat::tmux_transport::capture_scrollback_text(
            &task_id,
        ))
    } else {
        None
    };

    let input_line = build_task_input_line(
        &cli_path,
        &model,
        &text,
        resume_id.as_deref(),
        should_launch_prompt_command,
    )
    .map_err(AppError::InvalidInput)?;
    let resume_available = resume_id.is_some();

    {
        let mut registry = session_registry.lock().await;

        if registry
            .get(&task_id)
            .map(|s| s.is_alive())
            .unwrap_or(false)
        {
            crate::chat::tmux_transport::send_text_line(&task_id, &input_line.line)
                .map_err(AppError::InvalidInput)?;
        } else {
            registry.remove(&task_id);

            let config = SessionConfig {
                cli_path: cli_path.clone(),
                model: model.clone(),
                system_prompt: String::new(),
                working_dir: Some(working_dir.clone()),
                effort_level: effort_level.clone(),
            };

            let session = registry
                .get_or_create(&task_id, config, TransportType::Pty)
                .map_err(AppError::InvalidInput)?;

            session.set_model(model.clone());
            if let Some(resume_id) = resume_id.clone() {
                session.set_resume_id(Some(resume_id));
            }

            let _mpsc_rx = session.start_pty(120, 40).map_err(AppError::InvalidInput)?;
            let rx = session.resubscribe();
            crate::chat::tmux_transport::send_text_line(&task_id, &input_line.line)
                .map_err(AppError::InvalidInput)?;

            if let Some(rx) = rx {
                let bridge =
                    crate::chat::bridge::ManagedBridge::start(app.clone(), task_id.clone(), rx);
                registry.set_bridge(&task_id, bridge);
            }
        }
    }
    if should_launch_prompt_command {
        let metadata = serde_json::json!({
            "cli": cli_path,
            "model": model,
            "workdir": working_dir,
            "effortLevel": effort_level,
            "resumeAvailable": resume_available,
            "inputDelivery": input_delivery,
            "columnName": column_name,
            "pipelineState": pipeline_state,
        })
        .to_string();
        let _ = crate::events::persist_and_emit_agent_transcript_event(
            &app,
            &task_id,
            Some(&session_id),
            db::EVENT_SESSION_STARTED,
            None,
            Some(&metadata),
        );
        let _ = crate::events::persist_and_emit_agent_transcript_event(
            &app,
            &task_id,
            Some(&session_id),
            db::EVENT_AGENT_STARTED,
            None,
            Some(&metadata),
        );
        let _ = crate::events::persist_and_emit_agent_transcript_event(
            &app,
            &task_id,
            Some(&session_id),
            db::EVENT_COMMAND_STARTED,
            None,
            Some(&metadata),
        );
    }
    if let Some(completion) = input_line.completion {
        spawn_task_input_completion_watcher(
            app.clone(),
            task_id.clone(),
            session_id,
            completion,
            working_dir.clone(),
            pre_command_scrollback.unwrap_or_default(),
        );
    }

    Ok(())
}

fn agent_input_source(source: &str) -> AgentInputSource {
    match source {
        "voice" => AgentInputSource::UserVoice,
        "command" => AgentInputSource::TriggerUserCommand,
        "trigger" => AgentInputSource::TriggerColumn,
        "system" => AgentInputSource::System,
        _ => AgentInputSource::UserChat,
    }
}

/// Classify a per-task **chat-turn** into the two runtime modes this path can
/// actually deliver: `managed` (semantic event stream) or `terminal` (raw `-p`
/// turn). It deliberately does **not** return `interactive` — interactive
/// follow-up input is routed through `agent_inject_message`
/// (`tmux send-keys`), never through this turn path, so an `interactive` task
/// collapses to `terminal` here as a defensive fallback.
///
/// This is intentionally narrower than the full spawn-time resolver
/// [`crate::pipeline::triggers::normalize_agent_runtime_mode`], which also
/// applies the dev-flag / CLI-support gating and can return `interactive`.
/// They share no logic on purpose: this one answers "how do I deliver a chat
/// turn?", that one answers "how should a fresh agent be spawned?".
fn chat_turn_runtime_mode(runtime_mode: Option<&str>) -> &'static str {
    match runtime_mode {
        Some("managed") => "managed",
        _ => "terminal",
    }
}

#[allow(clippy::too_many_arguments)]
fn spawn_managed_task_turn(
    app: AppHandle,
    task_id: String,
    session_id: String,
    adapter_kind: String,
    cli_path: String,
    model: String,
    effort_level: Option<String>,
    working_dir: String,
    text: String,
    resume_id: Option<String>,
) {
    let mut workspace_id = String::new();
    if let Ok(conn) = rusqlite::Connection::open(db::db_path()) {
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
        let _ = db::update_agent_session(
            &conn,
            &session_id,
            None,
            Some("running"),
            None,
            None,
            None,
            Some(true),
        );
        let _ = db::update_task_agent_status(&conn, &task_id, Some("running"), None);
        // Real workspace id so useTaskSync doesn't drop this refresh (the filter
        // is `payload.workspaceId === workspaceId`).
        workspace_id = db::get_task(&conn, &task_id)
            .map(|task| task.workspace_id)
            .unwrap_or_default();
    }
    crate::pipeline::emit_tasks_changed(&app, &workspace_id, "managed_agent_turn_running");

    let adapter = agent_adapter_kind_from_db(&adapter_kind);
    let invocation = if adapter == AgentAdapterKind::CodexCli {
        CodexCliAdapter::new(
            cli_path.clone(),
            model.clone(),
            Some(working_dir.clone()),
            resume_id.clone(),
        )
        .managed_turn_invocation(&text)
    } else {
        ClaudeCliAdapter::new(
            cli_path.clone(),
            model.clone(),
            String::new(),
            effort_level.clone(),
            Some(working_dir.clone()),
            resume_id.clone(),
        )
        .managed_turn_invocation(&text)
    };

    let command_metadata = serde_json::json!({
        "cli": cli_path,
        "model": model,
        "workdir": working_dir,
        "adapter": adapter,
        "runtimeMode": "managed",
    })
    .to_string();
    let _ = crate::events::persist_and_emit_agent_transcript_event(
        &app,
        &task_id,
        Some(&session_id),
        db::EVENT_COMMAND_STARTED,
        None,
        Some(&command_metadata),
    );

    let app_for_queue = app.clone();
    let task_id_for_queue = task_id.clone();
    let session_id_for_queue = session_id.clone();
    let adapter_kind_for_queue = adapter_kind.clone();
    let cli_path_for_queue = cli_path.clone();
    let model_for_queue = model.clone();
    let effort_level_for_queue = effort_level.clone();
    let working_dir_for_queue = working_dir.clone();
    let working_dir_for_auto_commit = working_dir.clone();

    tokio::spawn(async move {
        let result = run_managed_runtime_turn(
            ManagedRuntimeTurnConfig {
                adapter,
                command: invocation.command,
                args: invocation.args,
                working_dir: invocation.working_dir,
            },
            {
                let app = app.clone();
                let task_id = task_id.clone();
                let session_id = session_id.clone();
                move |event| {
                    if let AgentRuntimeEvent::SessionStarted {
                        provider_session_id,
                        model,
                        ..
                    } = &event
                    {
                        if let Ok(conn) = rusqlite::Connection::open(db::db_path()) {
                            let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                            let _ = db::update_agent_session_runtime(
                                &conn,
                                &session_id,
                                None,
                                Some("managed"),
                                provider_session_id.as_deref().map(Some),
                                None,
                            );
                            let _ = db::update_agent_session_model(
                                &conn,
                                &session_id,
                                model.as_deref(),
                                None,
                            );
                        }
                    }
                    let _ = crate::events::persist_and_emit_agent_runtime_event(
                        &app,
                        &task_id,
                        Some(&session_id),
                        event,
                    );
                }
            },
        )
        .await;

        let mut success = managed_turn_completed_successfully(&result);
        if success {
            match auto_commit_completed_worktree(
                &app,
                &task_id,
                Some(&session_id),
                &working_dir_for_auto_commit,
            ) {
                Ok(_) => {}
                Err(err) => {
                    eprintln!(
                        "[agent] auto-commit FAILED for managed task turn {}: {}",
                        task_id, err
                    );
                    success = false;
                }
            }
        }

        let spawned_queued_turn = if success {
            spawn_next_queued_managed_turn(
                app_for_queue,
                task_id_for_queue,
                session_id_for_queue,
                adapter_kind_for_queue,
                cli_path_for_queue,
                model_for_queue,
                effort_level_for_queue,
                working_dir_for_queue,
            )
        } else {
            false
        };

        if let Ok(conn) = rusqlite::Connection::open(db::db_path()) {
            let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
            if !spawned_queued_turn {
                let (session_status, task_status, exit_code) = match &result {
                    Ok(turn) if success => {
                        ("completed", "completed", turn.exit_code.map(i64::from))
                    }
                    Ok(turn) => (
                        "failed",
                        "failed",
                        Some(i64::from(turn.exit_code.unwrap_or(1).max(1))),
                    ),
                    Err(_) => ("failed", "failed", Some(1_i64)),
                };
                let _ = db::update_agent_session(
                    &conn,
                    &session_id,
                    None,
                    Some(session_status),
                    Some(exit_code),
                    None,
                    None,
                    Some(true),
                );
                let _ = db::update_task_agent_status(&conn, &task_id, Some(task_status), None);
            }
        }

        if !spawned_queued_turn {
            let _ = app.emit(
                "agent:complete",
                &AgentCompletePayload {
                    task_id: task_id.clone(),
                    success,
                    message: None,
                },
            );
        }
        crate::pipeline::emit_tasks_changed(
            &app,
            "",
            if spawned_queued_turn {
                "managed_agent_turn_queued"
            } else {
                "managed_agent_turn_complete"
            },
        );
    });
}

fn managed_turn_completed_successfully(
    result: &Result<ManagedRuntimeTurnResult, AgentRuntimeError>,
) -> bool {
    matches!(result, Ok(turn) if turn.exit_code == Some(0))
}

fn auto_commit_completed_worktree(
    app: &AppHandle,
    task_id: &str,
    session_id: Option<&str>,
    worktree_path: &str,
) -> Result<Option<String>, String> {
    // SAFETY: only auto-commit when the path is an actual git worktree
    // (where `.git` is a file containing `gitdir: …`), not the user's
    // primary checkout. A task without worktree_path runs in the workspace
    // repo root; staging+committing there would mix the user's WIP with
    // agent output on whatever branch HEAD currently points at.
    let git_marker = std::path::Path::new(worktree_path).join(".git");
    if !git_marker.is_file() {
        return Ok(None);
    }

    if !crate::git::branch_manager::worktree_is_dirty(worktree_path)? {
        return Ok(None);
    }

    let msg = format!(
        "auto-commit: kaitencode rescued uncommitted work for task {} (agent exited 0 without committing)",
        task_id
    );
    let commit_hash = crate::git::branch_manager::auto_commit_dirty_worktree(worktree_path, &msg)?;
    if let Some(hash) = commit_hash.as_deref() {
        let short_hash: String = hash.chars().take(7).collect();
        eprintln!(
            "[agent] auto-committed dirty managed turn worktree for task {} at {}",
            task_id, hash
        );
        let message = format!("Auto-committed dirty worktree at {}", short_hash);
        let _ = crate::events::persist_and_emit_agent_transcript_event(
            app,
            task_id,
            session_id,
            db::EVENT_COMMAND_OUTPUT,
            Some(&message),
            Some(
                &serde_json::json!({
                    "source": "auto_commit",
                    "command": "git commit",
                    "commit": hash,
                })
                .to_string(),
            ),
        );
    }
    Ok(commit_hash)
}

#[allow(clippy::too_many_arguments)]
fn spawn_next_queued_managed_turn(
    app: AppHandle,
    task_id: String,
    session_id: String,
    adapter_kind: String,
    cli_path: String,
    model: String,
    effort_level: Option<String>,
    working_dir: String,
) -> bool {
    let Some((prompt, resume_id)) = (|| {
        let conn = rusqlite::Connection::open(db::db_path()).ok()?;
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
        let (prompt, _) = drain_pending_runtime_inputs_for_turn(&conn, &task_id).ok()??;
        let session = db::get_agent_session(&conn, &session_id).ok()?;
        let resume_id = session.provider_session_id.or(session.cli_session_id);
        Some((prompt, resume_id))
    })() else {
        return false;
    };

    spawn_managed_task_turn(
        app,
        task_id,
        session_id,
        adapter_kind,
        cli_path,
        model,
        effort_level,
        working_dir,
        prompt,
        resume_id,
    );
    true
}

fn agent_adapter_kind_from_db(adapter_kind: &str) -> AgentAdapterKind {
    match adapter_kind {
        "codex_cli" | "codex" => AgentAdapterKind::CodexCli,
        "generic_cli" | "generic" => AgentAdapterKind::GenericCli,
        "api" => AgentAdapterKind::Api,
        "remote" => AgentAdapterKind::Remote,
        _ => AgentAdapterKind::ClaudeCli,
    }
}

fn agent_input_source_key(source: AgentInputSource) -> &'static str {
    match source {
        AgentInputSource::UserChat => "user_chat",
        AgentInputSource::UserVoice => "user_voice",
        AgentInputSource::TriggerColumn => "trigger_column",
        AgentInputSource::TriggerUserCommand => "trigger_user_command",
        AgentInputSource::System => "system",
    }
}

fn agent_type_from_cli_path(cli_path: &str) -> &str {
    let cli = cli_path
        .rsplit('/')
        .next()
        .unwrap_or(cli_path)
        .to_ascii_lowercase();
    if cli.contains("codex") {
        "codex"
    } else if cli.contains("claude") {
        "claude"
    } else {
        "generic"
    }
}

fn tmux_session_name_for_task(task_id: &str) -> String {
    crate::chat::tmux_transport::session_name(task_id)
}

fn build_task_input_line(
    cli_path: &str,
    model: &str,
    text: &str,
    resume_id: Option<&str>,
    should_launch_prompt_command: bool,
) -> Result<TaskInputLine, String> {
    if !should_launch_prompt_command {
        return Ok(TaskInputLine {
            line: text.to_string(),
            completion: None,
        });
    }

    let args = crate::pipeline::spawn::model_to_args(Some(model));

    let adapter_kind = agent_adapter_kind_from_db(agent_type_from_cli_path(cli_path));
    let mut command = crate::chat::bridge::build_trigger_command(cli_path, &args, text, resume_id);
    let nonce = uuid::Uuid::new_v4().to_string().replace('-', "");
    let wait_channel = format!("kaitencode_chat_done_{}", nonce);
    let dir = crate::chat::log_retention::trigger_logs_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create log dir: {}", e))?;
    let semantic_log_path = match adapter_kind {
        AgentAdapterKind::ClaudeCli | AgentAdapterKind::CodexCli => {
            let path = dir
                .join(format!("chat_semantic_{}.jsonl", nonce))
                .display()
                .to_string();
            let env_name = if adapter_kind == AgentAdapterKind::CodexCli {
                "KAITENCODE_CODEX_JSON_LOG"
            } else {
                "KAITENCODE_CLAUDE_JSON_LOG"
            };
            let legacy_env_name = if adapter_kind == AgentAdapterKind::CodexCli {
                "BENTOYA_CODEX_JSON_LOG"
            } else {
                "BENTOYA_CLAUDE_JSON_LOG"
            };
            command = format!(
                "{}={} {}={} {}",
                env_name,
                shell_quote_arg(&path),
                legacy_env_name,
                shell_quote_arg(&path),
                command
            );
            Some(path)
        }
        _ => None,
    };
    let exit_path = dir
        .join(format!("chat_exit_{}.code", nonce))
        .display()
        .to_string();
    let wrapped = format!(
        "{}; rc=$?; printf '%s' \"$rc\" > {}; tmux wait-for -S {}",
        command,
        shell_quote_arg(&exit_path),
        wait_channel
    );
    let line = crate::chat::bridge::materialize_shell_launcher(&wrapped, Some(&nonce))?;
    Ok(TaskInputLine {
        line,
        completion: Some(TaskInputCompletion {
            wait_channel,
            exit_path,
            semantic_log_path,
            adapter_kind,
        }),
    })
}

fn spawn_task_input_completion_watcher(
    app: AppHandle,
    task_id: String,
    session_id: String,
    completion: TaskInputCompletion,
    working_dir: String,
    pre_command_scrollback: String,
) {
    tokio::spawn(async move {
        let wait_channel = completion.wait_channel;
        let exit_path = completion.exit_path;
        let semantic_log_path = completion.semantic_log_path.clone();
        let semantic_offset = Arc::new(AtomicUsize::new(0));
        let semantic_output_emitted = Arc::new(AtomicBool::new(false));
        let semantic_stop = Arc::new(AtomicBool::new(false));
        let semantic_parser = Arc::new(Mutex::new(ManagedRuntimeStreamParser::new(
            completion.adapter_kind,
        )));
        let semantic_flusher = semantic_log_path.as_ref().map(|path| {
            let app = app.clone();
            let task_id = task_id.clone();
            let session_id = session_id.clone();
            let path = path.clone();
            let offset = Arc::clone(&semantic_offset);
            let emitted = Arc::clone(&semantic_output_emitted);
            let stop = Arc::clone(&semantic_stop);
            let parser = Arc::clone(&semantic_parser);
            tokio::spawn(async move {
                while !stop.load(Ordering::Relaxed) {
                    tokio::time::sleep(Duration::from_millis(350)).await;
                    if stop.load(Ordering::Relaxed) {
                        break;
                    }
                    if emit_terminal_chat_semantic_log_delta(
                        &app,
                        &task_id,
                        &session_id,
                        &path,
                        &offset,
                        &parser,
                    ) {
                        emitted.store(true, Ordering::Relaxed);
                    }
                }
            })
        });
        let wait_channel_for_wait = wait_channel.clone();
        let wait_handle = tokio::task::spawn_blocking(move || -> Result<(), String> {
            let status = std::process::Command::new("tmux")
                .args(["wait-for", &wait_channel_for_wait])
                .status()
                .map_err(|e| format!("tmux wait-for spawn error: {}", e))?;
            if status.success() {
                Ok(())
            } else {
                Err(format!("tmux wait-for exited {:?}", status.code()))
            }
        });

        let timed_out = tokio::time::timeout(TASK_INPUT_COMPLETION_TIMEOUT, wait_handle)
            .await
            .is_err();
        semantic_stop.store(true, Ordering::Relaxed);
        if let Some(handle) = semantic_flusher {
            handle.abort();
        }
        let mut exit_code = if timed_out {
            124
        } else {
            std::fs::read_to_string(&exit_path)
                .ok()
                .and_then(|s| s.trim().parse::<i32>().ok())
                .unwrap_or(1)
        };
        let _ = std::fs::remove_file(&exit_path);
        let mut success = exit_code == 0;
        let mut auto_commit_hash: Option<String> = None;
        if success {
            match auto_commit_completed_worktree(&app, &task_id, Some(&session_id), &working_dir) {
                Ok(hash) => {
                    auto_commit_hash = hash;
                }
                Err(err) => {
                    eprintln!(
                        "[agent] auto-commit FAILED for terminal task turn {}: {}",
                        task_id, err
                    );
                    success = false;
                    exit_code = 1;
                }
            }
        }
        let final_semantic_emitted = completion
            .semantic_log_path
            .as_deref()
            .map(|path| {
                emit_terminal_chat_semantic_log_delta(
                    &app,
                    &task_id,
                    &session_id,
                    path,
                    &semantic_offset,
                    &semantic_parser,
                )
            })
            .unwrap_or(false);
        if let Some(path) = completion.semantic_log_path.as_deref() {
            let _ = std::fs::remove_file(path);
        }
        let semantic_output_emitted =
            semantic_output_emitted.load(Ordering::Relaxed) || final_semantic_emitted;
        let post_command_scrollback =
            crate::chat::tmux_transport::capture_scrollback_text(&task_id);
        let output_delta = if !pre_command_scrollback.is_empty()
            && post_command_scrollback.starts_with(&pre_command_scrollback)
        {
            post_command_scrollback[pre_command_scrollback.len()..].to_string()
        } else {
            post_command_scrollback
        };
        if !semantic_output_emitted && !output_delta.trim().is_empty() {
            let _ = crate::events::persist_and_emit_agent_transcript_event(
                &app,
                &task_id,
                Some(&session_id),
                db::EVENT_COMMAND_OUTPUT,
                Some(&output_delta),
                Some(&serde_json::json!({ "source": "tmux_log_tail" }).to_string()),
            );
        }
        let metadata = serde_json::json!({
            "exitCode": exit_code,
            "timedOut": timed_out,
            "autoCommitHash": auto_commit_hash,
        })
        .to_string();

        let _ = crate::events::persist_and_emit_agent_transcript_event(
            &app,
            &task_id,
            Some(&session_id),
            db::EVENT_COMMAND_COMPLETED,
            None,
            Some(&metadata),
        );
        let _ = crate::events::persist_and_emit_agent_transcript_event(
            &app,
            &task_id,
            Some(&session_id),
            if success {
                db::EVENT_AGENT_COMPLETED
            } else {
                db::EVENT_AGENT_FAILED
            },
            None,
            Some(&metadata),
        );

        if let Ok(conn) = rusqlite::Connection::open(db::db_path()) {
            let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
            let status = if success { "completed" } else { "failed" };
            let _ = db::update_agent_session(
                &conn,
                &session_id,
                None,
                Some(status),
                Some(Some(exit_code as i64)),
                None,
                None,
                None,
            );
            let _ = db::update_task_agent_status(&conn, &task_id, Some(status), None);
            if let Ok(task) = db::get_task(&conn, &task_id) {
                crate::pipeline::emit_tasks_changed(
                    &app,
                    &task.workspace_id,
                    "agent_chat_complete",
                );
            }
        }

        let _ = app.emit(
            "agent:complete",
            &AgentCompletePayload {
                task_id,
                success,
                message: None,
            },
        );
    });
}

fn emit_terminal_chat_semantic_log_delta(
    app: &AppHandle,
    task_id: &str,
    session_id: &str,
    path: &str,
    offset: &AtomicUsize,
    parser: &Mutex<ManagedRuntimeStreamParser>,
) -> bool {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return false;
    };
    let start = offset.load(Ordering::Relaxed).min(contents.len());
    let Some((delta, end)) = complete_line_delta(&contents, start) else {
        return false;
    };
    offset.store(end, Ordering::Relaxed);
    emit_terminal_chat_semantic_log(app, task_id, session_id, delta, parser)
}

fn complete_line_delta(contents: &str, start: usize) -> Option<(&str, usize)> {
    let start = start.min(contents.len());
    let tail = contents.get(start..)?;
    let end_offset = tail.rfind('\n')? + 1;
    Some((&tail[..end_offset], start + end_offset))
}

fn emit_terminal_chat_semantic_log(
    app: &AppHandle,
    task_id: &str,
    session_id: &str,
    contents: &str,
    parser: &Mutex<ManagedRuntimeStreamParser>,
) -> bool {
    let mut emitted = false;
    for line in contents.lines().filter(|line| !line.trim().is_empty()) {
        let events = {
            let mut parser = parser.lock().unwrap();
            match parser.process_line(line) {
                ProviderRuntimeLine::Events(events) => events,
                ProviderRuntimeLine::Completed { exit_code, usage } => {
                    vec![AgentRuntimeEvent::AgentCompleted { exit_code, usage }]
                }
                ProviderRuntimeLine::Failed { exit_code, error } => {
                    vec![AgentRuntimeEvent::AgentFailed { exit_code, error }]
                }
                ProviderRuntimeLine::Ignored => Vec::new(),
            }
        };
        for event in events {
            if let AgentRuntimeEvent::SessionStarted {
                provider_session_id: Some(provider_session_id),
                ..
            } = &event
            {
                if let Ok(conn) = rusqlite::Connection::open(db::db_path()) {
                    let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                    let _ = db::update_agent_session_runtime(
                        &conn,
                        session_id,
                        None,
                        Some("terminal"),
                        Some(Some(provider_session_id)),
                        None,
                    );
                }
            }
            if matches!(
                event,
                AgentRuntimeEvent::AgentCompleted { .. }
                    | AgentRuntimeEvent::AgentFailed { .. }
                    | AgentRuntimeEvent::AgentCancelled { .. }
            ) {
                continue;
            }
            emitted = true;
            let _ = crate::events::persist_and_emit_agent_runtime_event(
                app,
                task_id,
                Some(session_id),
                event,
            );
        }
    }
    emitted
}

fn shell_quote_arg(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Back-compat wrapper used by older hooks/tests; task chat now writes into
/// the existing PTY/tmux lane instead of spawning a Pipe subprocess.
#[tauri::command(rename_all = "camelCase")]
#[allow(clippy::too_many_arguments)]
pub async fn stream_agent_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    task_id: String,
    message: String,
    working_dir: String,
    cli_path: String,
    model: Option<String>,
    effort_level: Option<String>,
) -> Result<(), AppError> {
    send_task_input(
        app,
        state,
        session_registry,
        task_id,
        message,
        "chat".to_string(),
        working_dir,
        cli_path,
        model,
        effort_level,
    )
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub fn hold_task(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
    held: bool,
) -> Result<db::Task, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let task = db::set_task_held_by_user(&conn, &task_id, held)?;
    crate::pipeline::emit_tasks_changed(&app, &task.workspace_id, "task_hold_updated");
    Ok(task)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn kill_task_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    task_id: String,
) -> Result<(), AppError> {
    {
        let mut registry = session_registry.lock().await;
        registry.remove(&task_id);
    }
    crate::chat::tmux_transport::kill_session(&task_id).map_err(AppError::InvalidInput)?;
    // Phase 4 telemetry — sample task state BEFORE we clear agent_status
    // so we capture what was running. Done before the agent_status
    // update so the resolver call sees the still-set fields.
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        if let Ok(task) = db::get_task(&conn, &task_id) {
            if let Ok(column) = db::get_column(&conn, &task.column_id) {
                let resolved =
                    crate::pipeline::triggers::resolve_runtime_mode_for_task(&task, &column);
                let cli = task
                    .agent_session_id
                    .as_deref()
                    .and_then(|sid| db::get_agent_session(&conn, sid).ok())
                    .map(|s| s.agent_type)
                    .unwrap_or_else(|| "unknown".to_string());
                db::completion_events::record_async(
                    task_id.clone(),
                    task.workspace_id.clone(),
                    cli,
                    resolved.mode,
                    db::completion_events::CompletionSource::Kill,
                    0,
                    None,
                );
            }
        }
        let _ = db::update_task_agent_status(&conn, &task_id, None, None)?;
    }
    let _ = app.emit(
        "agent:complete",
        &AgentCompletePayload {
            task_id,
            success: false,
            message: Some("Killed".to_string()),
        },
    );
    Ok(())
}

/// Switch transport type for an agent session (pipe ↔ pty).
///
/// If a session exists: suspends it (preserving resume ID), switches transport.
/// If no session exists and switching to PTY: creates a new PTY session.
/// Uses managed bridge for PTY event forwarding.
#[tauri::command(rename_all = "camelCase")]
#[allow(clippy::too_many_arguments)]
pub async fn switch_agent_transport(
    app: AppHandle,
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    task_id: String,
    transport_type: String,
    cli_path: Option<String>,
    working_dir: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<(), AppError> {
    let target_type = match transport_type.as_str() {
        "pipe" => TransportType::Pipe,
        "pty" => TransportType::Pty,
        _ => {
            return Err(AppError::InvalidInput(format!(
                "Invalid transport type: {}",
                transport_type
            )))
        }
    };

    let c = cols.unwrap_or(120);
    let r = rows.unwrap_or(40);

    let mut registry = session_registry.lock().await;

    let has_session = registry.has(&task_id);
    let current_type = registry.get(&task_id).map(|s| s.transport_type());

    if has_session {
        // Already using this transport — no-op
        if current_type == Some(target_type) {
            return Ok(());
        }

        // Cancel existing bridge when switching transport
        registry.cancel_bridge(&task_id);

        let session = registry.get_mut(&task_id).unwrap();
        session.suspend().map_err(AppError::InvalidInput)?;
        session.set_transport_type(target_type);

        if target_type == TransportType::Pty {
            let _mpsc_rx = session.start_pty(c, r).map_err(AppError::InvalidInput)?;
            let rx = session.resubscribe();

            if let Some(rx) = rx {
                let bridge = crate::chat::bridge::ManagedBridge::start(app, task_id.clone(), rx);
                registry.set_bridge(&task_id, bridge);
            }
        }
    } else if target_type == TransportType::Pty {
        let requested_working_dir = working_dir.as_deref().ok_or_else(|| {
            AppError::InvalidInput(
                "Working directory is required to start PTY transport".to_string(),
            )
        })?;
        let (validated_working_dir, cli) = validate_task_launch_inputs(
            &state,
            &task_id,
            requested_working_dir,
            cli_path.as_deref(),
        )?;
        let config = SessionConfig {
            cli_path: cli,
            model: "sonnet".to_string(),
            system_prompt: String::new(),
            working_dir: Some(validated_working_dir),
            effort_level: None,
        };

        let session = registry
            .get_or_create(&task_id, config, TransportType::Pty)
            .map_err(AppError::InvalidInput)?;

        let _mpsc_rx = session.start_pty(c, r).map_err(AppError::InvalidInput)?;

        if let Some(rx) = session.resubscribe() {
            let bridge = crate::chat::bridge::ManagedBridge::start(app, task_id.clone(), rx);
            registry.set_bridge(&task_id, bridge);
        }
    }

    Ok(())
}

/// Ensure a PTY session exists for a task. Spawns a bare shell if none exists
/// unless `allow_spawn` is false.
///
/// Called by the terminal view on mount. Uses a single managed bridge per task:
/// - Session alive + bridge alive → return scrollback (no new bridge)
/// - Session alive + bridge dead → start new managed bridge
/// - Session dead or missing + allow_spawn=true → spawn fresh shell + managed bridge
/// - Session dead or missing + allow_spawn=false → return cached/tmux scrollback only
#[tauri::command(rename_all = "camelCase")]
#[allow(clippy::too_many_arguments)]
pub async fn ensure_pty_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    task_id: String,
    working_dir: String,
    cols: u16,
    rows: u16,
    allow_spawn: Option<bool>,
) -> Result<AgentInfo, String> {
    validate_task_exists(&state, &task_id).map_err(|e| e.to_string())?;
    let mut registry = session_registry.lock().await;
    let allow_spawn = allow_spawn.unwrap_or(true);

    // Case 1: Session is alive
    let session_alive = registry
        .get(&task_id)
        .map(|s| s.is_alive())
        .unwrap_or(false);
    if session_alive {
        let needs_bridge = !registry.has_active_bridge(&task_id);

        let (scrollback, pid, resubscribe_rx) = {
            let session = registry.get_mut(&task_id).unwrap();
            // Resize PTY to match panel dimensions (sends SIGWINCH to running process)
            // This fixes TUI apps (codex, vim) that were spawned at a different size
            let _ = session.resize_pty(cols, rows);
            // If we need to create a new bridge, the tmux attach will stream
            // the current pane contents. Returning captured scrollback too
            // duplicates the visible terminal on first attach.
            let scrollback = if needs_bridge {
                String::new()
            } else {
                session.scrollback()
            };
            let pid = session.pid();
            let rx = if needs_bridge {
                session.resubscribe()
            } else {
                None
            };
            (scrollback, pid, rx)
        }; // session borrow ends

        if let Some(rx) = resubscribe_rx {
            let bridge =
                crate::chat::bridge::ManagedBridge::start(app.clone(), task_id.clone(), rx);
            registry.set_bridge(&task_id, bridge);
        }

        return Ok(AgentInfo {
            task_id,
            agent_type: "shell".to_string(),
            status: "Running".to_string(),
            pid,
            working_dir,
            scrollback: if scrollback.is_empty() {
                None
            } else {
                Some(scrollback)
            },
        });
    }

    // Case 2: Session dead or missing, but caller only wants to attach.
    // Clean up a dead registry entry so future attach-only views can restore
    // the last cached terminal contents without reviving the task.
    if !allow_spawn {
        registry.remove(&task_id);
        let cached_scrollback = registry.take_scrollback(&task_id);
        let tmux_scrollback = capture_scrollback(&task_id);
        let scrollback = if !tmux_scrollback.is_empty() {
            tmux_scrollback
        } else {
            cached_scrollback
        };

        return Ok(AgentInfo {
            task_id,
            agent_type: "shell".to_string(),
            status: "Missing".to_string(),
            pid: None,
            working_dir,
            scrollback: if scrollback.is_empty() {
                None
            } else {
                Some(scrollback)
            },
        });
    }

    // Case 3: Session dead or missing — spawn fresh
    let (working_dir, _) =
        validate_task_launch_inputs(&state, &task_id, &working_dir, Some("claude"))
            .map_err(|e| e.to_string())?;

    // Remove dead session (caches scrollback + cancels old bridge)
    registry.remove(&task_id);
    let cached_scrollback = registry.take_scrollback(&task_id);

    let shell = default_user_shell();
    let config = SessionConfig {
        cli_path: shell,
        model: String::new(),
        system_prompt: String::new(),
        working_dir: Some(working_dir.clone()),
        effort_level: None,
    };

    let session = registry
        .get_or_create(&task_id, config, TransportType::Pty)
        .map_err(|e| e.to_string())?;

    let _mpsc_rx = session.start_pty(cols, rows)?;
    let pid = session.pid();
    let live_scrollback = session.scrollback();

    // Start managed bridge via broadcast
    if let Some(rx) = session.resubscribe() {
        let bridge = crate::chat::bridge::ManagedBridge::start(app.clone(), task_id.clone(), rx);
        registry.set_bridge(&task_id, bridge);
    }

    Ok(AgentInfo {
        task_id,
        agent_type: "shell".to_string(),
        status: "Running".to_string(),
        pid,
        working_dir,
        scrollback: if !live_scrollback.is_empty() {
            Some(live_scrollback)
        } else if cached_scrollback.is_empty() {
            None
        } else {
            Some(cached_scrollback)
        },
    })
}

/// Phase 4 (chef terminal) — ensure a workspace-level interactive terminal
/// exists, mirroring `ensure_pty_session` but keyed by workspace instead of
/// task. It's a login shell rooted at the repo, so the user can drive
/// `claude`/`codex` (or anything) without leaving the app. The registry key is
/// `chef_<workspace_id>`, so it rides the same generic PTY IPC
/// (`write_to_pty`/`resize_pty`/`get_pty_scrollback`) and `pty:<key>:*` events
/// as task terminals — only the spawn/attach entrypoint differs.
#[tauri::command(rename_all = "camelCase")]
#[allow(clippy::too_many_arguments)]
pub async fn ensure_chef_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    session_registry: State<'_, SharedSessionRegistry>,
    workspace_id: String,
    cols: u16,
    rows: u16,
    allow_spawn: Option<bool>,
    shell_index: Option<u32>,
) -> Result<AgentInfo, String> {
    let repo_path = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::get_workspace(&conn, &workspace_id)
            .map_err(|_| format!("workspace not found: {}", workspace_id))?
            .repo_path
    };
    // Shell 1 keeps the bare `chef_<ws>` key (back-compat with the single-shell
    // session); additional shells are `chef_<ws>_<n>`. The key flows through the
    // registry, bridge, and `pty:<key>:*` events unchanged.
    let key = match shell_index {
        Some(n) if n > 1 => format!("chef_{}_{}", workspace_id, n),
        _ => format!("chef_{}", workspace_id),
    };
    let allow_spawn = allow_spawn.unwrap_or(true);
    let mut registry = session_registry.lock().await;

    // Case 1: session alive — reattach (resize + bridge) and return.
    let session_alive = registry.get(&key).map(|s| s.is_alive()).unwrap_or(false);
    if session_alive {
        let needs_bridge = !registry.has_active_bridge(&key);
        let (scrollback, pid, resubscribe_rx) = {
            let session = registry.get_mut(&key).unwrap();
            let _ = session.resize_pty(cols, rows);
            let scrollback = if needs_bridge { String::new() } else { session.scrollback() };
            let pid = session.pid();
            let rx = if needs_bridge { session.resubscribe() } else { None };
            (scrollback, pid, rx)
        };
        if let Some(rx) = resubscribe_rx {
            let bridge = crate::chat::bridge::ManagedBridge::start(app.clone(), key.clone(), rx);
            registry.set_bridge(&key, bridge);
        }
        return Ok(AgentInfo {
            task_id: key,
            agent_type: "shell".to_string(),
            status: "Running".to_string(),
            pid,
            working_dir: repo_path,
            scrollback: if scrollback.is_empty() { None } else { Some(scrollback) },
        });
    }

    // Case 2: dead/missing and caller only wants to attach — restore scrollback.
    if !allow_spawn {
        registry.remove(&key);
        let cached = registry.take_scrollback(&key);
        let tmux = capture_scrollback(&key);
        let scrollback = if !tmux.is_empty() { tmux } else { cached };
        return Ok(AgentInfo {
            task_id: key,
            agent_type: "shell".to_string(),
            status: "Missing".to_string(),
            pid: None,
            working_dir: repo_path,
            scrollback: if scrollback.is_empty() { None } else { Some(scrollback) },
        });
    }

    // Case 3: spawn a fresh shell at the repo root.
    registry.remove(&key);
    let cached_scrollback = registry.take_scrollback(&key);
    let config = SessionConfig {
        cli_path: default_user_shell(),
        model: String::new(),
        system_prompt: String::new(),
        working_dir: Some(repo_path.clone()),
        effort_level: None,
    };
    let session = registry
        .get_or_create(&key, config, TransportType::Pty)
        .map_err(|e| e.to_string())?;
    let _mpsc_rx = session.start_pty(cols, rows)?;
    let pid = session.pid();
    let live_scrollback = session.scrollback();
    if let Some(rx) = session.resubscribe() {
        let bridge = crate::chat::bridge::ManagedBridge::start(app.clone(), key.clone(), rx);
        registry.set_bridge(&key, bridge);
    }
    Ok(AgentInfo {
        task_id: key,
        agent_type: "shell".to_string(),
        status: "Running".to_string(),
        pid,
        working_dir: repo_path,
        scrollback: if !live_scrollback.is_empty() {
            Some(live_scrollback)
        } else if cached_scrollback.is_empty() {
            None
        } else {
            Some(cached_scrollback)
        },
    })
}

/// Cancel an ongoing agent chat by sending Ctrl+C, preserving the session.
#[tauri::command(rename_all = "camelCase")]
pub async fn cancel_agent_chat(app: AppHandle, task_id: String) -> Result<(), AppError> {
    crate::chat::tmux_transport::cancel_agent(&task_id);

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

// ─── Queue Management Commands ────────────────────────────────────────────

const DEFAULT_MAX_CONCURRENT_AGENTS: i64 = 5;

/// Read maxConcurrentAgents from workspace config JSON, falling back to default.
fn get_max_concurrent(conn: &rusqlite::Connection, workspace_id: &str) -> i64 {
    db::get_workspace(conn, workspace_id)
        .ok()
        .and_then(|ws| serde_json::from_str::<serde_json::Value>(&ws.config).ok())
        .and_then(|cfg| cfg.get("maxConcurrentAgents")?.as_i64())
        .unwrap_or(DEFAULT_MAX_CONCURRENT_AGENTS)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueStatus {
    pub queued_count: usize,
    pub running_count: i64,
    pub max_concurrent: i64,
    pub queued_tasks: Vec<db::Task>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn queue_agent_tasks(
    state: State<AppState>,
    task_ids: Vec<String>,
) -> Result<Vec<db::Task>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let queued_at = crate::db::now();
    let mut updated_tasks = Vec::new();

    for task_id in task_ids {
        let task = db::update_task_agent_status(&conn, &task_id, Some("queued"), Some(&queued_at))?;
        updated_tasks.push(task);
    }

    Ok(updated_tasks)
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_task_agent_status(
    state: State<AppState>,
    task_id: String,
    agent_status: Option<String>,
    queued_at: Option<String>,
) -> Result<db::Task, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::update_task_agent_status(
        &conn,
        &task_id,
        agent_status.as_deref(),
        queued_at.as_deref(),
    )?)
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_queue_status(
    state: State<AppState>,
    workspace_id: String,
) -> Result<QueueStatus, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let queued_tasks = db::get_queued_tasks(&conn, &workspace_id)?;
    let running_count = db::get_running_agent_count(&conn, &workspace_id)?;

    Ok(QueueStatus {
        queued_count: queued_tasks.len(),
        running_count,
        max_concurrent: get_max_concurrent(&conn, &workspace_id),
        queued_tasks,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_next_queued_task(
    state: State<AppState>,
    workspace_id: String,
) -> Result<Option<db::Task>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let running_count = db::get_running_agent_count(&conn, &workspace_id)?;

    if running_count >= get_max_concurrent(&conn, &workspace_id) {
        return Ok(None);
    }

    let queued = db::get_queued_tasks(&conn, &workspace_id)?;
    Ok(queued.into_iter().next())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_task_input_line_leaves_running_agent_input_literal() {
        assert_eq!(
            build_task_input_line("claude", "claude-sonnet-4-6", "hello", None, false)
                .unwrap()
                .line,
            "hello"
        );
    }

    #[test]
    fn build_task_input_line_launches_idle_claude_prompt_with_resume_and_model() {
        let input = build_task_input_line(
            "claude",
            "claude-sonnet-4-6",
            "hello agent",
            Some("session-123"),
            true,
        )
        .unwrap();

        let command = input.line;
        assert!(input.completion.is_some());
        assert!(command.starts_with("bash "));
        let script = std::fs::read_to_string(script_path_from_launcher(&command)).unwrap();
        assert!(script.contains("KAITENCODE_CLAUDE_JSON_LOG="));
        assert!(script.contains("BENTOYA_CLAUDE_JSON_LOG="));
        assert!(script.contains("claude"));
        assert!(script.contains("--model"));
        assert!(script.contains("claude-sonnet-4-6"));
        assert!(script.contains("--resume"));
        assert!(script.contains("session-123"));
        assert!(script.contains("-p"));
        assert!(script.contains("hello agent"));
        assert!(script.contains("tmux wait-for -S kaitencode_chat_done_"));
        let completion = input.completion.expect("completion");
        assert!(completion
            .semantic_log_path
            .as_deref()
            .expect("semantic log")
            .contains("chat_semantic_"));
        assert_eq!(completion.adapter_kind, AgentAdapterKind::ClaudeCli);
    }

    #[test]
    fn build_task_input_line_launches_codex_exec_for_idle_codex_prompt() {
        let input = build_task_input_line("codex", "gpt-5.4", "plan this", None, true).unwrap();

        let command = input.line;
        assert!(input.completion.is_some());
        assert!(command.starts_with("bash "));
        let script = std::fs::read_to_string(script_path_from_launcher(&command)).unwrap();
        assert!(!script.contains("KAITENCODE_CLAUDE_JSON_LOG="));
        assert!(script.contains("KAITENCODE_CODEX_JSON_LOG="));
        assert!(script.contains("BENTOYA_CODEX_JSON_LOG="));
        assert!(script.contains("codex"));
        assert!(script.contains(" exec"));
        assert!(script.contains("--json"));
        assert!(script.contains("sandbox_mode=\"danger-full-access\""));
        assert!(script.contains("approval_policy=\"never\""));
        assert!(script.contains("--model"));
        assert!(script.contains("gpt-5.4"));
        assert!(script.contains("plan this"));
        let completion = input.completion.expect("completion");
        assert!(completion
            .semantic_log_path
            .as_deref()
            .expect("semantic log")
            .contains("chat_semantic_"));
        assert_eq!(completion.adapter_kind, AgentAdapterKind::CodexCli);
    }

    #[test]
    fn maps_task_input_sources_to_runtime_sources() {
        assert_eq!(agent_input_source("chat"), AgentInputSource::UserChat);
        assert_eq!(
            agent_input_source_key(agent_input_source("chat")),
            "user_chat"
        );
        assert_eq!(agent_input_source("voice"), AgentInputSource::UserVoice);
        assert_eq!(
            agent_input_source_key(agent_input_source("voice")),
            "user_voice"
        );
        assert_eq!(
            agent_input_source("command"),
            AgentInputSource::TriggerUserCommand
        );
        assert_eq!(
            agent_input_source("trigger"),
            AgentInputSource::TriggerColumn
        );
        assert_eq!(agent_input_source("system"), AgentInputSource::System);
        assert_eq!(
            agent_input_source("something-else"),
            AgentInputSource::UserChat
        );
    }

    #[test]
    fn maps_cli_paths_to_agent_types_and_tmux_session_names() {
        assert_eq!(agent_type_from_cli_path("claude"), "claude");
        assert_eq!(agent_type_from_cli_path("/opt/homebrew/bin/codex"), "codex");
        assert_eq!(agent_type_from_cli_path("my-agent"), "generic");
        assert_eq!(
            tmux_session_name_for_task("task-123"),
            "kaitencode_task-123"
        );
        assert_eq!(
            agent_adapter_kind_from_db("codex_cli"),
            AgentAdapterKind::CodexCli
        );
        assert_eq!(
            agent_adapter_kind_from_db("claude_cli"),
            AgentAdapterKind::ClaudeCli
        );
        assert_eq!(chat_turn_runtime_mode(Some("managed")), "managed");
        assert_eq!(chat_turn_runtime_mode(Some("terminal")), "terminal");
        assert_eq!(chat_turn_runtime_mode(Some("surprise")), "terminal");
        // Interactive never flows through the chat-turn path; it collapses to
        // terminal here (real interactive input goes via agent_inject_message).
        assert_eq!(chat_turn_runtime_mode(Some("interactive")), "terminal");
    }

    #[test]
    fn validate_agent_cli_path_accepts_known_bare_binaries() {
        assert_eq!(validate_agent_cli_path("claude").unwrap(), "claude");
        assert_eq!(validate_agent_cli_path(" codex ").unwrap(), "codex");
    }

    #[test]
    fn validate_agent_cli_path_rejects_unknown_bare_binary() {
        let err = validate_agent_cli_path("sh").expect_err("unknown binary should fail");
        assert!(err.to_string().contains("Unsupported agent CLI binary"));
    }

    #[test]
    fn validate_agent_cli_path_rejects_non_file_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let err = validate_agent_cli_path(tmp.path().to_str().unwrap())
            .expect_err("directory should fail");
        assert!(err.to_string().contains("not an executable file"));
    }

    fn script_path_from_launcher(command: &str) -> String {
        command
            .strip_prefix("bash '")
            .and_then(|s| s.strip_suffix('\''))
            .expect("script launcher")
            .replace("'\\''", "'")
    }
}
