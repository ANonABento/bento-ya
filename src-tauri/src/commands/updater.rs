use serde::Serialize;
use tauri::{utils::config::Updater, AppHandle};
use tauri_plugin_updater::UpdaterExt;

use crate::error::AppError;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub body: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub configured: bool,
    pub reason: Option<String>,
    pub endpoint_count: usize,
    pub artifacts_enabled: bool,
}

fn update_status_from_parts(
    has_pubkey: bool,
    endpoint_count: usize,
    artifacts_enabled: bool,
) -> UpdateStatus {
    let reason = if !has_pubkey {
        Some("Application updates are not configured for this build: missing updater public key.")
    } else if endpoint_count == 0 {
        Some("Application updates are not configured for this build: no update endpoint is set.")
    } else if !artifacts_enabled {
        Some("Application updates are disabled for this build because updater artifacts were not generated.")
    } else {
        None
    };

    UpdateStatus {
        configured: reason.is_none(),
        reason: reason.map(str::to_string),
        endpoint_count,
        artifacts_enabled,
    }
}

fn update_status(app: &AppHandle) -> UpdateStatus {
    let config = app.config();
    let updater_config = config.plugins.0.get("updater");
    let pubkey = updater_config
        .and_then(|value| value.get("pubkey"))
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim();
    let endpoint_count = updater_config
        .and_then(|value| value.get("endpoints"))
        .and_then(|value| value.as_array())
        .map(|endpoints| {
            endpoints
                .iter()
                .filter(|value| value.as_str().is_some())
                .count()
        })
        .unwrap_or(0);
    let artifacts_enabled = matches!(config.bundle.create_updater_artifacts, Updater::Bool(true));

    update_status_from_parts(!pubkey.is_empty(), endpoint_count, artifacts_enabled)
}

fn require_updates_configured(app: &AppHandle) -> Result<(), AppError> {
    let status = update_status(app);
    if status.configured {
        Ok(())
    } else {
        Err(AppError::CommandError(status.reason.unwrap_or_else(|| {
            "Application updates are not configured for this build.".to_string()
        })))
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_update_status(app: AppHandle) -> UpdateStatus {
    update_status(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn check_for_update(app: AppHandle) -> Result<Option<UpdateInfo>, AppError> {
    require_updates_configured(&app)?;
    let updater = app.updater_builder().build()?;
    let update = updater.check().await?;

    Ok(update.map(|u| UpdateInfo {
        version: u.version,
        body: u.body,
        date: u.date.map(|d| d.to_string()),
    }))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn install_update(app: AppHandle) -> Result<(), AppError> {
    require_updates_configured(&app)?;
    let updater = app.updater_builder().build()?;
    let update = updater.check().await?;
    let update = update.ok_or_else(|| AppError::CommandError("No update available".to_string()))?;

    update.download_and_install(|_, _| {}, || {}).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_status_explains_missing_pubkey_first() {
        let status = update_status_from_parts(false, 1, true);

        assert!(!status.configured);
        assert_eq!(status.endpoint_count, 1);
        assert!(status.artifacts_enabled);
        assert!(status.reason.unwrap().contains("public key"));
    }

    #[test]
    fn update_status_explains_disabled_artifacts() {
        let status = update_status_from_parts(true, 1, false);

        assert!(!status.configured);
        assert!(status.reason.unwrap().contains("artifacts"));
    }

    #[test]
    fn update_status_is_configured_when_all_parts_exist() {
        let status = update_status_from_parts(true, 1, true);

        assert!(status.configured);
        assert!(status.reason.is_none());
    }
}
