use std::sync::{Arc, Mutex};

use tauri::State;

use crate::process::pty_manager::PtyManager;

#[tauri::command]
pub fn write_to_pty(
    task_id: String,
    data: String,
    pty_manager: State<'_, Arc<Mutex<PtyManager>>>,
) -> Result<(), String> {
    let mut mgr = pty_manager
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    mgr.write(&task_id, data.as_bytes())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resize_pty(
    task_id: String,
    cols: u16,
    rows: u16,
    pty_manager: State<'_, Arc<Mutex<PtyManager>>>,
) -> Result<(), String> {
    let mgr = pty_manager
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    mgr.resize(&task_id, cols, rows)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_pty_scrollback(
    task_id: String,
    pty_manager: State<'_, Arc<Mutex<PtyManager>>>,
) -> Result<String, String> {
    let mgr = pty_manager
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    mgr.get_scrollback(&task_id).map_err(|e| e.to_string())
}
