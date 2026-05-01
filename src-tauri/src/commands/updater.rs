use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::error::AppError;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub body: Option<String>,
    pub date: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn check_for_update(app: AppHandle) -> Result<Option<UpdateInfo>, AppError> {
    let updater = app
        .updater_builder()
        .build()
        .map_err(|e| AppError::CommandError(e.to_string()))?;

    let update = updater
        .check()
        .await
        .map_err(|e| AppError::CommandError(e.to_string()))?;

    Ok(update.map(|u| UpdateInfo {
        version: u.version,
        body: u.body,
        date: u.date.map(|d| d.to_string()),
    }))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn install_update(app: AppHandle) -> Result<(), AppError> {
    let updater = app
        .updater_builder()
        .build()
        .map_err(|e| AppError::CommandError(e.to_string()))?;

    let update = updater
        .check()
        .await
        .map_err(|e| AppError::CommandError(e.to_string()))?;

    let update = update
        .ok_or_else(|| AppError::CommandError("No update available".to_string()))?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| AppError::CommandError(e.to_string()))?;

    Ok(())
}
