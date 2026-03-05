//! Handlers for incoming commands from the Discord sidecar
//!
//! The sidecar sends commands like `db:get_thread_by_discord_id` and expects
//! responses back from Rust.

use crate::db::{self, AppState};
use serde_json::json;

/// Handle an incoming command from the sidecar
/// Returns (success, data, error)
pub fn handle_command(
    state: &AppState,
    cmd_type: &str,
    payload: &serde_json::Value,
) -> (bool, Option<serde_json::Value>, Option<String>) {
    match cmd_type {
        // Database queries
        "db:get_thread_by_discord_id" => handle_get_thread_by_discord_id(state, payload),
        "db:get_message_route" => handle_get_message_route(state, payload),
        "db:is_chef_channel" => handle_is_chef_channel(state, payload),
        "db:get_workspace_by_chef_channel" => handle_get_workspace_by_chef_channel(state, payload),
        "db:get_thread_mapping" => handle_get_thread_mapping(state, payload),

        // Agent commands - these need special handling
        "agent:send_message" => handle_agent_send_message(payload),
        "agent:resume" => handle_agent_resume(payload),
        "agent:start" => handle_agent_start(payload),

        // Chef orchestrator
        "chef:message" => handle_chef_message(payload),

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

// ─── Agent Commands (Stubs - need agent integration) ─────────────────────────

/// Send a message to an active agent session
fn handle_agent_send_message(
    payload: &serde_json::Value,
) -> (bool, Option<serde_json::Value>, Option<String>) {
    let _session_id = payload.get("sessionId").and_then(|v| v.as_str());
    let _message = payload.get("message").and_then(|v| v.as_str());

    // TODO: Integrate with agent session manager to forward message
    // For now, return success as a stub
    (true, Some(json!({"queued": true})), None)
}

/// Resume a completed agent session
fn handle_agent_resume(
    payload: &serde_json::Value,
) -> (bool, Option<serde_json::Value>, Option<String>) {
    let _task_id = payload.get("taskId").and_then(|v| v.as_str());
    let _cli_session_id = payload.get("cliSessionId").and_then(|v| v.as_str());
    let _initial_message = payload.get("initialMessage").and_then(|v| v.as_str());

    // TODO: Spawn agent with --resume flag
    // For now, return success as a stub
    (true, Some(json!({"success": true})), None)
}

/// Start a new agent session for a task
fn handle_agent_start(
    payload: &serde_json::Value,
) -> (bool, Option<serde_json::Value>, Option<String>) {
    let _task_id = payload.get("taskId").and_then(|v| v.as_str());
    let _initial_message = payload.get("initialMessage").and_then(|v| v.as_str());

    // TODO: Spawn new agent for task
    // For now, return success as a stub
    (true, Some(json!({"success": true})), None)
}

/// Handle a Chef message (natural language board management)
fn handle_chef_message(
    payload: &serde_json::Value,
) -> (bool, Option<serde_json::Value>, Option<String>) {
    let _workspace_id = payload.get("workspaceId").and_then(|v| v.as_str());
    let _user_id = payload.get("userId").and_then(|v| v.as_str());
    let _user_name = payload.get("userName").and_then(|v| v.as_str());
    let _message = payload.get("message").and_then(|v| v.as_str());

    // TODO: Route to Chef orchestrator (LLM-powered board management)
    // For now, return a placeholder response
    (true, Some(json!({
        "message": "Chef integration coming soon! For now, use the Kanban board directly.",
        "actions": [],
        "tasksCreated": [],
        "tasksMoved": [],
    })), None)
}
