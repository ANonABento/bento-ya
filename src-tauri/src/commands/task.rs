use crate::db::{self, AppState, Task};
use crate::error::AppError;
use crate::pipeline;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{AppHandle, Emitter, State};

// ─── Discord Task Events ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCreatedEvent {
    pub task_id: String,
    pub workspace_id: String,
    pub column_id: String,
    pub title: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMovedEvent {
    pub task_id: String,
    pub workspace_id: String,
    pub old_column_id: String,
    pub new_column_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpdatedEvent {
    pub task_id: String,
    pub workspace_id: String,
    pub column_id: String,
    pub old_title: Option<String>,
    pub new_title: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDeletedEvent {
    pub task_id: String,
    pub workspace_id: String,
    pub column_id: String,
    pub title: String,
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_task(
    app: AppHandle,
    state: State<AppState>,
    workspace_id: String,
    column_id: String,
    title: String,
    description: Option<String>,
    trigger_prompt: Option<String>,
    dependencies: Option<String>,
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

    // Set trigger prompt and dependencies if provided
    let ts = db::now();
    if trigger_prompt.is_some() || dependencies.is_some() {
        let has_deps = dependencies.as_ref().map(|d| d != "[]" && !d.is_empty()).unwrap_or(false);
        conn.execute(
            "UPDATE tasks SET trigger_prompt = COALESCE(?1, trigger_prompt), dependencies = COALESCE(?2, dependencies), blocked = ?3, updated_at = ?4 WHERE id = ?5",
            rusqlite::params![
                trigger_prompt,
                dependencies,
                has_deps as i64,
                ts,
                task.id,
            ],
        ).map_err(AppError::from)?;
    }

    let task = db::get_task(&conn, &task.id)?;

    // Fire column trigger for the initial column (unless blocked)
    let column = db::get_column(&conn, &column_id)?;
    let task = if !task.blocked {
        pipeline::fire_trigger(&conn, &app, &task, &column)?
    } else {
        task
    };

    // Emit Discord sync event
    let _ = app.emit("discord:task_created", TaskCreatedEvent {
        task_id: task.id.clone(),
        workspace_id: task.workspace_id.clone(),
        column_id: task.column_id.clone(),
        title: task.title.clone(),
        description: task.description.clone(),
    });

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
    app: AppHandle,
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

    // Get old task for comparison (only if title is being updated)
    let old_title = if title.is_some() {
        Some(db::get_task(&conn, &id)?.title)
    } else {
        None
    };

    let desc_ref = description.as_ref().map(|d| d.as_deref());
    let mode_ref = agent_mode.as_ref().map(|m| m.as_deref());
    let task = db::update_task(
        &conn,
        &id,
        title.as_deref(),
        desc_ref,
        column_id.as_deref(),
        position,
        mode_ref,
        priority.as_deref(),
    )?;

    // Emit Discord sync event if title changed
    if let Some(ref new_title) = title {
        let _ = app.emit("discord:task_updated", TaskUpdatedEvent {
            task_id: task.id.clone(),
            workspace_id: task.workspace_id.clone(),
            column_id: task.column_id.clone(),
            old_title,
            new_title: Some(new_title.clone()),
        });
    }

    Ok(task)
}

/// Update task trigger settings (overrides, prompt, dependencies)
#[tauri::command(rename_all = "camelCase")]
pub fn update_task_triggers(
    state: State<AppState>,
    id: String,
    trigger_overrides: Option<String>,
    trigger_prompt: Option<Option<String>>,
    dependencies: Option<String>,
    blocked: Option<bool>,
) -> Result<Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let ts = db::now();

    // Build dynamic UPDATE query
    let mut updates = Vec::new();
    let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref overrides) = trigger_overrides {
        updates.push("trigger_overrides = ?");
        params_vec.push(Box::new(overrides.clone()));
    }
    if let Some(ref prompt) = trigger_prompt {
        updates.push("trigger_prompt = ?");
        params_vec.push(Box::new(prompt.clone()));
    }
    if let Some(ref deps) = dependencies {
        updates.push("dependencies = ?");
        params_vec.push(Box::new(deps.clone()));
    }
    if let Some(b) = blocked {
        updates.push("blocked = ?");
        params_vec.push(Box::new(b as i64));
    }

    if updates.is_empty() {
        return Ok(db::get_task(&conn, &id)?);
    }

    updates.push("updated_at = ?");
    params_vec.push(Box::new(ts));

    let set_clause = updates.join(", ");
    let sql = format!("UPDATE tasks SET {} WHERE id = ?", set_clause);
    params_vec.push(Box::new(id.clone()));

    let params_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_refs.as_slice())
        .map_err(AppError::from)?;

    Ok(db::get_task(&conn, &id)?)
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
    let old_column_id = task_before.column_id.clone();
    let column_changed = old_column_id != target_column_id;

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
        // Fire on_exit trigger on the old column (V2 triggers)
        let old_column = db::get_column(&conn, &old_column_id)?;
        let target_column = db::get_column(&conn, &target_column_id)?;
        let _ = pipeline::triggers::fire_on_exit(&conn, &app, &task_before, &old_column, Some(&target_column));

        // Emit Discord sync event
        let _ = app.emit("discord:task_moved", TaskMovedEvent {
            task_id: task.id.clone(),
            workspace_id: task.workspace_id.clone(),
            old_column_id,
            new_column_id: target_column_id.clone(),
            title: task.title.clone(),
        });

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
pub fn delete_task(
    app: AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<(), AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Get task info before deletion for the event
    let task = db::get_task(&conn, &id)?;

    db::delete_task(&conn, &id)?;

    // Emit Discord sync event
    let _ = app.emit("discord:task_deleted", TaskDeletedEvent {
        task_id: task.id,
        workspace_id: task.workspace_id,
        column_id: task.column_id,
        title: task.title,
    });

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

// ─── Notification Commands ─────────────────────────────────────────────────

/// Update the stakeholders to notify for a task
#[tauri::command]
pub fn update_task_stakeholders(
    state: State<AppState>,
    id: String,
    stakeholders: Option<String>,
) -> Result<Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::update_task_stakeholders(&conn, &id, stakeholders.as_deref())?)
}

