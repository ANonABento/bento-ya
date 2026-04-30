use crate::db::{self, AppState};
use crate::error::AppError;
use rusqlite::Error as SqlError;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::process::Command;
use tauri::State;

/// PR status response from GitHub API (via gh cli)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrStatusResponse {
    pub task_id: String,
    pub pr_number: i64,
    pub mergeable: String,           // "mergeable", "conflicted", "unknown"
    pub ci_status: String,           // "pending", "success", "failure", "error"
    pub review_decision: Option<String>, // "APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"
    pub comment_count: i64,
    pub is_draft: bool,
    pub labels: Vec<String>,
    pub head_sha: String,
    pub state: String,               // "OPEN", "CLOSED", "MERGED"
}

/// Fetch PR status from GitHub using gh CLI
/// Returns merged status info for a task's PR
#[tauri::command]
pub async fn fetch_pr_status(
    state: State<'_, AppState>,
    task_id: String,
    repo_path: String,
) -> Result<PrStatusResponse, AppError> {
    // Get task to find PR number
    let task = {
        let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
        db::get_task(&conn, &task_id)?
    };

    let pr_number = task.pr_number.ok_or_else(|| {
        AppError::InvalidInput("Task has no PR number".to_string())
    })?;

    // Use gh CLI to fetch PR status (handles auth automatically)
    let output = Command::new("gh")
        .args([
            "pr", "view",
            &pr_number.to_string(),
            "--json", "mergeable,state,reviewDecision,comments,isDraft,labels,headRefOid,statusCheckRollup",
        ])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| AppError::CommandError(format!("Failed to run gh: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::CommandError(format!("gh pr view failed: {}", stderr)));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let gh_response: GhPrResponse = serde_json::from_str(&json_str)
        .map_err(|e| AppError::CommandError(format!("Failed to parse gh response: {}", e)))?;

    // Map GitHub values to our simplified statuses
    let mergeable = match gh_response.mergeable.as_deref() {
        Some("MERGEABLE") => "mergeable",
        Some("CONFLICTING") => "conflicted",
        _ => "unknown",
    }.to_string();

    let ci_status = determine_ci_status(&gh_response.status_check_rollup);

    let review_decision = gh_response.review_decision.clone();

    let labels: Vec<String> = gh_response.labels
        .iter()
        .map(|l| l.name.clone())
        .collect();

    let comment_count = gh_response.comments.len() as i64;

    // Update task in database
    {
        let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
        db::update_task_pr_status(
            &conn,
            &task_id,
            Some(&mergeable),
            Some(&ci_status),
            review_decision.as_deref(),
            Some(comment_count),
            Some(gh_response.is_draft),
            Some(&serde_json::to_string(&labels).unwrap_or_else(|_| "[]".to_string())),
            Some(&gh_response.head_ref_oid),
        )?;
    }

    Ok(PrStatusResponse {
        task_id,
        pr_number,
        mergeable,
        ci_status,
        review_decision,
        comment_count,
        is_draft: gh_response.is_draft,
        labels,
        head_sha: gh_response.head_ref_oid,
        state: gh_response.state,
    })
}

/// Batch fetch PR status for multiple tasks
#[tauri::command]
pub async fn fetch_pr_status_batch(
    state: State<'_, AppState>,
    task_ids: Vec<String>,
    repo_path: String,
) -> Result<Vec<PrStatusResponse>, AppError> {
    let mut results = Vec::new();

    for task_id in task_ids {
        match fetch_pr_status(state.clone(), task_id, repo_path.clone()).await {
            Ok(status) => results.push(status),
            Err(_) => continue, // Skip tasks that fail
        }
    }

    Ok(results)
}

/// Check if PR status needs refresh based on last fetch time
#[tauri::command]
pub fn should_refresh_pr_status(
    state: State<AppState>,
    task_id: String,
    max_age_seconds: i64,
) -> Result<bool, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let task = db::get_task(&conn, &task_id)?;

    // No PR number means no status to refresh
    if task.pr_number.is_none() {
        return Ok(false);
    }

    // Never fetched = needs refresh
    let last_fetched = match task.pr_last_fetched {
        Some(ts) => ts,
        None => return Ok(true),
    };

    // Check if last fetch is older than max_age_seconds
    let last_time = chrono::DateTime::parse_from_rfc3339(&last_fetched)
        .map_err(|e| AppError::InvalidInput(format!("Invalid timestamp: {}", e)))?;
    let now = chrono::Utc::now();
    let age = now.signed_duration_since(last_time.with_timezone(&chrono::Utc));

    Ok(age.num_seconds() > max_age_seconds)
}

// ─── GitHub Issues Sync commands ────────────────────────────────────────────

/// Result from a GitHub issues sync run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubSyncResult {
    pub issues_fetched: usize,
    pub tasks_created: usize,
    pub issues_commented: usize,
    pub prs_linked: usize,
}

