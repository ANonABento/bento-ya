use crate::db::{self, AppState, Column, Workspace};
use crate::error::AppError;
use tauri::State;

const DEFAULT_COLUMNS: &[&str] = &["Backlog", "Working", "Review", "Done"];

#[tauri::command]
pub fn create_workspace(
    state: State<AppState>,
    name: String,
    repo_path: String,
) -> Result<Workspace, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::InvalidInput("Workspace name cannot be empty".to_string()));
    }
    if repo_path.trim().is_empty() {
        return Err(AppError::InvalidInput("Repository path cannot be empty".to_string()));
    }

    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let tx = conn.unchecked_transaction().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let ws = db::insert_workspace(&conn, name.trim(), repo_path.trim())?;

    // Auto-create default columns
    for (i, col_name) in DEFAULT_COLUMNS.iter().enumerate() {
        db::insert_column(&conn, &ws.id, col_name, i as i64)?;
    }

    tx.commit().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(ws)
}

#[tauri::command]
pub fn get_workspace(state: State<AppState>, id: String) -> Result<Workspace, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::get_workspace(&conn, &id)?)
}

#[tauri::command]
pub fn list_workspaces(state: State<AppState>) -> Result<Vec<Workspace>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_workspaces(&conn)?)
}

#[tauri::command]
pub fn update_workspace(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    repo_path: Option<String>,
    tab_order: Option<i64>,
    is_active: Option<bool>,
    config: Option<String>,
) -> Result<Workspace, AppError> {
    if let Some(ref n) = name {
        if n.trim().is_empty() {
            return Err(AppError::InvalidInput("Workspace name cannot be empty".to_string()));
        }
    }

    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::update_workspace(
        &conn,
        &id,
        name.as_deref(),
        repo_path.as_deref(),
        tab_order,
        is_active,
        config.as_deref(),
    )?)
}

#[tauri::command]
pub fn delete_workspace(state: State<AppState>, id: String) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    // CASCADE handles associated columns/tasks
    db::delete_workspace(&conn, &id)?;
    Ok(())
}

/// List columns for a workspace (used internally, also exposed as command).
pub fn get_default_columns(
    state: &State<AppState>,
    workspace_id: &str,
) -> Result<Vec<Column>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_columns(&conn, workspace_id)?)
}

/// Clone an existing workspace with all its columns and tasks
#[tauri::command]
pub fn clone_workspace(
    state: State<AppState>,
    source_id: String,
    new_name: String,
) -> Result<Workspace, AppError> {
    if new_name.trim().is_empty() {
        return Err(AppError::InvalidInput("New workspace name cannot be empty".to_string()));
    }

    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let tx = conn.unchecked_transaction().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Get source workspace
    let source = db::get_workspace(&conn, &source_id)?;

    // Create new workspace with same repo path
    let new_ws = db::insert_workspace(&conn, new_name.trim(), &source.repo_path)?;

    // Copy columns
    let columns = db::list_columns(&conn, &source_id)?;
    let mut column_id_map = std::collections::HashMap::new();

    for col in &columns {
        let new_col = db::insert_column(&conn, &new_ws.id, &col.name, col.position)?;
        // Update the column with all properties
        db::update_column(
            &conn,
            &new_col.id,
            Some(&col.name),
            Some(&col.icon),
            Some(col.position),
            Some(col.color.as_deref()),
            Some(col.visible),
            Some(&col.trigger_config),
            Some(&col.exit_config),
            Some(col.auto_advance),
        )?;
        column_id_map.insert(col.id.clone(), new_col.id);
    }

    // Copy tasks
    for col in &columns {
        let tasks = db::list_tasks_by_column(&conn, &col.id)?;
        let new_col_id = column_id_map.get(&col.id).unwrap();

        for task in tasks {
            let new_task = db::insert_task(
                &conn,
                &new_ws.id,
                new_col_id,
                &task.title,
                task.description.as_deref(),
            )?;
            // Update task position and priority
            db::update_task(
                &conn,
                &new_task.id,
                Some(&task.title),
                Some(task.description.as_deref()),
                None, // column_id stays the same
                Some(task.position),
                Some(task.agent_mode.as_deref()),
                Some(&task.priority),
            )?;
        }
    }

    tx.commit().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(new_ws)
}

