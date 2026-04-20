use crate::chat::registry::SharedSessionRegistry;

/// Write input data to a PTY session via the SessionRegistry.
#[tauri::command(rename_all = "camelCase")]
pub async fn write_to_pty(
    task_id: String,
    data: String,
    session_registry: tauri::State<'_, SharedSessionRegistry>,
) -> Result<(), String> {
    let mut registry = session_registry.lock().await;
    let session = registry
        .get_mut(&task_id)
        .ok_or_else(|| format!("No session for task: {}", task_id))?;
    session.write_pty(data.as_bytes())
}

/// Resize a PTY session via the SessionRegistry.
#[tauri::command(rename_all = "camelCase")]
pub async fn resize_pty(
    task_id: String,
    cols: u16,
    rows: u16,
    session_registry: tauri::State<'_, SharedSessionRegistry>,
) -> Result<(), String> {
    let mut registry = session_registry.lock().await;
    let session = registry
        .get_mut(&task_id)
        .ok_or_else(|| format!("No session for task: {}", task_id))?;
    session.resize_pty(cols, rows)
}

/// Get PTY scrollback is no longer supported via the legacy PtyManager.
/// Terminal view now uses the xterm.js scrollback buffer directly.
#[tauri::command(rename_all = "camelCase")]
pub async fn get_pty_scrollback(
    _task_id: String,
) -> Result<String, String> {
    // Scrollback is now handled client-side by xterm.js (10k lines buffer).
    // This command is kept for backward compatibility but returns empty.
    Ok(String::new())
}
