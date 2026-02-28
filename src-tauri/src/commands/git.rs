use crate::git::{branch_manager, change_tracker, conflict_detector};

#[tauri::command]
pub async fn create_task_branch(
    repo_path: String,
    task_slug: String,
    base_branch: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        branch_manager::create_task_branch(&repo_path, &task_slug, base_branch.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn switch_branch(repo_path: String, branch: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || branch_manager::switch_branch(&repo_path, &branch))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_current_branch(repo_path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || branch_manager::get_current_branch(&repo_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_task_branches(
    repo_path: String,
) -> Result<Vec<branch_manager::BranchInfo>, String> {
    tokio::task::spawn_blocking(move || branch_manager::list_task_branches(&repo_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_task_branch(repo_path: String, branch: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || branch_manager::delete_task_branch(&repo_path, &branch))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_changes(
    repo_path: String,
    branch: String,
) -> Result<change_tracker::ChangeSummary, String> {
    tokio::task::spawn_blocking(move || change_tracker::get_changes(&repo_path, &branch))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_diff(
    repo_path: String,
    branch: String,
    file_path: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        change_tracker::get_diff(&repo_path, &branch, file_path.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_conflict_matrix(
    repo_path: String,
) -> Result<conflict_detector::ConflictMatrix, String> {
    tokio::task::spawn_blocking(move || conflict_detector::get_conflict_matrix(&repo_path))
        .await
        .map_err(|e| e.to_string())?
}
