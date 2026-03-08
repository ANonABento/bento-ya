//! Handlers for incoming commands from the Discord sidecar
//!
//! The sidecar sends commands like `db:get_thread_by_discord_id` and expects
//! responses back from Rust.

use crate::db::{self, AppState};
use crate::process::agent_cli_session::SharedAgentCliSessionManager;
use serde_json::json;
use tauri::AppHandle;

/// Context needed for handling Discord commands
pub struct CommandContext<'a> {
    pub state: &'a AppState,
    pub agent_cli_manager: &'a SharedAgentCliSessionManager,
    pub app: &'a AppHandle,
}

/// Handle an incoming command from the sidecar
/// Returns (success, data, error)
pub async fn handle_command(
    ctx: &CommandContext<'_>,
    cmd_type: &str,
    payload: &serde_json::Value,
) -> (bool, Option<serde_json::Value>, Option<String>) {
    match cmd_type {
        // Database queries (sync)
        "db:get_thread_by_discord_id" => handle_get_thread_by_discord_id(ctx.state, payload),
        "db:get_message_route" => handle_get_message_route(ctx.state, payload),
        "db:is_chef_channel" => handle_is_chef_channel(ctx.state, payload),
        "db:get_workspace_by_chef_channel" => handle_get_workspace_by_chef_channel(ctx.state, payload),
        "db:get_thread_mapping" => handle_get_thread_mapping(ctx.state, payload),

        // Agent commands (async)
        "agent:send_message" => handle_agent_send_message(ctx, payload).await,
        "agent:resume" => handle_agent_resume(ctx, payload).await,
        "agent:start" => handle_agent_start(ctx, payload).await,

        // Chef orchestrator (async)
        "chef:message" => handle_chef_message(ctx, payload).await,

        _ => (false, None, Some(format!("Unknown command type: {}", cmd_type))),
    }
}

/// Get thread mapping by Discord thread ID
fn handle_get_thread_by_discord_id(
    state: &AppState,
    payload: &serde_json::Value,
) -> (bool, Option<serde_json::Value>, Option<String>) {
    let thread_id = match payload.get("threadId").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => return (false, None, Some("Missing threadId".to_string())),
    };

    let conn = match state.db.lock() {
        Ok(c) => c,
        Err(e) => return (false, None, Some(format!("DB lock error: {}", e))),
    };

    match db::get_discord_thread_by_thread_id(&conn, thread_id) {
        Ok(Some(thread)) => {
            let data = json!({
                "taskId": thread.task_id,
                "threadId": thread.discord_thread_id,
                "channelId": thread.discord_channel_id,
            });
            (true, Some(data), None)
        }
        Ok(None) => (true, None, None), // Not found is OK, just return null
        Err(e) => (false, None, Some(format!("DB error: {}", e))),
    }
}

/// Get message route (agent session info) for a task
fn handle_get_message_route(
    state: &AppState,
    payload: &serde_json::Value,
) -> (bool, Option<serde_json::Value>, Option<String>) {
    let task_id = match payload.get("taskId").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => return (false, None, Some("Missing taskId".to_string())),
    };

    let conn = match state.db.lock() {
        Ok(c) => c,
        Err(e) => return (false, None, Some(format!("DB lock error: {}", e))),
    };

    match db::get_discord_agent_route(&conn, task_id) {
        Ok(Some(route)) => {
            let data = json!({
                "taskId": route.task_id,
                "activeSessionId": route.active_session_id,
                "cliSessionId": route.cli_session_id,
                "lastInteractionAt": route.last_interaction_at,
            });
            (true, Some(data), None)
        }
        Ok(None) => (true, None, None),
        Err(e) => (false, None, Some(format!("DB error: {}", e))),
    }
}

/// Check if a channel is a chef channel
fn handle_is_chef_channel(
    state: &AppState,
    payload: &serde_json::Value,
) -> (bool, Option<serde_json::Value>, Option<String>) {
    let channel_id = match payload.get("channelId").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => return (false, None, Some("Missing channelId".to_string())),
    };

    let conn = match state.db.lock() {
        Ok(c) => c,
        Err(e) => return (false, None, Some(format!("DB lock error: {}", e))),
    };

    match db::is_chef_channel(&conn, channel_id) {
        Ok(is_chef) => (true, Some(json!(is_chef)), None),
        Err(e) => (false, None, Some(format!("DB error: {}", e))),
    }
}

