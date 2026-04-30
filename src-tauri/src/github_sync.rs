//! Background GitHub issues sync poller.
//!
//! Runs every 5 minutes. For each workspace with `githubSyncEnabled = true`,
//! fetches open issues via `gh`, creates tasks for new ones, posts done-comments,
//! and links PRs.

use crate::db;
use rusqlite::Connection;
use std::collections::HashSet;
use std::process::Command;
use tokio::time::Duration;

const POLL_INTERVAL: Duration = Duration::from_secs(300); // 5 minutes
const STARTUP_DELAY: Duration = Duration::from_secs(30);

pub fn start_github_sync() {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_DELAY).await;
        loop {
            run_sync_cycle();
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    });
}

fn run_sync_cycle() {
    let conn = match Connection::open(db::db_path()) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[github_sync] Failed to open DB: {}", e);
            return;
        }
    };
    if conn.execute_batch("PRAGMA journal_mode=WAL;").is_err() {
        return;
    }

    let workspaces = match db::list_workspaces(&conn) {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[github_sync] Failed to list workspaces: {}", e);
            return;
        }
    };

    for ws in workspaces {
        let config: serde_json::Value =
            serde_json::from_str(&ws.config).unwrap_or_default();

        if !config["githubSyncEnabled"].as_bool().unwrap_or(false) {
            continue;
        }

        let repo = match config["githubRepo"].as_str().filter(|r| !r.is_empty()) {
            Some(r) => r.to_string(),
            None => continue,
        };

        let label_filter = config["githubLabelFilter"].as_str().unwrap_or("").to_string();
        let done_column_id = config["githubDoneColumnId"].as_str().unwrap_or("").to_string();
        let pr_column_id = config["githubPrColumnId"].as_str().unwrap_or("").to_string();
        let inbox_column_id = config["githubInboxColumnId"].as_str().unwrap_or("").to_string();

        let columns = match db::list_columns(&conn, &ws.id) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let target_column_id = if !inbox_column_id.is_empty()
            && columns.iter().any(|c| c.id == inbox_column_id)
        {
            inbox_column_id
        } else {
            match columns.first() {
                Some(c) => c.id.clone(),
                None => continue,
            }
        };

        // Build gh issue list args
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

        let output = match Command::new("gh").args(&args).output() {
            Ok(o) => o,
            Err(e) => {
                eprintln!("[github_sync] gh command failed for {}: {}", repo, e);
                continue;
            }
        };

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!("[github_sync] gh issue list failed for {}: {}", repo, stderr);
            continue;
        }

        let issues: Vec<GhIssue> =
            match serde_json::from_str(&String::from_utf8_lossy(&output.stdout)) {
                Ok(i) => i,
                Err(e) => {
                    eprintln!("[github_sync] Failed to parse issues for {}: {}", repo, e);
                    continue;
                }
            };

        // Create tasks for new issues
        let existing: HashSet<i64> = db::list_github_issue_numbers(&conn, &ws.id)
            .unwrap_or_default()
            .into_iter()
            .collect();

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
            let _ = db::insert_task_from_github_issue(
                &conn,
                &ws.id,
                &target_column_id,
                &issue.title,
                desc.as_deref(),
                issue.number,
            );
        }

        // Post done-comments
        if !done_column_id.is_empty() {
            let pending = db::list_tasks_pending_done_comment(&conn, &ws.id, &done_column_id)
                .unwrap_or_default();
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
                    let _ = db::set_task_github_issue_commented(&conn, &task_id);
                }
            }
        }

        // Post PR-link comments
        if !pr_column_id.is_empty() {
            let pending =
                db::list_tasks_pending_pr_link(&conn, &ws.id, &pr_column_id).unwrap_or_default();
            for (task_id, issue_number, pr_url) in pending {
                let body = format!(
                    "A pull request has been opened for this issue: {}",
                    pr_url
                );
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
                    let _ = db::set_task_github_issue_pr_linked(&conn, &task_id);
                }
            }
        }

        let _ = db::upsert_github_sync_state(&conn, &ws.id);
    }
}

#[derive(Debug, serde::Deserialize)]
struct GhIssue {
    number: i64,
    title: String,
    body: Option<String>,
    url: String,
}
