use crate::db::{self, AppState, Task};
use crate::error::AppError;
use crate::pipeline;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn create_task(
    app: AppHandle,
    state: State<AppState>,
    workspace_id: String,
    column_id: String,
    title: String,
    description: Option<String>,
) -> Result<Task, AppError> {
    if title.trim().is_empty() {
        return Err(AppError::InvalidInput("Task title cannot be empty".to_string()));
    }

    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let task = db::insert_task(
        &conn,
        &workspace_id,
        &column_id,
        title.trim(),
        description.as_deref(),
    )?;

    // Fire column trigger for the initial column
    let column = db::get_column(&conn, &column_id)?;
    let task = pipeline::fire_trigger(&conn, &app, &task, &column)?;

    Ok(task)
}

#[tauri::command]
pub fn get_task(state: State<AppState>, id: String) -> Result<Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::get_task(&conn, &id)?)
}

#[tauri::command]
pub fn list_tasks(state: State<AppState>, workspace_id: String) -> Result<Vec<Task>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_tasks(&conn, &workspace_id)?)
}

#[tauri::command]
pub fn update_task(
    state: State<AppState>,
    id: String,
    title: Option<String>,
    description: Option<Option<String>>,
    column_id: Option<String>,
    position: Option<i64>,
    agent_mode: Option<Option<String>>,
    priority: Option<String>,
) -> Result<Task, AppError> {
    if let Some(ref t) = title {
        if t.trim().is_empty() {
            return Err(AppError::InvalidInput("Task title cannot be empty".to_string()));
        }
    }
    if let Some(pos) = position {
        if pos < 0 {
            return Err(AppError::InvalidInput("Position must be non-negative".to_string()));
        }
    }

    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let desc_ref = description.as_ref().map(|d| d.as_deref());
    let mode_ref = agent_mode.as_ref().map(|m| m.as_deref());
    Ok(db::update_task(
        &conn,
        &id,
        title.as_deref(),
        desc_ref,
        column_id.as_deref(),
        position,
        mode_ref,
        priority.as_deref(),
    )?)
}

#[tauri::command]
pub fn move_task(
    app: AppHandle,
    state: State<AppState>,
    id: String,
    target_column_id: String,
    position: i64,
) -> Result<Task, AppError> {
    if position < 0 {
        return Err(AppError::InvalidInput("Position must be non-negative".to_string()));
    }

    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Get the task's current column to check if it changed
    let task_before = db::get_task(&conn, &id)?;
    let column_changed = task_before.column_id != target_column_id;

    let tx = conn.unchecked_transaction().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Update column and position atomically
    // Also reset pipeline state when moving to a new column
    let ts = db::now();
    if column_changed {
        conn.execute(
            "UPDATE tasks SET column_id = ?1, position = ?2, pipeline_state = 'idle', pipeline_triggered_at = NULL, pipeline_error = NULL, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![target_column_id, position, ts, id],
        )
        .map_err(AppError::from)?;
    } else {
        conn.execute(
            "UPDATE tasks SET column_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![target_column_id, position, ts, id],
        )
        .map_err(AppError::from)?;
    }

    tx.commit().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let task = db::get_task(&conn, &id)?;

    // Fire column trigger if task moved to a new column
    if column_changed {
        let target_column = db::get_column(&conn, &target_column_id)?;
        let task = pipeline::fire_trigger(&conn, &app, &task, &target_column)?;
        return Ok(task);
    }

    Ok(task)
}

#[tauri::command]
pub fn reorder_tasks(
    state: State<AppState>,
    column_id: String,
    task_ids: Vec<String>,
) -> Result<Vec<Task>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let tx = conn.unchecked_transaction().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let ts = db::now();

    for (i, task_id) in task_ids.iter().enumerate() {
        conn.execute(
            "UPDATE tasks SET position = ?1, updated_at = ?2 WHERE id = ?3 AND column_id = ?4",
            rusqlite::params![i as i64, ts, task_id, column_id],
        )
        .map_err(AppError::from)?;
    }

    tx.commit().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Get the workspace_id from the column to list tasks
    let col = db::get_column(&conn, &column_id)?;
    Ok(db::list_tasks(&conn, &col.workspace_id)?)
}

#[tauri::command]
pub fn delete_task(state: State<AppState>, id: String) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::delete_task(&conn, &id)?;
    Ok(())
}

