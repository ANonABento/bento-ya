use crate::db::{self, AppState, Task};
use crate::error::AppError;
use crate::pipeline;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{AppHandle, State};

#[tauri::command(rename_all = "camelCase")]
#[allow(clippy::too_many_arguments)]
pub async fn create_task(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    column_id: String,
    title: String,
    description: Option<String>,
    trigger_prompt: Option<String>,
    dependencies: Option<String>,
) -> Result<Task, AppError> {
    if title.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Task title cannot be empty".to_string(),
        ));
    }

    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
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
        let has_deps = dependencies
            .as_ref()
            .map(|d| d != "[]" && !d.is_empty())
            .unwrap_or(false);
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

    // Notify frontend to refresh task store
    pipeline::emit_tasks_changed(&app, &workspace_id, "task_created");

    Ok(task)
}

#[tauri::command]
pub fn get_task(state: State<AppState>, id: String) -> Result<Task, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::get_task(&conn, &id)?)
}

#[tauri::command]
pub fn list_tasks(state: State<AppState>, workspace_id: String) -> Result<Vec<Task>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_tasks(&conn, &workspace_id)?)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_task(
    _app: AppHandle,
    state: State<AppState>,
    id: String,
    title: Option<String>,
    description: Option<Option<String>>,
    column_id: Option<String>,
    position: Option<i64>,
    agent_mode: Option<Option<String>>,
    priority: Option<String>,
    model: Option<Option<String>>,
) -> Result<Task, AppError> {
    if let Some(ref t) = title {
        if t.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "Task title cannot be empty".to_string(),
            ));
        }
    }
    if let Some(pos) = position {
        if pos < 0 {
            return Err(AppError::InvalidInput(
                "Position must be non-negative".to_string(),
            ));
        }
    }

    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let desc_ref = description.as_ref().map(|d| d.as_deref());
    let mode_ref = agent_mode.as_ref().map(|m| m.as_deref());
    let mut task = db::update_task(
        &conn,
        &id,
        title.as_deref(),
        desc_ref,
        column_id.as_deref(),
        position,
        mode_ref,
        priority.as_deref(),
    )?;

    // Update model if provided
    if let Some(ref m) = model {
        let ts = db::now();
        conn.execute(
            "UPDATE tasks SET model = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![m.as_deref(), ts, id],
        )
        .map_err(AppError::from)?;
        task = db::get_task(&conn, &id)?;
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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Validate dependencies won't create a cycle before saving
    if let Some(ref deps_json) = dependencies {
        if !deps_json.is_empty() && deps_json != "[]" {
            let deps: Vec<pipeline::dependencies::TaskDependency> = serde_json::from_str(deps_json)
                .map_err(|e| AppError::InvalidInput(format!("Invalid dependencies JSON: {}", e)))?;
            pipeline::dependencies::validate_dependencies(&conn, &id, &deps)?;
        }
    }

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

    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        params_vec.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_refs.as_slice())
        .map_err(AppError::from)?;

    Ok(db::get_task(&conn, &id)?)
}

