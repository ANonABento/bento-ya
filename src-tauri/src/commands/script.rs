use crate::db::{self, AppState, Script};
use crate::error::AppError;
use tauri::State;

#[tauri::command]
pub fn list_scripts(state: State<AppState>) -> Result<Vec<Script>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_scripts(&conn)?)
}

#[tauri::command]
pub fn get_script(state: State<AppState>, id: String) -> Result<Script, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::get_script(&conn, &id)?)
}

#[tauri::command]
pub fn create_script(
    state: State<AppState>,
    name: String,
    description: String,
    steps: String,
) -> Result<Script, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::InvalidInput("Script name cannot be empty".to_string()));
    }
    // Validate steps is valid JSON array
    let parsed: Result<Vec<serde_json::Value>, _> = serde_json::from_str(&steps);
    if parsed.is_err() {
        return Err(AppError::InvalidInput("Steps must be a valid JSON array".to_string()));
    }
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let id = db::new_id();
    Ok(db::insert_script(&conn, &id, name.trim(), &description, &steps, false)?)
}

#[tauri::command]
pub fn update_script(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    steps: Option<String>,
) -> Result<Script, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let existing = db::get_script(&conn, &id)?;
    if existing.is_built_in {
        return Err(AppError::InvalidInput("Cannot modify built-in scripts".to_string()));
    }
    if let Some(ref s) = steps {
        let parsed: Result<Vec<serde_json::Value>, _> = serde_json::from_str(s);
        if parsed.is_err() {
            return Err(AppError::InvalidInput("Steps must be a valid JSON array".to_string()));
        }
    }
    Ok(db::update_script(
        &conn,
        &id,
        name.as_deref(),
        description.as_deref(),
        steps.as_deref(),
    )?)
}

#[tauri::command]
pub fn delete_script(state: State<AppState>, id: String) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let existing = db::get_script(&conn, &id)?;
    if existing.is_built_in {
        return Err(AppError::InvalidInput("Cannot delete built-in scripts".to_string()));
    }
    Ok(db::delete_script(&conn, &id)?)
}