/// Approve a task - sets review_status to "approved" and triggers auto-advance if exit_type is manual_approval
#[tauri::command]
pub fn approve_task(
    app: AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    
    // Set review_status to approved
    let task = db::update_task_review_status(&conn, &id, Some("approved"))?;
    
    // Get the column to check if we should try auto-advance
    let column = db::get_column(&conn, &task.column_id)?;
    
    // Try to auto-advance if the column has auto_advance enabled
    if column.auto_advance {
        if let Some(advanced_task) = pipeline::try_auto_advance(&conn, &app, &task, &column)? {
            return Ok(advanced_task);
        }
    }
    
    Ok(task)
}

/// Reject a task - sets review_status to "rejected" and optionally sets pipeline_error
#[tauri::command]
pub fn reject_task(
    state: State<AppState>,
    id: String,
    reason: Option<String>,
) -> Result<Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Set review_status to rejected
    let mut task = db::update_task_review_status(&conn, &id, Some("rejected"))?;

    // Set pipeline_error with rejection reason if provided
    if let Some(ref reason_text) = reason {
        task = db::update_task_pipeline_state(
            &conn,
            &id,
            &task.pipeline_state,
            task.pipeline_triggered_at.as_deref(),
            Some(reason_text),
        )?;
    }

    Ok(task)
}

/// Result of creating a GitHub PR
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePrResult {
    pub pr_number: i64,
    pub pr_url: String,
    pub task: Task,
}

/// Create a GitHub PR for a task using the gh CLI
#[tauri::command]
pub async fn create_pr(
    state: State<'_, AppState>,
    task_id: String,
    repo_path: String,
    base_branch: Option<String>,
) -> Result<CreatePrResult, AppError> {
    // Get the task to retrieve title, description, and branch
    let task = {
        let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
        db::get_task(&conn, &task_id)?
    };

    // Verify task has a branch
    let branch_name = task.branch_name.clone().ok_or_else(|| {
        AppError::InvalidInput("Task has no associated branch".to_string())
    })?;

    // Check if PR already exists
    if task.pr_number.is_some() {
        return Err(AppError::InvalidInput(format!(
            "Task already has PR #{}",
            task.pr_number.unwrap()
        )));
    }

    // Build PR title and body
    let pr_title = task.title.clone();
    let pr_body = task.description.clone().unwrap_or_default();
    let base = base_branch.unwrap_or_else(|| "main".to_string());

    // Run gh pr create command
    let (pr_number, pr_url) = tokio::task::spawn_blocking(move || -> Result<(i64, String), AppError> {
        let output = Command::new("gh")
            .args([
                "pr", "create",
                "--title", &pr_title,
                "--body", &pr_body,
                "--base", &base,
                "--head", &branch_name,
            ])
            .current_dir(&repo_path)
            .output()
            .map_err(|e| AppError::CommandError(format!("Failed to run gh CLI: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::CommandError(format!("gh pr create failed: {}", stderr)));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let pr_url = stdout.trim().to_string();

        // Parse PR number from URL (e.g., https://github.com/owner/repo/pull/123)
        let pr_number = pr_url
            .rsplit('/')
            .next()
            .and_then(|s| s.parse::<i64>().ok())
            .ok_or_else(|| AppError::CommandError(format!(
                "Failed to parse PR number from URL: {}", pr_url
            )))?;

        Ok((pr_number, pr_url))
    })
    .await
    .map_err(|e| AppError::CommandError(format!("Task join error: {}", e)))??;

    // Update task with PR info
    let updated_task = {
        let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
        db::update_task_pr_info(&conn, &task_id, Some(pr_number), Some(&pr_url))?
    };

    Ok(CreatePrResult {
        pr_number,
        pr_url,
        task: updated_task,
    })
}

/// Update notification stakeholders for a task
#[tauri::command]
pub fn update_task_stakeholders(
    state: State<AppState>,
    id: String,
    stakeholders: Option<String>,
) -> Result<Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::update_task_stakeholders(&conn, &id, stakeholders.as_deref())?)
}

/// Mark notification as sent for a task
#[tauri::command]
pub fn mark_notification_sent(state: State<AppState>, id: String) -> Result<Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::mark_notification_sent(&conn, &id)?)
}

/// Clear notification sent timestamp to resend notification
#[tauri::command]
pub fn clear_notification_sent(state: State<AppState>, id: String) -> Result<Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::clear_notification_sent(&conn, &id)?)
}