#[tauri::command]
pub async fn move_task(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    target_column_id: String,
    position: i64,
) -> Result<Task, AppError> {
    if position < 0 {
        return Err(AppError::InvalidInput(
            "Position must be non-negative".to_string(),
        ));
    }

    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Get the task's current column to check if it changed
    let task_before = db::get_task(&conn, &id)?;
    let old_column_id = task_before.column_id.clone();
    let column_changed = old_column_id != target_column_id;

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

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

    tx.commit()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let task = db::get_task(&conn, &id)?;

    // Fire column trigger if task moved to a new column
    if column_changed {
        // Fire on_exit trigger on the old column (V2 triggers)
        let old_column = db::get_column(&conn, &old_column_id)?;
        let target_column = db::get_column(&conn, &target_column_id)?;

        // Cancel running agent if target column has no spawn_cli trigger.
        // If target also has a trigger, it replaces the old agent — no cancel needed.
        if task_before.agent_status.as_deref() == Some("running") {
            let target_has_trigger = target_column
                .triggers
                .as_deref()
                .map(|t| t.contains("spawn_cli"))
                .unwrap_or(false);

            if !target_has_trigger {
                crate::chat::tmux_transport::cancel_task_agent(
                    &conn,
                    &id,
                    task_before.agent_session_id.as_deref(),
                );
            }
        }
        let _ = pipeline::triggers::fire_on_exit(
            &conn,
            &app,
            &task_before,
            &old_column,
            Some(&target_column),
        );

        // Notify frontend to refresh task store
        pipeline::emit_tasks_changed(&app, &task.workspace_id, "task_moved");

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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let ts = db::now();

    for (i, task_id) in task_ids.iter().enumerate() {
        conn.execute(
            "UPDATE tasks SET position = ?1, updated_at = ?2 WHERE id = ?3 AND column_id = ?4",
            rusqlite::params![i as i64, ts, task_id, column_id],
        )
        .map_err(AppError::from)?;
    }

    tx.commit()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Get the workspace_id from the column to list tasks
    let col = db::get_column(&conn, &column_id)?;
    Ok(db::list_tasks(&conn, &col.workspace_id)?)
}

#[tauri::command]
pub fn delete_task(app: AppHandle, state: State<AppState>, id: String) -> Result<(), AppError> {
    use crate::git::branch_manager;

    // Read task + workspace info, then release lock before filesystem I/O
    let (task, repo_path) = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let task = db::get_task(&conn, &id)?;
        let repo_path = if task.worktree_path.is_some() {
            db::get_workspace(&conn, &task.workspace_id)
                .ok()
                .map(|ws| ws.repo_path)
        } else {
            None
        };
        (task, repo_path)
    };

    // Clean up worktree outside the DB lock (filesystem I/O)
    if task.worktree_path.is_some() {
        if let Some(ref rp) = repo_path {
            if let Err(e) = branch_manager::remove_task_worktree(rp, &id) {
                log::warn!("Failed to clean up worktree for deleted task {}: {}", id, e);
            }
        }
    }

    // Re-acquire lock for deletion
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        db::delete_task(&conn, &id)?;
    }

    // Notify frontend to refresh task store
    pipeline::emit_tasks_changed(&app, &task.workspace_id, "task_deleted");

    Ok(())
}

#[tauri::command]
pub fn archive_task(app: AppHandle, state: State<AppState>, id: String) -> Result<Task, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let task = db::set_task_archived(&conn, &id, true)?;
    pipeline::emit_tasks_changed(&app, &task.workspace_id, "task_archived");
    Ok(task)
}

#[tauri::command]
pub fn unarchive_task(
    app: AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<Task, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let task = db::set_task_archived(&conn, &id, false)?;
    pipeline::emit_tasks_changed(&app, &task.workspace_id, "task_unarchived");
    Ok(task)
}

