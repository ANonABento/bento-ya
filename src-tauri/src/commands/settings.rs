//! Tauri commands bridging the frontend to the global `AppSettings`
//! (`~/.kaitencode/settings.json`). These mirror the HTTP `/api/settings`
//! handlers in `api.rs` so the in-app UI and external MCP/API clients share
//! one source of truth — load → merge_update → save against the cached struct.

use crate::config::AppSettings;
use crate::error::AppError;

/// Read the full global settings blob (snake_case keys, matching the on-disk
/// JSON and the HTTP API). Cheap — served from the in-memory cache.
#[tauri::command]
pub fn get_app_settings() -> Result<serde_json::Value, AppError> {
    serde_json::to_value(AppSettings::load())
        .map_err(|e| AppError::CommandError(e.to_string()))
}

/// Merge a partial update (only provided keys change) and persist it. Returns
/// the full, updated settings so the caller can refresh its local copy.
#[tauri::command(rename_all = "camelCase")]
pub fn update_app_settings(updates: serde_json::Value) -> Result<serde_json::Value, AppError> {
    let mut settings = AppSettings::load();
    settings.merge_update(&updates);
    settings.save().map_err(AppError::CommandError)?;
    serde_json::to_value(&settings).map_err(|e| AppError::CommandError(e.to_string()))
}
