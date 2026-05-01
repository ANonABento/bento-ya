use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

const WINDOW_ZOOM_FILENAME: &str = ".window-zoom.json";
const MIN_ZOOM: f64 = 0.5;
const MAX_ZOOM: f64 = 2.0;

#[derive(Debug, Serialize, Deserialize)]
struct WindowZoomState {
    zoom: f64,
}

fn normalize_zoom(zoom: f64) -> Result<f64, AppError> {
    if !zoom.is_finite() {
        return Err(AppError::InvalidInput(
            "Window zoom must be a finite number".to_string(),
        ));
    }

    let clamped = zoom.clamp(MIN_ZOOM, MAX_ZOOM);
    Ok((clamped * 100.0).round() / 100.0)
}

fn zoom_state_path(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(WINDOW_ZOOM_FILENAME))
        .map_err(|err| AppError::CommandError(format!("Failed to resolve app config dir: {err}")))
}

fn read_window_zoom_from_path(path: PathBuf) -> Result<Option<f64>, AppError> {
    if !path.exists() {
        return Ok(None);
    }

    let raw = std::fs::read_to_string(&path).map_err(|err| {
        AppError::CommandError(format!("Failed to read window zoom state: {err}"))
    })?;
    let state: WindowZoomState = serde_json::from_str(&raw).map_err(|err| {
        AppError::CommandError(format!("Failed to parse window zoom state: {err}"))
    })?;

    normalize_zoom(state.zoom).map(Some)
}

fn write_window_zoom_to_path(path: PathBuf, zoom: f64) -> Result<f64, AppError> {
    let normalized = normalize_zoom(zoom)?;
    let parent = path.parent().ok_or_else(|| {
        AppError::CommandError("Window zoom state path has no parent directory".to_string())
    })?;

    std::fs::create_dir_all(parent)
        .map_err(|err| AppError::CommandError(format!("Failed to create app config dir: {err}")))?;

    let state = WindowZoomState { zoom: normalized };
    let raw = serde_json::to_vec_pretty(&state).map_err(|err| {
        AppError::CommandError(format!("Failed to serialize window zoom state: {err}"))
    })?;

    std::fs::write(path, raw).map_err(|err| {
        AppError::CommandError(format!("Failed to write window zoom state: {err}"))
    })?;

    Ok(normalized)
}

#[tauri::command]
pub fn get_window_zoom(app: tauri::AppHandle) -> Result<Option<f64>, AppError> {
    read_window_zoom_from_path(zoom_state_path(&app)?)
}

#[tauri::command]
pub fn set_window_zoom(app: tauri::AppHandle, zoom: f64) -> Result<f64, AppError> {
    write_window_zoom_to_path(zoom_state_path(&app)?, zoom)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_zoom_path(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "bento-ya-window-zoom-{name}-{}-{}.json",
            std::process::id(),
            std::thread::current().name().unwrap_or("test")
        ));
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn writes_and_reads_normalized_zoom() {
        let path = temp_zoom_path("roundtrip");

        let written = write_window_zoom_to_path(path.clone(), 1.234).unwrap();
        let read = read_window_zoom_from_path(path.clone()).unwrap();

        assert_eq!(written, 1.23);
        assert_eq!(read, Some(1.23));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn clamps_zoom_to_supported_bounds() {
        let path = temp_zoom_path("clamp");

        assert_eq!(write_window_zoom_to_path(path.clone(), 10.0).unwrap(), 2.0);
        assert_eq!(read_window_zoom_from_path(path.clone()).unwrap(), Some(2.0));

        assert_eq!(write_window_zoom_to_path(path.clone(), 0.1).unwrap(), 0.5);
        assert_eq!(read_window_zoom_from_path(path.clone()).unwrap(), Some(0.5));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn returns_none_when_zoom_state_does_not_exist() {
        let path = temp_zoom_path("missing");

        assert_eq!(read_window_zoom_from_path(path).unwrap(), None);
    }

    #[test]
    fn rejects_non_finite_zoom() {
        let path = temp_zoom_path("non-finite");

        assert!(write_window_zoom_to_path(path, f64::NAN).is_err());
    }
}
