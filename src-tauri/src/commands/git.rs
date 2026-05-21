use crate::db::{self, AppState};
use crate::git::{branch_manager, change_tracker, conflict_detector};
use git2::Repository;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use tauri::State;

fn canonical_git_dir(repo_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(repo_path.trim());
    if repo_path.trim().is_empty() {
        return Err("Repository path cannot be empty".to_string());
    }
    if !path.exists() {
        return Err(format!("Repository path does not exist: {}", repo_path));
    }
    if !path.is_dir() {
        return Err(format!("Repository path is not a directory: {}", repo_path));
    }
    Repository::discover(path).map_err(|_| {
        format!(
            "Repository path is not inside a git repository: {}",
            repo_path
        )
    })?;
    path.canonicalize()
        .map_err(|e| format!("Failed to canonicalize repository path: {}", e))
}

fn collect_allowed_repo_roots(conn: &Connection) -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();
    let workspaces = db::list_workspaces(conn).map_err(|e| e.to_string())?;
    for workspace in workspaces {
        if let Ok(path) = canonical_git_dir(&workspace.repo_path) {
            roots.push(path);
        }
        let tasks = db::list_tasks(conn, &workspace.id).map_err(|e| e.to_string())?;
        for task in tasks {
            if let Some(worktree_path) = task.worktree_path.as_deref() {
                if let Ok(path) = canonical_git_dir(worktree_path) {
                    roots.push(path);
                }
            }
        }
    }
    Ok(roots)
}

fn repo_path_is_allowed(candidate: &Path, allowed_roots: &[PathBuf]) -> bool {
    allowed_roots.iter().any(|root| candidate == root)
}

fn registered_repo_path(state: &State<'_, AppState>, repo_path: String) -> Result<String, String> {
    let candidate = canonical_git_dir(&repo_path)?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let allowed_roots = collect_allowed_repo_roots(&conn)?;
    if repo_path_is_allowed(&candidate, &allowed_roots) {
        return Ok(candidate.to_string_lossy().to_string());
    }

    Err(format!(
        "Repository path is not a registered workspace or task worktree: {}",
        repo_path
    ))
}

fn validated_git_repo_path(repo_path: String) -> Result<String, String> {
    canonical_git_dir(&repo_path).map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn create_task_branch(
    state: State<'_, AppState>,
    repo_path: String,
    task_slug: String,
    base_branch: Option<String>,
) -> Result<String, String> {
    let repo_path = registered_repo_path(&state, repo_path)?;
    tokio::task::spawn_blocking(move || {
        branch_manager::create_task_branch(&repo_path, &task_slug, base_branch.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn switch_branch(
    state: State<'_, AppState>,
    repo_path: String,
    branch: String,
) -> Result<(), String> {
    let repo_path = registered_repo_path(&state, repo_path)?;
    tokio::task::spawn_blocking(move || branch_manager::switch_branch(&repo_path, &branch))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_current_branch(repo_path: String) -> Result<String, String> {
    let repo_path = validated_git_repo_path(repo_path)?;
    tokio::task::spawn_blocking(move || branch_manager::get_current_branch(&repo_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_task_branches(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<branch_manager::BranchInfo>, String> {
    let repo_path = registered_repo_path(&state, repo_path)?;
    tokio::task::spawn_blocking(move || branch_manager::list_task_branches(&repo_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_task_branch(
    state: State<'_, AppState>,
    repo_path: String,
    branch: String,
) -> Result<bool, String> {
    let repo_path = registered_repo_path(&state, repo_path)?;
    tokio::task::spawn_blocking(move || branch_manager::delete_task_branch(&repo_path, &branch))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_changes(
    state: State<'_, AppState>,
    repo_path: String,
    branch: String,
    base_branch: Option<String>,
) -> Result<change_tracker::ChangeSummary, String> {
    let repo_path = registered_repo_path(&state, repo_path)?;
    tokio::task::spawn_blocking(move || {
        change_tracker::get_changes(&repo_path, &branch, base_branch.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_diff(
    state: State<'_, AppState>,
    repo_path: String,
    branch: String,
    base_branch: Option<String>,
    file_path: Option<String>,
) -> Result<String, String> {
    let repo_path = registered_repo_path(&state, repo_path)?;
    tokio::task::spawn_blocking(move || {
        change_tracker::get_diff(
            &repo_path,
            &branch,
            base_branch.as_deref(),
            file_path.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_commit_changes(
    state: State<'_, AppState>,
    repo_path: String,
    commit_hash: String,
) -> Result<change_tracker::ChangeSummary, String> {
    let repo_path = registered_repo_path(&state, repo_path)?;
    tokio::task::spawn_blocking(move || {
        change_tracker::get_commit_changes(&repo_path, &commit_hash)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_commit_diff(
    state: State<'_, AppState>,
    repo_path: String,
    commit_hash: String,
    file_path: Option<String>,
) -> Result<String, String> {
    let repo_path = registered_repo_path(&state, repo_path)?;
    tokio::task::spawn_blocking(move || {
        change_tracker::get_commit_diff_text(&repo_path, &commit_hash, file_path.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_conflict_matrix(
    state: State<'_, AppState>,
    repo_path: String,
    base_branch: Option<String>,
) -> Result<conflict_detector::ConflictMatrix, String> {
    let repo_path = registered_repo_path(&state, repo_path)?;
    tokio::task::spawn_blocking(move || {
        conflict_detector::get_conflict_matrix(&repo_path, base_branch.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_commits(
    state: State<'_, AppState>,
    repo_path: String,
    branch: String,
    base_branch: Option<String>,
) -> Result<Vec<change_tracker::CommitInfo>, String> {
    let repo_path = registered_repo_path(&state, repo_path)?;
    tokio::task::spawn_blocking(move || {
        change_tracker::get_commits(&repo_path, &branch, base_branch.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_commit_info(
    state: State<'_, AppState>,
    repo_path: String,
    commit_hash: String,
) -> Result<change_tracker::CommitInfo, String> {
    let repo_path = registered_repo_path(&state, repo_path)?;
    tokio::task::spawn_blocking(move || change_tracker::get_commit_info(&repo_path, &commit_hash))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::repo_path_is_allowed;
    use std::path::PathBuf;

    #[test]
    fn repo_path_is_allowed_requires_exact_registered_root() {
        let root = PathBuf::from("/tmp/workspace");
        let child = root.join("nested");

        assert!(repo_path_is_allowed(&root, std::slice::from_ref(&root)));
        assert!(!repo_path_is_allowed(&child, &[root]));
    }

    #[test]
    fn repo_path_is_allowed_accepts_registered_worktree_root() {
        let workspace = PathBuf::from("/tmp/workspace");
        let worktree = PathBuf::from("/tmp/workspace/.worktrees/task-1");

        assert!(repo_path_is_allowed(
            &worktree,
            &[workspace, worktree.clone()]
        ));
    }
}
