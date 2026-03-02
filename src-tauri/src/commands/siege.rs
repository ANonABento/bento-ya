//! Siege Loop commands for Tauri IPC
//!
//! The siege loop monitors a PR for review comments and automatically
//! spawns agents to fix them, repeating until the PR is approved or
//! max iterations is reached.

use std::collections::HashMap;
use std::process::Command;
use std::sync::{Arc, Mutex};

use crate::db::{self, AppState, Task};
use crate::error::AppError;
use crate::process::agent_runner::AgentRunner;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

// ─── Types ──────────────────────────────────────────────────────────────────

/// PR review comment from GitHub
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrComment {
    pub id: i64,
    pub body: String,
    pub author: String,
    pub path: Option<String>,
    pub line: Option<i64>,
    pub created_at: String,
    pub state: Option<String>,
}

/// PR status information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrStatus {
    pub number: i64,
    pub state: String,         // OPEN, CLOSED, MERGED
    pub review_decision: Option<String>, // APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED
    pub comments: Vec<PrComment>,
    pub unresolved_count: i64,
}

/// Result of starting a siege loop
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartSiegeResult {
    pub task: Task,
    pub pr_status: PrStatus,
    pub agent_spawned: bool,
    pub message: String,
}

/// Result of checking siege status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckSiegeResult {
    pub task: Task,
    pub pr_status: PrStatus,
    pub should_continue: bool,
    pub reason: String,
}

/// Siege loop event for frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiegeEvent {
    pub task_id: String,
    pub event_type: String,
    pub iteration: i64,
    pub max_iterations: i64,
    pub message: String,
}

// ─── GitHub CLI Helpers ─────────────────────────────────────────────────────

