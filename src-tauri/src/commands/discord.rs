//! Discord integration Tauri commands

use crate::db::AppState;
use crate::discord::bridge::{CreateThreadResult, SetupWorkspaceResult};
use crate::discord::{DiscordStatus, SharedDiscordBridge};
use crate::error::AppError;
use tauri::{AppHandle, Manager, State};

/// Spawn the Discord bot sidecar
#[tauri::command(rename_all = "camelCase")]
pub async fn spawn_discord_sidecar(
    app: AppHandle,
    discord: State<'_, SharedDiscordBridge>,
) -> Result<(), AppError> {
    // Get the sidecar path relative to the app
    let resource_path = app
        .path()
        .resource_dir()
        .map_err(|e| AppError::CommandError(format!("Failed to get resource dir: {}", e)))?;

    let sidecar_path = resource_path
        .join("sidecars")
        .join("discord-bot")
        .join("dist")
        .join("index.js");

    let sidecar_path_str = sidecar_path.to_string_lossy().to_string();

    let mut bridge = discord.lock().await;
    bridge
        .spawn(&sidecar_path_str, &app)
        .await
        .map_err(AppError::CommandError)?;

    Ok(())
}

/// Kill the Discord bot sidecar
#[tauri::command(rename_all = "camelCase")]
pub async fn kill_discord_sidecar(
    discord: State<'_, SharedDiscordBridge>,
) -> Result<(), AppError> {
    let mut bridge = discord.lock().await;
    bridge.kill().await;
    Ok(())
}

/// Connect to Discord with token
#[tauri::command(rename_all = "camelCase")]
pub async fn connect_discord(
    discord: State<'_, SharedDiscordBridge>,
    token: String,
    guild_id: Option<String>,
) -> Result<DiscordStatus, AppError> {
    let mut bridge = discord.lock().await;

    if !bridge.is_running() {
        return Err(AppError::InvalidInput(
            "Discord sidecar not running. Call spawn_discord_sidecar first.".to_string(),
        ));
    }

    bridge
        .connect(&token, guild_id.as_deref())
        .await
        .map_err(AppError::CommandError)
}

/// Disconnect from Discord
#[tauri::command(rename_all = "camelCase")]
pub async fn disconnect_discord(
    discord: State<'_, SharedDiscordBridge>,
) -> Result<(), AppError> {
    let mut bridge = discord.lock().await;
    bridge.disconnect().await.map_err(AppError::CommandError)
}

/// Get Discord connection status
#[tauri::command(rename_all = "camelCase")]
pub async fn get_discord_status(
    discord: State<'_, SharedDiscordBridge>,
) -> Result<DiscordStatus, AppError> {
    let mut bridge = discord.lock().await;

    if !bridge.is_running() {
        return Ok(DiscordStatus::default());
    }

    bridge.fetch_status().await.map_err(AppError::CommandError)
}

/// Test Discord connection (ping)
#[tauri::command(rename_all = "camelCase")]
pub async fn test_discord_connection(
    discord: State<'_, SharedDiscordBridge>,
) -> Result<serde_json::Value, AppError> {
    let mut bridge = discord.lock().await;

    if !bridge.is_running() {
        return Err(AppError::InvalidInput("Discord sidecar not running".to_string()));
    }

    bridge.ping().await.map_err(AppError::CommandError)
}

