use std::process::Command;

use crate::chat::registry::SharedSessionRegistry;
use crate::chat::tmux_transport;

/// Write input data to a PTY session.
///
/// First tries the registry (chat sessions own their TmuxTransport with an
/// open PTY fd, which is the fastest path). Falls back to `tmux send-keys` so
/// pipeline triggers — which run in tmux without a registry-owned attach —
/// also receive user input.
#[tauri::command(rename_all = "camelCase")]
pub async fn write_to_pty(
    task_id: String,
    data: String,
    session_registry: tauri::State<'_, SharedSessionRegistry>,
) -> Result<(), String> {
    {
        let mut registry = session_registry.lock().await;
        if let Some(session) = registry.get_mut(&task_id) {
            return session.write_pty(data.as_bytes());
        }
    }

    // Fallback: send to the bare tmux session if it exists.
    if tmux_transport::has_session(&task_id) {
        let session = tmux_transport::session_name(&task_id);
        let output = Command::new("tmux")
            .args(["send-keys", "-t", &session, "-l", &data])
            .output()
            .map_err(|e| format!("Failed to send to tmux: {}", e))?;
        if !output.status.success() {
            return Err(format!(
                "tmux send-keys failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        return Ok(());
    }

    Err(format!("No session for task: {}", task_id))
}

/// Resize a PTY session.
///
/// Same fallback strategy as `write_to_pty`: registry first, then a direct
/// `tmux resize-window` if a bare pipeline session is the only thing alive.
#[tauri::command(rename_all = "camelCase")]
pub async fn resize_pty(
    task_id: String,
    cols: u16,
    rows: u16,
    session_registry: tauri::State<'_, SharedSessionRegistry>,
) -> Result<(), String> {
    {
        let mut registry = session_registry.lock().await;
        if let Some(session) = registry.get_mut(&task_id) {
            return session.resize_pty(cols, rows);
        }
    }

    if tmux_transport::has_session(&task_id) {
        let session = tmux_transport::session_name(&task_id);
        let output = Command::new("tmux")
            .args([
                "resize-window",
                "-t",
                &session,
                "-x",
                &cols.to_string(),
                "-y",
                &rows.to_string(),
            ])
            .output()
            .map_err(|e| format!("Failed to resize tmux: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // "no server" / "session not found" are not errors here.
            if !stderr.contains("no server") && !stderr.contains("not found") {
                return Err(format!("tmux resize-window failed: {}", stderr.trim()));
            }
        }
        return Ok(());
    }

    Err(format!("No session for task: {}", task_id))
}

/// Send Ctrl+C (SIGINT) to a task's tmux pane. This is the "Stop agent"
/// button in the terminal panel: it interrupts the running CLI without
/// killing the tmux session, so the user can read the final output.
#[tauri::command(rename_all = "camelCase")]
pub async fn signal_pty_interrupt(task_id: String) -> Result<(), String> {
    if !tmux_transport::has_session(&task_id) {
        return Err(format!("No tmux session for task: {}", task_id));
    }
    tmux_transport::cancel_agent(&task_id);
    Ok(())
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
