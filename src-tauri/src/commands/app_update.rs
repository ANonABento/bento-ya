#[cfg(desktop)]
use serde::Serialize;
#[cfg(desktop)]
use tauri::{AppHandle, State};
#[cfg(desktop)]
use tauri_plugin_updater::{Update, UpdaterExt};

#[cfg(desktop)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateMetadata {
    pub version: String,
    pub current_version: String,
    pub body: Option<String>,
    pub date: Option<String>,
}

#[cfg(desktop)]
pub struct PendingUpdate(pub std::sync::Mutex<Option<Update>>);

#[cfg(desktop)]
#[tauri::command]
pub async fn check_app_update(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<Option<AppUpdateMetadata>, String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;

    let metadata = update.as_ref().map(|pending| AppUpdateMetadata {
        version: pending.version.clone(),
        current_version: pending.current_version.clone(),
        body: pending.body.clone(),
        date: pending.date.map(|date| date.to_string()),
    });

    *pending_update
        .0
        .lock()
        .map_err(|_| "Failed to access update cache".to_string())? = update;

    Ok(metadata)
}

#[cfg(desktop)]
#[tauri::command]
pub async fn install_app_update(pending_update: State<'_, PendingUpdate>) -> Result<(), String> {
    let update = {
        let mut pending = pending_update
            .0
            .lock()
            .map_err(|_| "Failed to access update cache".to_string())?;

        pending
            .take()
            .ok_or_else(|| "No pending app update".to_string())?
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