/// Approve a task - sets review_status to "approved" and triggers auto-advance if exit_type is manual_approval
#[tauri::command]
pub async fn approve_task(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Task, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Set review_status to approved
    let task = db::update_task_review_status(&conn, &id, Some("approved"))?;

    // Get the column to check if we should try auto-advance
    let column = db::get_column(&conn, &task.column_id)?;

    // Try to auto-advance (checks V2 triggers internally)
    if let Some(advanced_task) = pipeline::try_auto_advance(&conn, &app, &task, &column)? {
        return Ok(advanced_task);
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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

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
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        db::get_task(&conn, &task_id)?
    };

    // Verify task has a branch
    let branch_name = task
        .branch_name
        .clone()
        .ok_or_else(|| AppError::InvalidInput("Task has no associated branch".to_string()))?;

    // Check if PR already exists
    if let Some(pr_number) = task.pr_number {
        return Err(AppError::InvalidInput(format!(
            "Task already has PR #{}",
            pr_number
        )));
    }

    // Build PR title and body
    let pr_title = task.title.clone();
    let pr_body = task.description.clone().unwrap_or_default();
    let base = base_branch.unwrap_or_else(|| "main".to_string());

    // Run gh pr create command
    let (pr_number, pr_url) =
        tokio::task::spawn_blocking(move || -> Result<(i64, String), AppError> {
            let output = Command::new("gh")
                .args([
                    "pr",
                    "create",
                    "--title",
                    &pr_title,
                    "--body",
                    &pr_body,
                    "--base",
                    &base,
                    "--head",
                    &branch_name,
                ])
                .current_dir(&repo_path)
                .output()
                .map_err(|e| AppError::CommandError(format!("Failed to run gh CLI: {}", e)))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(AppError::CommandError(format!(
                    "gh pr create failed: {}",
                    stderr
                )));
            }

            let stdout = String::from_utf8_lossy(&output.stdout);
            let pr_url = stdout.trim().to_string();

            // Parse PR number from URL (e.g., https://github.com/owner/repo/pull/123)
            let pr_number = pr_url
                .rsplit('/')
                .next()
                .and_then(|s| s.parse::<i64>().ok())
                .ok_or_else(|| {
                    AppError::CommandError(format!(
                        "Failed to parse PR number from URL: {}",
                        pr_url
                    ))
                })?;

            Ok((pr_number, pr_url))
        })
        .await
        .map_err(|e| AppError::CommandError(format!("Task join error: {}", e)))??;

    // Update task with PR info
    let updated_task = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
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
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::update_task_stakeholders(
        &conn,
        &id,
        stakeholders.as_deref(),
    )?)
}

/// Mark a task's notification as sent
#[tauri::command]
pub fn mark_task_notification_sent(state: State<AppState>, id: String) -> Result<Task, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::mark_task_notification_sent(&conn, &id)?)
}

/// Clear the notification sent timestamp
#[tauri::command]
pub fn clear_task_notification_sent(state: State<AppState>, id: String) -> Result<Task, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
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
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let task = db::get_task(&conn, &task_id)?;
        task.pr_number
            .ok_or_else(|| AppError::InvalidInput("Task has no PR associated".to_string()))?
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
                return Err(AppError::CommandError(format!(
                    "gh pr diff failed: {}",
                    stderr
                )));
            }

            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        }
    })
    .await
    .map_err(|e| AppError::CommandError(format!("Task join error: {}", e)))??;

    // Truncate diff if too long (keep first 10KB)
    let truncated_diff = if diff.len() > 10000 {
        format!(
            "{}...\n\n[Diff truncated - {} more bytes]",
            &diff[..10000],
            diff.len() - 10000
        )
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
                .args(["--print", "--output-format", "text", "-p", &prompt])
                .current_dir(&repo_path)
                .output()
                .map_err(|e| AppError::CommandError(format!("Failed to run Claude CLI: {}", e)))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(AppError::CommandError(format!(
                    "Claude CLI failed: {}",
                    stderr
                )));
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
            let items: Vec<GeneratedTestItem> = serde_json::from_str(json_str).map_err(|e| {
                AppError::CommandError(format!(
                    "Failed to parse Claude response as JSON: {}. Response was: {}",
                    e, json_str
                ))
            })?;

            Ok(items)
        }
    })
    .await
    .map_err(|e| AppError::CommandError(format!("Task join error: {}", e)))??;

    // Generate a brief summary of the diff
    let files_changed: Vec<&str> = diff
        .lines()
        .filter(|l| l.starts_with("diff --git"))
        .filter_map(|l| l.split(' ').next_back())
        .take(5)
        .collect();

    let diff_summary = if files_changed.is_empty() {
        "No files changed".to_string()
    } else {
        format!(
            "{} files: {}",
            files_changed.len(),
            files_changed.join(", ")
        )
    };

    Ok(GenerateTestChecklistResult {
        items,
        diff_summary,
    })
}