/// Setup Discord server structure for a workspace
#[tauri::command(rename_all = "camelCase")]
pub async fn setup_discord_workspace(
    state: State<'_, AppState>,
    discord: State<'_, SharedDiscordBridge>,
    workspace_id: String,
    guild_id: String,
) -> Result<SetupWorkspaceResult, AppError> {
    // Get workspace and columns (scoped to release lock before await)
    let (workspace_name, column_data) = {
        let conn = state.db.lock().unwrap();
        let workspace = crate::db::get_workspace(&conn, &workspace_id)?;
        let columns = crate::db::list_columns(&conn, &workspace_id)?;

        let col_data: Vec<(String, String, i32)> = columns
            .iter()
            .map(|c| (c.id.clone(), c.name.clone(), c.position as i32))
            .collect();

        (workspace.name, col_data)
    };

    let mut bridge = discord.lock().await;

    if !bridge.is_running() {
        return Err(AppError::InvalidInput("Discord sidecar not running".to_string()));
    }

    let result = bridge
        .setup_workspace(&guild_id, &workspace_name, column_data.clone())
        .await
        .map_err(AppError::CommandError)?;

    // Store mappings in database
    {
        let conn = state.db.lock().unwrap();

        // Update workspace with Discord settings
        crate::db::update_workspace_discord(
            &conn,
            &workspace_id,
            &guild_id,
            &result.category_id,
            &result.chef_channel_id,
            &result.notifications_channel_id,
        )?;

        // Store column → channel mappings
        for (column_id, _, _) in &column_data {
            if let Some(channel_id) = result.channel_map.get(column_id) {
                crate::db::insert_discord_column_channel(&conn, column_id, channel_id)?;
            }
        }
    }

    Ok(result)
}

/// Create a Discord thread for a task
#[tauri::command(rename_all = "camelCase")]
pub async fn create_discord_thread(
    state: State<'_, AppState>,
    discord: State<'_, SharedDiscordBridge>,
    channel_id: String,
    task_id: String,
    task_title: String,
) -> Result<CreateThreadResult, AppError> {
    let mut bridge = discord.lock().await;

    if !bridge.is_running() {
        return Err(AppError::InvalidInput("Discord sidecar not running".to_string()));
    }

    let result = bridge
        .create_thread(&channel_id, &task_id, &task_title)
        .await
        .map_err(AppError::CommandError)?;

    // Store mapping in database
    {
        let conn = state.db.lock().unwrap();
        crate::db::insert_discord_task_thread(
            &conn,
            &task_id,
            &result.thread_id,
            &channel_id,
        )?;
    }

    Ok(result)
}

/// Archive a Discord thread for a task
#[tauri::command(rename_all = "camelCase")]
pub async fn archive_discord_thread(
    state: State<'_, AppState>,
    discord: State<'_, SharedDiscordBridge>,
    task_id: String,
    reason: Option<String>,
) -> Result<bool, AppError> {
    // Get thread info from database
    let thread_id = {
        let conn = state.db.lock().unwrap();
        let thread = crate::db::get_discord_thread_for_task(&conn, &task_id)?;
        match thread {
            Some(t) => t.discord_thread_id,
            None => return Err(AppError::NotFound("No Discord thread for this task".to_string())),
        }
    };

    let mut bridge = discord.lock().await;

    if !bridge.is_running() {
        return Err(AppError::InvalidInput("Discord sidecar not running".to_string()));
    }

    bridge
        .archive_thread(&thread_id, reason.as_deref())
        .await
        .map_err(AppError::CommandError)?;

    // Update database
    {
        let conn = state.db.lock().unwrap();
        crate::db::update_discord_thread_archived(&conn, &task_id, true)?;
    }

    Ok(true)
}

/// Get Discord thread info for a task
#[tauri::command(rename_all = "camelCase")]
pub async fn get_discord_thread_for_task(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Option<crate::db::DiscordTaskThread>, AppError> {
    let conn = state.db.lock().unwrap();
    Ok(crate::db::get_discord_thread_for_task(&conn, &task_id)?)
}

/// Post a message to Discord
#[tauri::command(rename_all = "camelCase")]
pub async fn post_discord_message(
    discord: State<'_, SharedDiscordBridge>,
    channel_id: String,
    thread_id: Option<String>,
    content: Option<String>,
    embeds: Option<serde_json::Value>,
) -> Result<String, AppError> {
    let mut bridge = discord.lock().await;

    if !bridge.is_running() {
        return Err(AppError::InvalidInput("Discord sidecar not running".to_string()));
    }

    bridge
        .post_message(
            &channel_id,
            thread_id.as_deref(),
            content.as_deref(),
            embeds,
        )
        .await
        .map_err(AppError::CommandError)
}