/// Get workspace by chef channel ID
fn handle_get_workspace_by_chef_channel(
    state: &AppState,
    payload: &serde_json::Value,
) -> (bool, Option<serde_json::Value>, Option<String>) {
    let channel_id = match payload.get("channelId").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => return (false, None, Some("Missing channelId".to_string())),
    };

    let conn = match state.db.lock() {
        Ok(c) => c,
        Err(e) => return (false, None, Some(format!("DB lock error: {}", e))),
    };

    match db::get_workspace_by_chef_channel(&conn, channel_id) {
        Ok(Some(workspace)) => {
            let data = json!({
                "id": workspace.id,
                "name": workspace.name,
            });
            (true, Some(data), None)
        }
        Ok(None) => (true, None, None),
        Err(e) => (false, None, Some(format!("DB error: {}", e))),
    }
}

/// Get thread mapping by task ID
fn handle_get_thread_mapping(
    state: &AppState,
    payload: &serde_json::Value,
) -> (bool, Option<serde_json::Value>, Option<String>) {
    let task_id = match payload.get("taskId").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => return (false, None, Some("Missing taskId".to_string())),
    };

    let conn = match state.db.lock() {
        Ok(c) => c,
        Err(e) => return (false, None, Some(format!("DB lock error: {}", e))),
    };

    match db::get_discord_thread_for_task(&conn, task_id) {
        Ok(Some(thread)) => {
            let data = json!({
                "threadId": thread.discord_thread_id,
            });
            (true, Some(data), None)
        }
        Ok(None) => (true, None, None),
        Err(e) => (false, None, Some(format!("DB error: {}", e))),
    }
}

// ─── Agent Commands ───────────────────────────────────────────────────────────

/// Default CLI path to use if none specified
const DEFAULT_CLI_PATH: &str = "claude";

/// Default model for agent sessions
const DEFAULT_MODEL: &str = "claude-sonnet-4-20250514";

/// System prompt for agent sessions
const AGENT_SYSTEM_PROMPT: &str = "You are an AI coding assistant helping with software development tasks. You can read and write files, run commands, and help debug issues.";

/// Send a message to an active agent session
async fn handle_agent_send_message(
    ctx: &CommandContext<'_>,
    payload: &serde_json::Value,
) -> (bool, Option<serde_json::Value>, Option<String>) {
    let task_id = match payload.get("taskId").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => return (false, None, Some("Missing taskId".to_string())),
    };

    let message = match payload.get("message").and_then(|v| v.as_str()) {
        Some(m) => m,
        None => return (false, None, Some("Missing message".to_string())),
    };

    // Get mutable lock on agent manager
    let mut manager = ctx.agent_cli_manager.lock().await;

    // Check if session exists
    if !manager.has_session(task_id) {
        return (false, None, Some(format!("No active session for task {}", task_id)));
    }

    // Check if busy
    if manager.is_busy(task_id) {
        return (false, None, Some("Agent is busy processing a previous message".to_string()));
    }

    // Send the message
    match manager.send_message(task_id, message, ctx.app).await {
        Ok((response, cli_session_id)) => {
            (true, Some(json!({
                "response": response,
                "cliSessionId": cli_session_id,
            })), None)
        }
        Err(e) => (false, None, Some(e)),
    }
}

/// Resume a completed agent session (spawn with --resume)
async fn handle_agent_resume(
    ctx: &CommandContext<'_>,
    payload: &serde_json::Value,
) -> (bool, Option<serde_json::Value>, Option<String>) {
    let task_id = match payload.get("taskId").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => return (false, None, Some("Missing taskId".to_string())),
    };

    let cli_session_id = match payload.get("cliSessionId").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => return (false, None, Some("Missing cliSessionId for resume".to_string())),
    };

    let initial_message = payload.get("initialMessage").and_then(|v| v.as_str());
    let working_dir = payload
        .get("workingDir")
        .and_then(|v| v.as_str())
        .unwrap_or(".");
    let cli_path = payload
        .get("cliPath")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_CLI_PATH);
    let model = payload
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_MODEL);

    let mut manager = ctx.agent_cli_manager.lock().await;

    // Spawn with resume
    if let Err(e) = manager
        .spawn(
            task_id,
            cli_path,
            working_dir,
            model,
            None,
            AGENT_SYSTEM_PROMPT,
            Some(cli_session_id),
        )
        .await
    {
        return (false, None, Some(e));
    }

    // If initial message provided, send it
    if let Some(msg) = initial_message {
        match manager.send_message(task_id, msg, ctx.app).await {
            Ok((response, new_session_id)) => {
                (true, Some(json!({
                    "success": true,
                    "response": response,
                    "cliSessionId": new_session_id,
                })), None)
            }
            Err(e) => (false, None, Some(e)),
        }
    } else {
        (true, Some(json!({"success": true, "cliSessionId": cli_session_id})), None)
    }
}