/// Queue N tasks from Backlog for sequential batch processing.
/// Sets queued_at on the first N tasks, then moves the first one to Plan.
#[tauri::command(rename_all = "camelCase")]
pub async fn queue_backlog(
    app: AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    count: i64,
) -> Result<Vec<Task>, AppError> {
    if count <= 0 {
        return Err(AppError::InvalidInput("Count must be positive".to_string()));
    }

    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Find the Backlog column
    let columns = db::list_columns(&conn, &workspace_id)?;
    let backlog_column = columns
        .iter()
        .find(|c| c.name == "Backlog")
        .ok_or_else(|| AppError::InvalidInput("No 'Backlog' column found".to_string()))?;

    // Get first N tasks from Backlog ordered by position
    let backlog_tasks: Vec<Task> = db::list_tasks_by_column(&conn, &backlog_column.id)?
        .into_iter()
        .filter(|task| task.archived_at.is_none())
        .collect();
    let to_queue: Vec<&Task> = backlog_tasks.iter().take(count as usize).collect();

    if to_queue.is_empty() {
        return Err(AppError::InvalidInput(
            "No unarchived tasks in Backlog to queue".to_string(),
        ));
    }

    // Set queued_at and shared batch_id on each task
    let ts = db::now();
    let batch_id = db::generate_batch_id();
    let mut queued_tasks = Vec::new();
    for task in &to_queue {
        conn.execute(
            "UPDATE tasks SET queued_at = ?1, batch_id = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![&ts, &batch_id, &ts, task.id],
        )
        .map_err(AppError::from)?;
        queued_tasks.push(db::get_task(&conn, &task.id)?);
    }

    // Move the first task to Plan and fire trigger
    let plan_column = columns
        .iter()
        .find(|c| c.name == "Plan")
        .ok_or_else(|| AppError::InvalidInput("No 'Plan' column found".to_string()))?;

    let moved_task = db::append_task_to_column(&conn, &queued_tasks[0].id, &plan_column.id)
        .map_err(AppError::from)?;

    pipeline::emit_tasks_changed(&app, &workspace_id, "batch_queue_started");

    // Fire the Plan trigger on the first task
    pipeline::fire_trigger(&conn, &app, &moved_task, plan_column)?;

    // Return all queued tasks: first task with its new column, rest unchanged
    let mut result = queued_tasks;
    result[0] = moved_task;
    Ok(result)
}

/// Validate that task dependencies won't create a cycle
#[tauri::command]
pub fn validate_task_dependencies(
    state: State<AppState>,
    task_id: String,
    dependencies: String,
) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let deps: Vec<pipeline::dependencies::TaskDependency> = serde_json::from_str(&dependencies)
        .map_err(|e| AppError::InvalidInput(format!("Invalid dependencies JSON: {}", e)))?;
    pipeline::dependencies::validate_dependencies(&conn, &task_id, &deps)
}

/// Reset a task back to Backlog after retries were exhausted.
///
/// Deletes the task's worktree, clears branch_name/worktree_path, resets
/// retry_count to 0, sets an explanatory pipeline_error, and moves the task
/// into the first column (Backlog) so the agent gets a clean slate on retry.
pub fn reset_task_to_backlog(
    conn: &rusqlite::Connection,
    app: &AppHandle,
    task_id: &str,
) -> Result<Task, AppError> {
    use crate::git::branch_manager;

    let task = db::get_task(conn, task_id)?;

    // Find the first column (Backlog) — columns are ordered by position.
    let columns = db::list_columns(conn, &task.workspace_id)?;
    let first_col = columns.into_iter().next().ok_or_else(|| {
        AppError::NotFound(format!(
            "No columns found in workspace {}",
            task.workspace_id
        ))
    })?;

    // retry_count doesn't include the initial attempt, so total attempts = retry_count + 1.
    let attempts = task.retry_count + 1;

    // Delete the worktree so the agent starts from a clean slate.
    if task.worktree_path.is_some() {
        if let Ok(workspace) = db::get_workspace(conn, &task.workspace_id) {
            if !workspace.repo_path.is_empty() {
                if let Err(e) = branch_manager::remove_task_worktree(&workspace.repo_path, task_id)
                {
                    log::warn!(
                        "[reset_task_to_backlog] Failed to remove worktree for task {}: {}",
                        task_id,
                        e
                    );
                }
            }
        }
    }

    let max_pos: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
            rusqlite::params![first_col.id],
            |row| row.get(0),
        )
        .unwrap_or(-1);

    let error_msg = format!("Moved to Backlog after {} failed attempts", attempts);
    let ts = db::now();

    conn.execute(
        "UPDATE tasks SET column_id = ?1, position = ?2, branch_name = NULL, worktree_path = NULL, retry_count = 0, pipeline_state = 'idle', pipeline_triggered_at = NULL, pipeline_error = ?3, updated_at = ?4 WHERE id = ?5",
        rusqlite::params![first_col.id, max_pos + 1, error_msg, ts, task_id],
    )
    .map_err(AppError::from)?;

    log::info!(
        "[reset_task_to_backlog] Task {} reset to column '{}' after {} failed attempts",
        task_id,
        first_col.name,
        attempts
    );

    pipeline::emit_tasks_changed(app, &task.workspace_id, "task_reset_to_backlog");

    Ok(db::get_task(conn, task_id)?)
}