/// Last-sync metadata for a workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubSyncStateResponse {
    pub workspace_id: String,
    pub last_synced_at: Option<String>,
}

/// Sync GitHub issues for a workspace immediately.
///
/// Fetches open issues, creates tasks for new ones, posts done-comments, and links PRs.
#[tauri::command]
pub async fn sync_github_issues_now(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<GithubSyncResult, AppError> {
    // 1. Read workspace config + columns (short lock)
    let (repo, label_filter, inbox_column_id, done_column_id, pr_column_id) = {
        let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let ws = db::get_workspace(&conn, &workspace_id)?;
        let config: serde_json::Value =
            serde_json::from_str(&ws.config).unwrap_or_default();

        let repo = config["githubRepo"]
            .as_str()
            .unwrap_or("")
            .to_string();
        if repo.is_empty() {
            return Err(AppError::InvalidInput(
                "GitHub repo not configured. Set githubRepo in workspace config.".to_string(),
            ));
        }

        let label_filter = config["githubLabelFilter"].as_str().unwrap_or("").to_string();
        let inbox_col = config["githubInboxColumnId"].as_str().unwrap_or("").to_string();
        let done_col = config["githubDoneColumnId"].as_str().unwrap_or("").to_string();
        let pr_col = config["githubPrColumnId"].as_str().unwrap_or("").to_string();
        (repo, label_filter, inbox_col, done_col, pr_col)
    };

    // Determine target inbox column
    let target_column_id = {
        let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let columns = db::list_columns(&conn, &workspace_id)?;
        if !inbox_column_id.is_empty() && columns.iter().any(|c| c.id == inbox_column_id) {
            inbox_column_id
        } else {
            columns
                .into_iter()
                .next()
                .map(|c| c.id)
                .ok_or_else(|| AppError::InvalidInput("Workspace has no columns".to_string()))?
        }
    };

    // 2. Fetch open issues via gh CLI (no lock held)
    let mut args = vec![
        "issue".to_string(),
        "list".to_string(),
        "--repo".to_string(),
        repo.clone(),
        "--state".to_string(),
        "open".to_string(),
        "--json".to_string(),
        "number,title,body,url".to_string(),
        "--limit".to_string(),
        "100".to_string(),
    ];
    if !label_filter.is_empty() {
        args.push("--label".to_string());
        args.push(label_filter);
    }

    let output = Command::new("gh")
        .args(&args)
        .output()
        .map_err(|e| AppError::CommandError(format!("Failed to run gh: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::CommandError(format!(
            "gh issue list failed: {}",
            stderr
        )));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let issues: Vec<GhIssue> = serde_json::from_str(&json_str).map_err(|e| {
        AppError::CommandError(format!("Failed to parse gh issue response: {}", e))
    })?;

    let issues_fetched = issues.len();

    // 3. Determine which issues are new (short lock)
    let existing: HashSet<i64> = {
        let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
        db::list_github_issue_numbers(&conn, &workspace_id)
            .unwrap_or_default()
            .into_iter()
            .collect()
    };

    // 4. Create tasks for new issues (short lock)
    let mut tasks_created = 0usize;
    {
        let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
        for issue in &issues {
            if existing.contains(&issue.number) {
                continue;
            }
            let desc = issue.body.as_deref().filter(|b| !b.is_empty()).map(|b| {
                format!(
                    "{}\n\n---\n[GitHub Issue #{}]({})",
                    b, issue.number, issue.url
                )
            });
            db::insert_task_from_github_issue(
                &conn,
                &workspace_id,
                &target_column_id,
                &issue.title,
                desc.as_deref(),
                issue.number,
            )?;
            tasks_created += 1;
        }
    }

    // 5. Post done-comments for tasks in the done column (no lock during gh call)
    let mut issues_commented = 0usize;
    if !done_column_id.is_empty() {
        let pending = {
            let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
            db::list_tasks_pending_done_comment(&conn, &workspace_id, &done_column_id)
                .unwrap_or_default()
        };
        for (task_id, issue_number) in pending {
            let ok = Command::new("gh")
                .args([
                    "issue",
                    "comment",
                    &issue_number.to_string(),
                    "--repo",
                    &repo,
                    "--body",
                    "This issue has been resolved. The task is complete.",
                ])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            if ok {
                let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
                let _ = db::set_task_github_issue_commented(&conn, &task_id);
                issues_commented += 1;
            }
        }
    }

    // 6. Post PR-link comments for tasks in the PR column that have a pr_url
    let mut prs_linked = 0usize;
    if !pr_column_id.is_empty() {
        let pending = {
            let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
            db::list_tasks_pending_pr_link(&conn, &workspace_id, &pr_column_id)
                .unwrap_or_default()
        };
        for (task_id, issue_number, pr_url) in pending {
            let body = format!("A pull request has been opened for this issue: {}", pr_url);
            let ok = Command::new("gh")
                .args([
                    "issue",
                    "comment",
                    &issue_number.to_string(),
                    "--repo",
                    &repo,
                    "--body",
                    &body,
                ])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            if ok {
                let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
                let _ = db::set_task_github_issue_pr_linked(&conn, &task_id);
                prs_linked += 1;
            }
        }
    }

    // 7. Update sync timestamp
    {
        let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let _ = db::upsert_github_sync_state(&conn, &workspace_id);
    }

    Ok(GithubSyncResult {
        issues_fetched,
        tasks_created,
        issues_commented,
        prs_linked,
    })
}

/// Return the last-sync metadata for a workspace (None if never synced).
#[tauri::command]
pub fn get_github_sync_state(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Option<GithubSyncStateResponse>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    match db::get_github_sync_state(&conn, &workspace_id) {
        Ok(s) => Ok(Some(GithubSyncStateResponse {
            workspace_id: s.workspace_id,
            last_synced_at: s.last_synced_at,
        })),
        Err(SqlError::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::DatabaseError(e.to_string())),
    }
}

// ─── Internal types for gh CLI response ─────────────────────────────────────

#[derive(Debug, Deserialize)]
struct GhIssue {
    number: i64,
    title: String,
    body: Option<String>,
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhPrResponse {
    mergeable: Option<String>,
    state: String,
    review_decision: Option<String>,
    comments: Vec<GhComment>,
    is_draft: bool,
    labels: Vec<GhLabel>,
    head_ref_oid: String,
    #[serde(default)]
    status_check_rollup: Vec<GhCheckRun>,
}

#[derive(Debug, Deserialize)]
struct GhComment {
    // We only need the count
}

#[derive(Debug, Deserialize)]
struct GhLabel {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhCheckRun {
    #[serde(default)]
    state: Option<String>,       // "SUCCESS", "FAILURE", "PENDING", etc
    #[serde(default)]
    status: Option<String>,      // "COMPLETED", "IN_PROGRESS", etc
    #[serde(default)]
    conclusion: Option<String>,  // "SUCCESS", "FAILURE", "NEUTRAL", etc
}

fn determine_ci_status(checks: &[GhCheckRun]) -> String {
    if checks.is_empty() {
        return "pending".to_string();
    }

    let mut has_pending = false;
    let mut has_failure = false;

    for check in checks {
        // Check state/status/conclusion
        let status = check.status.as_deref().unwrap_or("");
        let conclusion = check.conclusion.as_deref().unwrap_or("");
        let state = check.state.as_deref().unwrap_or("");

        // Pending checks
        if status == "IN_PROGRESS" || status == "QUEUED" || status == "PENDING" {
            has_pending = true;
        }

        // Failed checks
        if conclusion == "FAILURE" || conclusion == "ERROR" || conclusion == "TIMED_OUT" ||
           state == "FAILURE" || state == "ERROR" {
            has_failure = true;
        }
    }

    if has_failure {
        "failure".to_string()
    } else if has_pending {
        "pending".to_string()
    } else {
        "success".to_string()
    }
}
