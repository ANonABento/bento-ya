use crate::db::{self, AppState};
use crate::error::AppError;
use serde::{Deserialize, Serialize};
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

// ─── Internal types for gh CLI response ─────────────────────────────────────

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