/// Retry a failed pipeline trigger
/// Clears the error and re-fires the column trigger
#[tauri::command(rename_all = "camelCase")]
pub async fn retry_pipeline(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Task, AppError> {
    use crate::git::branch_manager;

    // Clean the worktree before re-firing so the new agent starts fresh.
    // Done outside the DB lock — filesystem I/O can block.
    let worktree_path = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let task = db::get_task(&conn, &task_id)?;
        task.worktree_path.clone()
    };

    if let Some(wt) = worktree_path.as_deref() {
        if !wt.is_empty() && std::path::Path::new(wt).exists() {
            let wt_owned = wt.to_string();
            let task_id_for_log = task_id.clone();
            let clean_result =
                tokio::task::spawn_blocking(move || branch_manager::clean_worktree(&wt_owned))
                    .await
                    .map_err(|e| AppError::CommandError(e.to_string()))?;

            match clean_result {
                Ok(summary) => log::info!(
                    "[pipeline] retry cleaned worktree for task {}: {}",
                    task_id_for_log,
                    summary
                ),
                Err(e) => log::warn!(
                    "[pipeline] retry failed to clean worktree for task {}: {}",
                    task_id_for_log,
                    e
                ),
            }
        }
    }

    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Get the task
    let task = db::get_task(&conn, &task_id)?;

    // Get the current column
    let column = db::get_column(&conn, &task.column_id)?;

    // Clear the error and reset state to idle
    db::update_task_pipeline_state(
        &conn,
        &task_id,
        pipeline::PipelineState::Idle.as_str(),
        None,
        None,
    )?;

    // Re-fire the trigger
    let task = db::get_task(&conn, &task_id)?;
    let task = pipeline::fire_trigger(&conn, &app, &task, &column)?;

    Ok(task)
}

/// Retry a task from the start of the pipeline
/// Resets pipeline state, moves task to the first column, and fires its trigger.
/// Cancels any running agent session first. Preserves existing worktree.
#[tauri::command(rename_all = "camelCase")]
pub async fn retry_from_start(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Task, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Cancel any running agent for this task
    {
        let task = db::get_task(&conn, &task_id)?;
        if task.agent_status.as_deref() == Some("running") {
            crate::chat::tmux_transport::cancel_task_agent(
                &conn,
                &task_id,
                task.agent_session_id.as_deref(),
            );
        }
    }

    let task = db::get_task(&conn, &task_id)?;
    let old_column_id = task.column_id.clone();

    // Find the first column in this workspace
    let columns = db::list_columns(&conn, &task.workspace_id)?;
    let first_column = columns
        .into_iter()
        .next()
        .ok_or_else(|| AppError::InvalidInput("No columns found in workspace".into()))?;

    let column_changed = old_column_id != first_column.id;

    // Reset pipeline state and move to first column
    let ts = db::now();
    conn.execute(
        "UPDATE tasks SET column_id = ?1, position = 0, pipeline_state = 'idle', \
         pipeline_triggered_at = NULL, pipeline_error = NULL, retry_count = 0, \
         review_status = NULL, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![first_column.id, ts, task_id],
    )
    .map_err(AppError::from)?;

    // Fire on_exit for old column if changed
    if column_changed {
        let old_column = db::get_column(&conn, &old_column_id)?;
        let _ =
            pipeline::triggers::fire_on_exit(&conn, &app, &task, &old_column, Some(&first_column));
    }

    // Notify frontend
    pipeline::emit_tasks_changed(&app, &task.workspace_id, "retry_from_start");

    // Fire the first column's entry trigger
    let task = db::get_task(&conn, &task_id)?;
    let task = pipeline::fire_trigger(&conn, &app, &task, &first_column)?;

    Ok(task)
}

