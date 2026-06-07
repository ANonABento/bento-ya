//! Tauri commands for the Discord MVP. Persist the Discord config in
//! `AppSettings` and reconcile the single managed sidecar bridge (start +
//! connect when enabled with a token, stop otherwise). See
//! `.tickets/discord/MVP-PLAN.md`.

use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::config::AppSettings;
use crate::discord::{DiscordBridge, SharedDiscord};
use crate::error::AppError;

/// Current Discord config for the settings UI. Never returns the raw token.
#[tauri::command]
pub fn discord_get_config() -> Result<Value, AppError> {
    let s = AppSettings::load();
    Ok(json!({
        "enabled": s.discord_enabled,
        "hasToken": !s.discord_bot_token.trim().is_empty(),
        "threadChannelId": s.discord_thread_channel_id,
    }))
}

/// Whether the managed bridge is currently running.
#[tauri::command]
pub async fn discord_status(state: State<'_, SharedDiscord>) -> Result<Value, AppError> {
    let running = state.lock().await.is_some();
    let s = AppSettings::load();
    Ok(json!({ "running": running, "enabled": s.discord_enabled }))
}

/// Spawn a throwaway sidecar, connect with `token`, return the bot tag, then
/// tear it down. Does not touch the managed bridge — purely a "test" probe.
#[tauri::command(rename_all = "camelCase")]
pub async fn discord_test_connection(app: AppHandle, token: String) -> Result<Value, AppError> {
    if token.trim().is_empty() {
        return Err(AppError::InvalidInput("missing bot token".into()));
    }
    let mut bridge = DiscordBridge::spawn(&app).map_err(AppError::CommandError)?;
    let result = bridge.send_command("connect", json!({ "token": token })).await;
    bridge.shutdown();
    match result {
        Ok(data) => Ok(json!({ "tag": data.get("tag").and_then(Value::as_str) })),
        Err(e) => Err(AppError::CommandError(format!("connection failed: {e}"))),
    }
}

/// Persist Discord config and reconcile the managed bridge to match it.
#[tauri::command(rename_all = "camelCase")]
pub async fn discord_save_config(
    app: AppHandle,
    state: State<'_, SharedDiscord>,
    enabled: bool,
    token: Option<String>,
    thread_channel_id: Option<String>,
) -> Result<Value, AppError> {
    let mut settings = AppSettings::load();
    settings.discord_enabled = enabled;
    if let Some(t) = token {
        if !t.trim().is_empty() {
            settings.discord_bot_token = t.trim().to_string();
        }
    }
    if let Some(c) = thread_channel_id {
        settings.discord_thread_channel_id = c.trim().to_string();
    }
    settings.save().map_err(AppError::CommandError)?;

    reconcile_bridge(&app, &state, &settings).await?;

    Ok(json!({
        "enabled": settings.discord_enabled,
        "hasToken": !settings.discord_bot_token.trim().is_empty(),
        "threadChannelId": settings.discord_thread_channel_id,
        "running": state.lock().await.is_some(),
    }))
}

/// Start+connect or stop the managed bridge so it matches `settings`. Also used
/// at startup. Idempotent: a no-op when already in the desired state.
pub async fn reconcile_bridge(
    app: &AppHandle,
    state: &SharedDiscord,
    settings: &AppSettings,
) -> Result<(), AppError> {
    let mut guard = state.lock().await;
    let should_run = settings.discord_enabled && !settings.discord_bot_token.trim().is_empty();
    if should_run {
        if guard.is_none() {
            let bridge = DiscordBridge::spawn(app).map_err(AppError::CommandError)?;
            bridge
                .send_command("connect", json!({ "token": settings.discord_bot_token }))
                .await
                .map_err(|e| AppError::CommandError(format!("discord connect failed: {e}")))?;
            *guard = Some(bridge);
        }
    } else if let Some(mut bridge) = guard.take() {
        bridge.shutdown();
    }
    Ok(())
}