/// Fetch PR status and comments using gh CLI
fn fetch_pr_status(repo_path: &str, pr_number: i64) -> Result<PrStatus, AppError> {
    // Get PR state and review decision
    let output = Command::new("gh")
        .args([
            "pr", "view",
            &pr_number.to_string(),
            "--json", "number,state,reviewDecision",
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::CommandError(format!("Failed to run gh CLI: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::CommandError(format!("gh pr view failed: {}", stderr)));
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PrInfo {
        number: i64,
        state: String,
        review_decision: Option<String>,
    }

    let pr_info: PrInfo = serde_json::from_slice(&output.stdout)
        .map_err(|e| AppError::CommandError(format!("Failed to parse PR info: {}", e)))?;

    // Get PR review comments
    let comments_output = Command::new("gh")
        .args([
            "pr", "view",
            &pr_number.to_string(),
            "--json", "comments,reviews",
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::CommandError(format!("Failed to get PR comments: {}", e)))?;

    let mut comments: Vec<PrComment> = Vec::new();

    if comments_output.status.success() {
        #[derive(Deserialize)]
        struct CommentInfo {
            body: String,
            author: AuthorInfo,
            #[serde(rename = "createdAt")]
            created_at: String,
        }

        #[derive(Deserialize)]
        struct AuthorInfo {
            login: String,
        }

        #[derive(Deserialize)]
        struct ReviewInfo {
            body: String,
            author: AuthorInfo,
            state: String,
            #[serde(rename = "createdAt")]
            created_at: String,
        }

        #[derive(Deserialize)]
        struct CommentsResult {
            comments: Option<Vec<CommentInfo>>,
            reviews: Option<Vec<ReviewInfo>>,
        }

        if let Ok(result) = serde_json::from_slice::<CommentsResult>(&comments_output.stdout) {
            // Add regular comments
            if let Some(pr_comments) = result.comments {
                for (i, c) in pr_comments.into_iter().enumerate() {
                    comments.push(PrComment {
                        id: i as i64,
                        body: c.body,
                        author: c.author.login,
                        path: None,
                        line: None,
                        created_at: c.created_at,
                        state: None,
                    });
                }
            }

            // Add reviews that have body content (actual feedback)
            if let Some(reviews) = result.reviews {
                for (i, r) in reviews.into_iter().enumerate() {
                    if !r.body.is_empty() && r.state != "APPROVED" {
                        comments.push(PrComment {
                            id: (1000 + i) as i64, // Offset to avoid collision
                            body: r.body,
                            author: r.author.login,
                            path: None,
                            line: None,
                            created_at: r.created_at,
                            state: Some(r.state),
                        });
                    }
                }
            }
        }
    }

    // Count unresolved comments (reviews with CHANGES_REQUESTED state)
    let unresolved_count = comments.iter()
        .filter(|c| c.state.as_deref() == Some("CHANGES_REQUESTED"))
        .count() as i64;

    Ok(PrStatus {
        number: pr_info.number,
        state: pr_info.state,
        review_decision: pr_info.review_decision,
        comments,
        unresolved_count,
    })
}

/// Build prompt for agent from PR comments
fn build_comment_prompt(pr_status: &PrStatus) -> String {
    let mut prompt = String::from("Fix the following PR review comments:\n\n");

    for comment in &pr_status.comments {
        prompt.push_str(&format!("## Comment from @{}\n", comment.author));
        if let Some(path) = &comment.path {
            prompt.push_str(&format!("File: {}", path));
            if let Some(line) = comment.line {
                prompt.push_str(&format!(" (line {})", line));
            }
            prompt.push('\n');
        }
        prompt.push_str(&comment.body);
        prompt.push_str("\n\n---\n\n");
    }

    prompt.push_str("After fixing, commit and push your changes.");
    prompt
}

// ─── Commands ───────────────────────────────────────────────────────────────

/// Start a siege loop for a task with an open PR
///
/// This will:
/// 1. Verify the task has a PR
/// 2. Fetch PR comments/status
/// 3. If unresolved comments exist, spawn agent with comment context
/// 4. Set siege_active = true and track iterations
#[tauri::command(rename_all = "camelCase")]
pub async fn start_siege(
    task_id: String,
    max_iterations: Option<i64>,
    env_vars: Option<HashMap<String, String>>,
    cli_path: Option<String>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
    agent_runner: State<'_, Arc<Mutex<AgentRunner>>>,
) -> Result<StartSiegeResult, String> {
    // Get task, workspace, and verify PR exists
    let (task, workspace) = {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        let task = db::get_task(&conn, &task_id).map_err(|e| format!("Task not found: {}", e))?;
        let workspace = db::get_workspace(&conn, &task.workspace_id)
            .map_err(|e| format!("Workspace not found: {}", e))?;
        (task, workspace)
    };

    // Verify task has a PR
    let pr_number = task.pr_number.ok_or("Task has no PR. Create a PR first.")?;

    // Fetch PR status
    let pr_status = fetch_pr_status(&workspace.repo_path, pr_number)
        .map_err(|e| format!("Failed to fetch PR status: {}", e))?;

    // Check if PR is already approved
    if pr_status.review_decision.as_deref() == Some("APPROVED") {
        let task = {
            let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
            db::stop_siege(&conn, &task_id).map_err(|e| format!("Failed to update task: {}", e))?
        };
        return Ok(StartSiegeResult {
            task,
            pr_status,
            agent_spawned: false,
            message: "PR is already approved. No siege needed.".to_string(),
        });
    }

    // Check if there are comments to address
    if pr_status.comments.is_empty() {
        let task = {
            let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
            db::start_siege(&conn, &task_id, max_iterations)
                .map_err(|e| format!("Failed to start siege: {}", e))?
        };
        return Ok(StartSiegeResult {
            task,
            pr_status,
            agent_spawned: false,
            message: "No comments to address. Siege started, waiting for reviews.".to_string(),
        });
    }

    // Start the siege
    {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        db::start_siege(&conn, &task_id, max_iterations)
            .map_err(|e| format!("Failed to start siege: {}", e))?;
    }

    // Build prompt from comments
    let prompt = build_comment_prompt(&pr_status);

    // Spawn agent with comment context
    let session = {
        let mut runner = agent_runner
            .lock()
            .map_err(|e| format!("Agent runner lock error: {}", e))?;

        runner.start_agent_with_prompt(
            &task_id,
            "claude",
            &workspace.repo_path,
            env_vars,
            cli_path,
            &prompt,
            app_handle.clone(),
        )?
    };

    // Increment iteration counter
    let task = {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        db::increment_siege_iteration(&conn, &task_id)
            .map_err(|e| format!("Failed to increment iteration: {}", e))?
    };

    // Emit siege event
    let comment_count = pr_status.comments.len();
    let iteration = task.siege_iteration;
    let max_iter = task.siege_max_iterations;

    let _ = app_handle.emit("siege:started", &SiegeEvent {
        task_id: task_id.clone(),
        event_type: "started".to_string(),
        iteration,
        max_iterations: max_iter,
        message: format!(
            "Siege started. Addressing {} comments. Agent spawned (pid: {:?})",
            comment_count,
            session.pid
        ),
    });

    Ok(StartSiegeResult {
        task,
        pr_status,
        agent_spawned: true,
        message: format!(
            "Siege iteration {} started. Addressing {} comments.",
            iteration,
            comment_count
        ),
    })
}

/// Check siege status and determine if loop should continue
///
/// This will:
/// 1. Verify siege is active
/// 2. Fetch current PR status
/// 3. Return whether to continue (more comments) or stop (approved/max iterations)
#[tauri::command(rename_all = "camelCase")]
pub async fn check_siege_status(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<CheckSiegeResult, String> {
    // Get task and workspace
    let (task, workspace) = {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        let task = db::get_task(&conn, &task_id).map_err(|e| format!("Task not found: {}", e))?;
        let workspace = db::get_workspace(&conn, &task.workspace_id)
            .map_err(|e| format!("Workspace not found: {}", e))?;
        (task, workspace)
    };

    // Verify siege is active
    if !task.siege_active {
        return Err("Siege is not active for this task".to_string());
    }

    // Verify task has a PR
    let pr_number = task.pr_number.ok_or("Task has no PR")?;

    // Fetch PR status
    let pr_status = fetch_pr_status(&workspace.repo_path, pr_number)
        .map_err(|e| format!("Failed to fetch PR status: {}", e))?;

    // Update last checked timestamp
    let task = {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        db::update_siege_last_checked(&conn, &task_id)
            .map_err(|e| format!("Failed to update timestamp: {}", e))?
    };

    // Determine if we should continue
    let (should_continue, reason) = if pr_status.review_decision.as_deref() == Some("APPROVED") {
        (false, "PR has been approved!".to_string())
    } else if pr_status.state == "MERGED" {
        (false, "PR has been merged.".to_string())
    } else if pr_status.state == "CLOSED" {
        (false, "PR has been closed.".to_string())
    } else if task.siege_iteration >= task.siege_max_iterations {
        (false, format!(
            "Max iterations ({}) reached. Manual review required.",
            task.siege_max_iterations
        ))
    } else if pr_status.comments.is_empty() {
        (false, "No comments to address. Waiting for reviews.".to_string())
    } else {
        (true, format!(
            "{} comments to address. Iteration {}/{}.",
            pr_status.comments.len(),
            task.siege_iteration,
            task.siege_max_iterations
        ))
    };

    Ok(CheckSiegeResult {
        task,
        pr_status,
        should_continue,
        reason,
    })
}

/// Stop an active siege loop
#[tauri::command(rename_all = "camelCase")]
pub async fn stop_siege(
    task_id: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<Task, String> {
    let task = {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        db::stop_siege(&conn, &task_id)
            .map_err(|e| format!("Failed to stop siege: {}", e))?
    };

    // Emit siege stopped event
    let _ = app_handle.emit("siege:stopped", &SiegeEvent {
        task_id: task_id.clone(),
        event_type: "stopped".to_string(),
        iteration: task.siege_iteration,
        max_iterations: task.siege_max_iterations,
        message: "Siege loop stopped manually.".to_string(),
    });

    Ok(task)
}

/// Continue siege loop by spawning agent for next iteration
///
/// Called after agent completes to continue the loop if needed
#[tauri::command(rename_all = "camelCase")]
pub async fn continue_siege(
    task_id: String,
    env_vars: Option<HashMap<String, String>>,
    cli_path: Option<String>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
    agent_runner: State<'_, Arc<Mutex<AgentRunner>>>,
) -> Result<StartSiegeResult, String> {
    // Check current siege status first
    let check_result = check_siege_status(task_id.clone(), state.clone()).await?;

    if !check_result.should_continue {
        // Stop the siege if we shouldn't continue
        let task = {
            let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
            db::stop_siege(&conn, &task_id)
                .map_err(|e| format!("Failed to stop siege: {}", e))?
        };

        let _ = app_handle.emit("siege:complete", &SiegeEvent {
            task_id: task_id.clone(),
            event_type: "complete".to_string(),
            iteration: task.siege_iteration,
            max_iterations: task.siege_max_iterations,
            message: check_result.reason.clone(),
        });

        return Ok(StartSiegeResult {
            task,
            pr_status: check_result.pr_status,
            agent_spawned: false,
            message: check_result.reason,
        });
    }

    // Get workspace for agent spawn
    let workspace = {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        let task = db::get_task(&conn, &task_id).map_err(|e| format!("Task not found: {}", e))?;
        db::get_workspace(&conn, &task.workspace_id)
            .map_err(|e| format!("Workspace not found: {}", e))?
    };

    // Build prompt from current comments
    let prompt = build_comment_prompt(&check_result.pr_status);

    // Spawn agent for next iteration
    let session = {
        let mut runner = agent_runner
            .lock()
            .map_err(|e| format!("Agent runner lock error: {}", e))?;

        runner.start_agent_with_prompt(
            &task_id,
            "claude",
            &workspace.repo_path,
            env_vars,
            cli_path,
            &prompt,
            app_handle.clone(),
        )?
    };

    // Increment iteration counter
    let task = {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        db::increment_siege_iteration(&conn, &task_id)
            .map_err(|e| format!("Failed to increment iteration: {}", e))?
    };

    let iteration = task.siege_iteration;
    let max_iter = task.siege_max_iterations;

    let _ = app_handle.emit("siege:iteration", &SiegeEvent {
        task_id: task_id.clone(),
        event_type: "iteration".to_string(),
        iteration,
        max_iterations: max_iter,
        message: format!(
            "Siege iteration {} started. Agent spawned (pid: {:?})",
            iteration,
            session.pid
        ),
    });

    Ok(StartSiegeResult {
        task,
        pr_status: check_result.pr_status,
        agent_spawned: true,
        message: format!("Siege iteration {} started.", iteration),
    })
}

/// Get PR status without modifying siege state
#[tauri::command(rename_all = "camelCase")]
pub async fn get_pr_status(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<PrStatus, String> {
    let (task, workspace) = {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        let task = db::get_task(&conn, &task_id).map_err(|e| format!("Task not found: {}", e))?;
        let workspace = db::get_workspace(&conn, &task.workspace_id)
            .map_err(|e| format!("Workspace not found: {}", e))?;
        (task, workspace)
    };

    let pr_number = task.pr_number.ok_or("Task has no PR")?;

    fetch_pr_status(&workspace.repo_path, pr_number)
        .map_err(|e| format!("Failed to fetch PR status: {}", e))
}