/// Mark a task's notification as sent
#[tauri::command]
pub fn mark_task_notification_sent(
    state: State<AppState>,
    id: String,
) -> Result<Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::mark_task_notification_sent(&conn, &id)?)
}

/// Clear the notification sent timestamp
#[tauri::command]
pub fn clear_task_notification_sent(
    state: State<AppState>,
    id: String,
) -> Result<Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::clear_task_notification_sent(&conn, &id)?)
}

// ─── Test Checklist Generation ────────────────────────────────────────────────

/// Generated test checklist item
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedTestItem {
    pub text: String,
}

/// Result of test checklist generation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateTestChecklistResult {
    pub items: Vec<GeneratedTestItem>,
    pub diff_summary: String,
}

/// Generate test checklist items from PR diff using Claude CLI
#[tauri::command(rename_all = "camelCase")]
pub async fn generate_test_checklist(
    state: State<'_, AppState>,
    task_id: String,
    repo_path: String,
    cli_path: Option<String>,
) -> Result<GenerateTestChecklistResult, AppError> {
    // Get task to check PR number
    let pr_number = {
        let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let task = db::get_task(&conn, &task_id)?;
        task.pr_number.ok_or_else(|| AppError::InvalidInput(
            "Task has no PR associated".to_string()
        ))?
    };

    // Get PR diff using gh CLI
    let diff = tokio::task::spawn_blocking({
        let repo_path = repo_path.clone();
        move || -> Result<String, AppError> {
            let output = Command::new("gh")
                .args(["pr", "diff", &pr_number.to_string()])
                .current_dir(&repo_path)
                .output()
                .map_err(|e| AppError::CommandError(format!("Failed to run gh CLI: {}", e)))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(AppError::CommandError(format!("gh pr diff failed: {}", stderr)));
            }

            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        }
    })
    .await
    .map_err(|e| AppError::CommandError(format!("Task join error: {}", e)))??;

    // Truncate diff if too long (keep first 10KB)
    let truncated_diff = if diff.len() > 10000 {
        format!("{}...\n\n[Diff truncated - {} more bytes]", &diff[..10000], diff.len() - 10000)
    } else {
        diff.clone()
    };

    // Create prompt for Claude
    let prompt = format!(
        r#"Analyze this PR diff and generate a concise list of manual test items. Focus on user-facing changes that need verification.

Rules:
- Each item should be actionable and specific
- Focus on what to test, not how
- Include edge cases for changed functionality
- Keep items short (under 80 chars)
- Return 3-8 items max
- Format: JSON array of objects with "text" field

Example output:
[
  {{"text": "Verify login works with valid credentials"}},
  {{"text": "Test error message when password is incorrect"}},
  {{"text": "Check session persists after page refresh"}}
]

PR Diff:
```
{}
```

Return ONLY the JSON array, no other text."#,
        truncated_diff
    );

    // Call Claude CLI to generate test items
    let cli = cli_path.unwrap_or_else(|| "claude".to_string());
    let items = tokio::task::spawn_blocking({
        let cli = cli.clone();
        let repo_path = repo_path.clone();
        move || -> Result<Vec<GeneratedTestItem>, AppError> {
            let output = Command::new(&cli)
                .args([
                    "--print",
                    "--output-format", "text",
                    "-p", &prompt,
                ])
                .current_dir(&repo_path)
                .output()
                .map_err(|e| AppError::CommandError(format!("Failed to run Claude CLI: {}", e)))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(AppError::CommandError(format!("Claude CLI failed: {}", stderr)));
            }

            let stdout = String::from_utf8_lossy(&output.stdout);

            // Extract JSON from response (may have markdown code blocks)
            let json_str = stdout
                .trim()
                .trim_start_matches("```json")
                .trim_start_matches("```")
                .trim_end_matches("```")
                .trim();

            // Parse JSON array
            let items: Vec<GeneratedTestItem> = serde_json::from_str(json_str)
                .map_err(|e| AppError::CommandError(format!(
                    "Failed to parse Claude response as JSON: {}. Response was: {}",
                    e, json_str
                )))?;

            Ok(items)
        }
    })
    .await
    .map_err(|e| AppError::CommandError(format!("Task join error: {}", e)))??;

    // Generate a brief summary of the diff
    let files_changed: Vec<&str> = diff
        .lines()
        .filter(|l| l.starts_with("diff --git"))
        .filter_map(|l| l.split(' ').last())
        .take(5)
        .collect();

    let diff_summary = if files_changed.is_empty() {
        "No files changed".to_string()
    } else {
        format!("{} files: {}", files_changed.len(), files_changed.join(", "))
    };

    Ok(GenerateTestChecklistResult {
        items,
        diff_summary,
    })
}

/// Retry a failed pipeline trigger
/// Clears the error and re-fires the column trigger
#[tauri::command(rename_all = "camelCase")]
pub fn retry_pipeline(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
) -> Result<Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Get the task
    let task = db::get_task(&conn, &task_id)?;

    // Get the current column
    let column = db::get_column(&conn, &task.column_id)?;

    // Clear the error and reset state to idle
    db::update_task_pipeline_state(&conn, &task_id, "idle", None, None)?;

    // Re-fire the trigger
    let task = db::get_task(&conn, &task_id)?;
    let task = pipeline::fire_trigger(&conn, &app, &task, &column)?;

    Ok(task)
}