/// Start a new agent session for a task
async fn handle_agent_start(
    ctx: &CommandContext<'_>,
    payload: &serde_json::Value,
) -> (bool, Option<serde_json::Value>, Option<String>) {
    let task_id = match payload.get("taskId").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => return (false, None, Some("Missing taskId".to_string())),
    };

    let working_dir = match payload.get("workingDir").and_then(|v| v.as_str()) {
        Some(d) => d,
        None => return (false, None, Some("Missing workingDir".to_string())),
    };

    let initial_message = payload.get("initialMessage").and_then(|v| v.as_str());
    let cli_path = payload
        .get("cliPath")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_CLI_PATH);
    let model = payload
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_MODEL);

    let mut manager = ctx.agent_cli_manager.lock().await;

    // Check capacity
    if manager.is_at_capacity() && !manager.has_session(task_id) {
        return (false, None, Some("Maximum concurrent agents reached".to_string()));
    }

    // Spawn new session
    if let Err(e) = manager
        .spawn(
            task_id,
            cli_path,
            working_dir,
            model,
            None,
            AGENT_SYSTEM_PROMPT,
            None,
        )
        .await
    {
        return (false, None, Some(e));
    }

    // If initial message provided, send it
    if let Some(msg) = initial_message {
        match manager.send_message(task_id, msg, ctx.app).await {
            Ok((response, cli_session_id)) => {
                (true, Some(json!({
                    "success": true,
                    "response": response,
                    "cliSessionId": cli_session_id,
                })), None)
            }
            Err(e) => (false, None, Some(e)),
        }
    } else {
        (true, Some(json!({"success": true})), None)
    }
}

/// Handle a Chef message (natural language board management)
/// Routes to the orchestrator for LLM-powered task management
async fn handle_chef_message(
    ctx: &CommandContext<'_>,
    payload: &serde_json::Value,
) -> (bool, Option<serde_json::Value>, Option<String>) {
    let workspace_id = match payload.get("workspaceId").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => return (false, None, Some("Missing workspaceId".to_string())),
    };

    let message = match payload.get("message").and_then(|v| v.as_str()) {
        Some(m) => m,
        None => return (false, None, Some("Missing message".to_string())),
    };

    let user_name = payload
        .get("userName")
        .and_then(|v| v.as_str())
        .unwrap_or("Discord User");

    // Format message with user context
    let formatted_message = format!("[From Discord - {}]: {}", user_name, message);

    // Get workspace info to find the repo path
    let repo_path = {
        let conn = match ctx.state.db.lock() {
            Ok(c) => c,
            Err(e) => return (false, None, Some(format!("DB lock error: {}", e))),
        };

        match db::get_workspace(&conn, workspace_id) {
            Ok(workspace) => workspace.repo_path,
            Err(e) => return (false, None, Some(format!("DB error: {}", e))),
        }
    };

    // Use the agent CLI session for the workspace (keyed by workspace_id for Chef)
    let chef_task_id = format!("chef-{}", workspace_id);
    let mut manager = ctx.agent_cli_manager.lock().await;

    // If no session exists, spawn one
    if !manager.has_session(&chef_task_id) {
        let system_prompt = format!(
            "You are Chef, an AI assistant for managing a Kanban board. \
            You help users create tasks, move them between columns, and manage their workflow. \
            The current workspace is: {}. \
            When users ask to create tasks, add items, or manage their board, \
            use the available tools to fulfill their requests.",
            workspace_id
        );

        if let Err(e) = manager
            .spawn(
                &chef_task_id,
                DEFAULT_CLI_PATH,
                &repo_path,
                DEFAULT_MODEL,
                None,
                &system_prompt,
                None,
            )
            .await
        {
            return (false, None, Some(format!("Failed to start Chef: {}", e)));
        }
    }

    // Send the message
    match manager.send_message(&chef_task_id, &formatted_message, ctx.app).await {
        Ok((response, _)) => {
            (true, Some(json!({
                "message": response,
                "actions": [],
                "tasksCreated": [],
                "tasksMoved": [],
            })), None)
        }
        Err(e) => (false, None, Some(format!("Chef error: {}", e))),
    }
}