// ─── Worktree Commands ────────────────────────────────────────────────────

/// Create a git worktree for a task. Auto-creates the branch if needed.
/// Returns the updated task with worktree_path set.
#[tauri::command(rename_all = "camelCase")]
pub async fn create_task_worktree(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    base_branch: Option<String>,
) -> Result<Task, AppError> {
    use crate::git::branch_manager;

    let (task, workspace) = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let task = db::get_task(&conn, &task_id)?;
        let workspace = db::get_workspace(&conn, &task.workspace_id)?;
        (task, workspace)
    };

    if workspace.repo_path.is_empty() {
        return Err(AppError::InvalidInput("Workspace has no repo_path".into()));
    }

    // Already has a worktree
    if let Some(ref wt) = task.worktree_path {
        if !wt.is_empty() && std::path::Path::new(wt).exists() {
            return Ok(task);
        }
    }

    let repo_path = workspace.repo_path.clone();

    // Ensure task has a branch
    let branch = match &task.branch_name {
        Some(b) if !b.is_empty() => b.clone(),
        _ => {
            let slug = branch_manager::slugify(&task.title);
            let branch = tokio::task::spawn_blocking({
                let repo_path = repo_path.clone();
                let base = base_branch.clone();
                move || branch_manager::create_task_branch(&repo_path, &slug, base.as_deref())
            })
            .await
            .map_err(|e| AppError::CommandError(e.to_string()))?
            .map_err(AppError::CommandError)?;

            let conn = state
                .db
                .lock()
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;
            db::update_task_branch(&conn, &task_id, Some(&branch))?;
            branch
        }
    };

    // Create worktree
    let worktree_path = tokio::task::spawn_blocking({
        let repo_path = repo_path.clone();
        let branch = branch.clone();
        let task_id = task_id.clone();
        move || branch_manager::create_task_worktree(&repo_path, &branch, &task_id)
    })
    .await
    .map_err(|e| AppError::CommandError(e.to_string()))?
    .map_err(AppError::CommandError)?;

    // Update task with worktree path
    let updated = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        db::update_task_worktree_path(&conn, &task_id, Some(&worktree_path))?
    };

    pipeline::emit_tasks_changed(&app, &updated.workspace_id, "worktree_created");

    Ok(updated)
}

/// Remove a task's git worktree and clear the worktree_path field.
#[tauri::command(rename_all = "camelCase")]
pub async fn remove_task_worktree(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
) -> Result<Task, AppError> {
    use crate::git::branch_manager;

    let (task, workspace) = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let task = db::get_task(&conn, &task_id)?;
        let workspace = db::get_workspace(&conn, &task.workspace_id)?;
        (task, workspace)
    };

    if task.worktree_path.is_none() {
        // Nothing to remove
        return Ok(task);
    }

    tokio::task::spawn_blocking({
        let repo_path = workspace.repo_path.clone();
        let task_id = task_id.clone();
        move || branch_manager::remove_task_worktree(&repo_path, &task_id)
    })
    .await
    .map_err(|e| AppError::CommandError(e.to_string()))?
    .map_err(AppError::CommandError)?;

    let updated = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        db::update_task_worktree_path(&conn, &task_id, None)?
    };

    pipeline::emit_tasks_changed(&app, &updated.workspace_id, "worktree_removed");

    Ok(updated)
}