/// Reorder workspaces by updating their tab_order
#[tauri::command]
pub fn reorder_workspaces(state: State<AppState>, ids: Vec<String>) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let tx = conn.unchecked_transaction().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    for (i, id) in ids.iter().enumerate() {
        db::update_workspace(&conn, id, None, None, Some(i as i64), None, None)?;
    }

    tx.commit().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

/// Seed demo workspace with sample tasks for testing
#[tauri::command]
pub fn seed_demo_data(state: State<AppState>, repo_path: String) -> Result<Workspace, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let tx = conn.unchecked_transaction().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Create demo workspace
    let ws = db::insert_workspace(&conn, "Demo Workspace", &repo_path)?;

    // Create default columns
    let mut columns = Vec::new();
    for (i, col_name) in DEFAULT_COLUMNS.iter().enumerate() {
        let col = db::insert_column(&conn, &ws.id, col_name, i as i64)?;
        columns.push(col);
    }

    // Sample tasks for Backlog
    let backlog_id = &columns[0].id;
    db::insert_task(&conn, &ws.id, backlog_id, "Add dark mode toggle", Some("Implement theme switching in settings"))?;
    db::insert_task(&conn, &ws.id, backlog_id, "Refactor auth flow", Some("Simplify the authentication logic"))?;

    // Task with draft PR
    let draft_task = db::insert_task(&conn, &ws.id, backlog_id, "Write unit tests", Some("Add tests for core utilities - WIP draft PR"))?;
    db::update_task_branch(&conn, &draft_task.id, Some("feat/unit-tests"))?;
    db::update_task_pr_info(&conn, &draft_task.id, Some(101), Some("https://github.com/demo/repo/pull/101"))?;
    db::update_task_pr_status(&conn, &draft_task.id, Some("unknown"), Some("pending"), None, Some(0), Some(true), Some("[]"), Some("abc123"))?;

    // Sample tasks for Working - with CI failure and merge conflict
    let working_id = &columns[1].id;
    let ci_fail_task = db::insert_task(&conn, &ws.id, working_id, "Implement CLI agent spawning", Some("Wire up settings to spawn correct CLI - CI failing"))?;
    db::update_task_branch(&conn, &ci_fail_task.id, Some("feat/cli-agent"))?;
    db::update_task_pr_info(&conn, &ci_fail_task.id, Some(102), Some("https://github.com/demo/repo/pull/102"))?;
    db::update_task_pr_status(&conn, &ci_fail_task.id, Some("conflicted"), Some("failure"), Some("changes_requested"), Some(5), Some(false), Some("[\"bug\",\"needs-work\"]"), Some("def456"))?;

    let working_task = db::insert_task(&conn, &ws.id, working_id, "Fix terminal scrolling", Some("Terminal output should auto-scroll"))?;
    db::update_task_branch(&conn, &working_task.id, Some("fix/terminal-scroll"))?;

    // Sample tasks for Review - with approved PR
    let review_id = &columns[2].id;
    let approved_task = db::insert_task(&conn, &ws.id, review_id, "PR: Add keyboard shortcuts", Some("Review PR #12 for hotkey support - ready to merge!"))?;
    db::update_task_branch(&conn, &approved_task.id, Some("feat/keyboard-shortcuts"))?;
    db::update_task_pr_info(&conn, &approved_task.id, Some(103), Some("https://github.com/demo/repo/pull/103"))?;
    db::update_task_pr_status(&conn, &approved_task.id, Some("mergeable"), Some("success"), Some("approved"), Some(3), Some(false), Some("[\"enhancement\",\"ready\"]"), Some("ghi789"))?;

    // Sample tasks for Done
    let done_id = &columns[3].id;
    let done_task1 = db::insert_task(&conn, &ws.id, done_id, "Setup project structure", Some("Initial Tauri + React setup complete"))?;
    db::update_task_branch(&conn, &done_task1.id, Some("feat/initial-setup"))?;
    db::update_task_pr_info(&conn, &done_task1.id, Some(99), Some("https://github.com/demo/repo/pull/99"))?;
    db::update_task_pr_status(&conn, &done_task1.id, Some("mergeable"), Some("success"), Some("approved"), Some(2), Some(false), Some("[\"merged\"]"), Some("xyz000"))?;

    db::insert_task(&conn, &ws.id, done_id, "Design settings UI", Some("Settings panel with tabs working"))?;

    tx.commit().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(ws)
}
