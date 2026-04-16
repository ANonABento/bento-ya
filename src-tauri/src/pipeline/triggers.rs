//! V2 Trigger types and execution engine.
//!
//! Handles the new unified `triggers` JSON format on columns,
//! supporting spawn_cli, move_column, trigger_task actions.

use crate::chat::bridge;
use crate::db::{self, Column, Task};
use crate::error::AppError;
use crate::git::branch_manager;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

use super::template::{self, TemplateContext};
use super::{emit_pipeline, PipelineState, EVT_TRIGGERED, EVT_RUNNING, EVT_ADVANCED};

// ─── V2 Trigger Types ─────────────────────────────────────────────────────

/// V2 action types that a trigger can execute.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TriggerActionV2 {
    SpawnCli {
        #[serde(default)]
        cli: Option<String>,
        #[serde(default)]
        command: Option<String>,
        #[serde(default)]
        prompt_template: Option<String>,
        #[serde(default)]
        prompt: Option<String>,
        #[serde(default)]
        flags: Option<Vec<String>>,
        #[serde(default)]
        use_queue: Option<bool>,
        #[serde(default)]
        model: Option<String>,
    },
    MoveColumn {
        target: String,
    },
    TriggerTask {
        target_task: String,
        action: String,
        #[serde(default)]
        target_column: Option<String>,
        #[serde(default)]
        inject_prompt: Option<String>,
    },
    RunScript {
        script_id: String,
    },
    CreatePr {
        #[serde(default)]
        base_branch: Option<String>,
    },
    None,
}

/// Column-level triggers configuration (V2).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnTriggersV2 {
    pub on_entry: Option<TriggerActionV2>,
    pub on_exit: Option<TriggerActionV2>,
    pub exit_criteria: Option<ExitCriteriaV2>,
}

/// Exit criteria (V2 format).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExitCriteriaV2 {
    #[serde(rename = "type")]
    pub criteria_type: String,
    #[serde(default)]
    pub auto_advance: bool,
    #[serde(default)]
    pub timeout: Option<u64>,
    #[serde(default)]
    pub max_retries: Option<u32>,
}

/// Task-level trigger overrides.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TaskTriggerOverrides {
    #[serde(default)]
    pub on_entry: Option<serde_json::Value>,
    #[serde(default)]
    pub on_exit: Option<serde_json::Value>,
    #[serde(default)]
    pub skip_triggers: Option<bool>,
}

// ─── Resolved Script Steps (owned data for async execution) ───────────────

/// Pre-interpolated script step with all template vars resolved.
/// Owns all its data so it can be moved into tokio::spawn.
enum ResolvedStep {
    Shell {
        name: String,
        is_check: bool,
        command: String,
        work_dir: String,
        continue_on_error: bool,
        fail_message: Option<String>,
    },
    Agent {
        name: String,
        prompt: String,
        model: Option<String>,
        command: Option<String>,
    },
}

impl ResolvedStep {
    fn name(&self) -> &str {
        match self {
            ResolvedStep::Shell { name, .. } => name,
            ResolvedStep::Agent { name, .. } => name,
        }
    }

    fn step_type(&self) -> &str {
        match self {
            ResolvedStep::Shell { is_check, .. } => if *is_check { "check" } else { "bash" },
            ResolvedStep::Agent { .. } => "agent",
        }
    }
}

// ─── Trigger Resolution ────────────────────────────────────────────────────

/// Resolve the effective trigger action for a given hook (on_entry/on_exit),
/// merging column defaults with task-level overrides.
fn resolve_trigger(
    column_triggers: &ColumnTriggersV2,
    task: &Task,
    hook: &str,
) -> Option<TriggerActionV2> {
    // Parse task overrides
    let overrides: TaskTriggerOverrides = task
        .trigger_overrides
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or_default();

    // Skip if task says so
    if overrides.skip_triggers == Some(true) {
        return Option::None;
    }

    // Get base action from column
    let base = match hook {
        "on_entry" => column_triggers.on_entry.clone(),
        "on_exit" => column_triggers.on_exit.clone(),
        _ => Option::None,
    };

    let base = base?;

    // Check if it's a None action
    if matches!(base, TriggerActionV2::None) {
        return Option::None;
    }

    // Apply task override if present
    let override_value = match hook {
        "on_entry" => overrides.on_entry,
        "on_exit" => overrides.on_exit,
        _ => Option::None,
    };

    if let Some(override_json) = override_value {
        // Merge: start with base serialized, then overlay override fields
        if let Ok(mut base_value) = serde_json::to_value(&base) {
            if let Some(base_obj) = base_value.as_object_mut() {
                if let Some(override_obj) = override_json.as_object() {
                    for (k, v) in override_obj {
                        base_obj.insert(k.clone(), v.clone());
                    }
                }
            }
            if let Ok(merged) = serde_json::from_value::<TriggerActionV2>(base_value) {
                return Some(merged);
            }
        }
    }

    Some(base)
}

// ─── Trigger Execution ─────────────────────────────────────────────────────

/// Fire the on_entry trigger for a column (V2 format).
pub fn fire_on_entry(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    column: &Column,
    triggers: &ColumnTriggersV2,
    prev_column: Option<&Column>,
) -> Result<Task, AppError> {
    let action = match resolve_trigger(triggers, task, "on_entry") {
        Some(a) => a,
        Option::None => return Ok(task.clone()),
    };

    let ts = db::now();

    // Set pipeline state to triggered
    let updated_task = db::update_task_pipeline_state(
        conn,
        &task.id,
        PipelineState::Triggered.as_str(),
        Some(&ts),
        Option::None,
    )?;

    emit_pipeline(app, EVT_TRIGGERED, &task.id, &column.id, PipelineState::Triggered, Some("V2 trigger fired".to_string()));

    execute_action(conn, app, &updated_task, column, &action, prev_column)
}

/// Fire the on_exit trigger for a column (V2 format).
pub fn fire_on_exit(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    column: &Column,
    next_column: Option<&Column>,
) -> Result<(), AppError> {
    // Parse V2 triggers
    let triggers: ColumnTriggersV2 = column
        .triggers
        .as_deref()
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or(ColumnTriggersV2 {
            on_entry: Option::None,
            on_exit: Option::None,
            exit_criteria: Option::None,
        });

    let action = match resolve_trigger(&triggers, task, "on_exit") {
        Some(a) => a,
        Option::None => return Ok(()),
    };

    let _ = execute_action(conn, app, task, column, &action, next_column);

    // Check dependents after exit
    let _ = super::dependencies::check_dependents(conn, app, task);

    Ok(())
}

/// Execute a trigger action — dispatches to per-action handler.
fn execute_action(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    column: &Column,
    action: &TriggerActionV2,
    other_column: Option<&Column>,
) -> Result<Task, AppError> {
    match action {
        TriggerActionV2::SpawnCli { cli, command, prompt_template, prompt, flags, use_queue: _, model } => {
            execute_spawn_cli(conn, app, task, column, other_column, cli.as_deref(), command.as_deref(), prompt_template.as_deref(), prompt.as_deref(), flags.as_deref(), model.as_deref())
        }
        TriggerActionV2::MoveColumn { target } => {
            execute_move_column(conn, app, task, target)
        }
        TriggerActionV2::TriggerTask { target_task, action: task_action, target_column, inject_prompt } => {
            execute_trigger_task(conn, app, task, column, target_task, task_action, target_column.as_deref(), inject_prompt.as_deref())
        }
        TriggerActionV2::RunScript { script_id } => {
            execute_run_script(conn, app, task, column, other_column, script_id)
        }
        TriggerActionV2::CreatePr { base_branch } => {
            execute_create_pr(conn, app, task, column, base_branch.as_deref())
        }
        TriggerActionV2::None => Ok(task.clone()),
    }
}

/// Resolve working directory for a task: worktree_path (if set and exists) > workspace.repo_path.
fn resolve_working_dir(task: &Task, workspace_repo_path: &str) -> String {
    if let Some(ref wt) = task.worktree_path {
        if !wt.is_empty() && std::path::Path::new(wt).exists() {
            return wt.clone();
        }
    }
    workspace_repo_path.to_string()
}

/// Auto-create a branch + worktree for a task if missing.
/// Returns the updated task with `branch_name` and `worktree_path` set.
fn ensure_task_worktree(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    repo_path: &str,
) -> Result<Task, AppError> {
    let mut task = task.clone();

    // Step 1: Ensure task has a branch
    if task.branch_name.as_deref().unwrap_or("").is_empty() {
        let slug = branch_manager::slugify(&task.title);
        match branch_manager::create_task_branch(repo_path, &slug, None) {
            Ok(branch_name) => {
                task = db::update_task_branch(conn, &task.id, Some(&branch_name))?;
                log::info!("[triggers] Auto-created branch '{}' for task {}", branch_name, task.id);
            }
            Err(e) => {
                // Branch may already exist (e.g. from a previous attempt)
                let branch_name = format!("bentoya/{}", slug);
                log::warn!("[triggers] Branch creation failed ({}), trying existing '{}'", e, branch_name);
                task = db::update_task_branch(conn, &task.id, Some(&branch_name))?;
            }
        }
    }

    let branch_name = task.branch_name.as_deref().unwrap_or("");
    if branch_name.is_empty() {
        log::warn!("[triggers] Could not determine branch for task {}, skipping worktree", task.id);
        return Ok(task);
    }

    // Step 2: Create worktree
    match branch_manager::create_task_worktree(repo_path, branch_name, &task.id) {
        Ok(wt_path) => {
            task = db::update_task_worktree_path(conn, &task.id, Some(&wt_path))?;
            super::emit_tasks_changed(app, &task.workspace_id, "worktree_auto_created");
            log::info!("[triggers] Auto-created worktree at '{}' for task {}", wt_path, task.id);
        }
        Err(e) => {
            log::error!("[triggers] Failed to create worktree for task {}: {}", task.id, e);
            // Continue without worktree — agent falls back to repo root
        }
    }

    Ok(task)
}

// ─── Per-Action Handlers ──────────────────────────────────────────────────

fn execute_spawn_cli(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    column: &Column,
    other_column: Option<&Column>,
    cli: Option<&str>,
    command: Option<&str>,
    prompt_template: Option<&str>,
    prompt: Option<&str>,
    flags: Option<&[String]>,
    model: Option<&str>,
) -> Result<Task, AppError> {
    let workspace = db::get_workspace(conn, &task.workspace_id)?;

    // Auto-create worktree for trigger-spawned agents to sandbox them
    let task = if task.worktree_path.is_none() && !workspace.repo_path.is_empty() {
        ensure_task_worktree(conn, app, task, &workspace.repo_path)?
    } else {
        task.clone()
    };

    let working_dir = resolve_working_dir(&task, &workspace.repo_path);

    if !working_dir.is_empty() && !std::path::Path::new(&working_dir).exists() {
        log::warn!("Working dir '{}' does not exist, agent may fail", working_dir);
    }

    // Write .task.md to worktree — agent reads this instead of getting full spec in prompt
    if !working_dir.is_empty() {
        let task_md_path = std::path::Path::new(&working_dir).join(".task.md");
        let checklist_section = task.checklist.as_deref()
            .filter(|c| !c.is_empty() && *c != "[]")
            .map(|c| format!("\n## Checklist\n{}\n", c))
            .unwrap_or_default();

        let task_md = format!(
            "# {}\n\n{}\n{}\n## Context\n- Workspace: {}\n- Branch: {}\n- Working dir: {}\n",
            task.title,
            task.description.as_deref().unwrap_or(""),
            checklist_section,
            workspace.name,
            task.branch_name.as_deref().unwrap_or("(none)"),
            working_dir,
        );

        if let Err(e) = std::fs::write(&task_md_path, &task_md) {
            log::warn!("Failed to write .task.md for task {}: {}", task.id, e);
        }

        // Exclude .task.md from git (avoid agent committing it)
        let exclude_path = std::path::Path::new(&working_dir).join(".git").join("info").join("exclude");
        if exclude_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&exclude_path) {
                if !content.contains(".task.md") {
                    let _ = std::fs::write(&exclude_path, format!("{}\n.task.md\n.task-handoff.md\n", content.trim_end()));
                }
            }
        }
    }

    let ctx = TemplateContext {
        task: &task, column, workspace: &workspace,
        prev_column: other_column, next_column: Option::None, dep_tasks: HashMap::new(),
    };

    // Resolve prompt: direct prompt > template > .task.md pointer (token-optimized default)
    let resolved_prompt = if let Some(p) = prompt {
        if !p.is_empty() { template::interpolate(p, &ctx) }
        else if let Some(tmpl) = prompt_template { template::interpolate(tmpl, &ctx) }
        else { format!("{}\n\nSee .task.md for full spec.", task.title) }
    } else if let Some(tmpl) = prompt_template {
        template::interpolate(tmpl, &ctx)
    } else {
        format!("{}\n\nSee .task.md for full spec.", task.title)
    };

    // Resolve CLI and model from workspace config (both use the same parsed value)
    let workspace_config: serde_json::Value = serde_json::from_str(&workspace.config).unwrap_or_default();

    // Resolve CLI: trigger config > workspace default > "claude"
    let ws_default_cli = workspace_config.get("defaultAgentCli").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let cli_type = cli.or(ws_default_cli).unwrap_or("claude").to_string();

    // Resolve model: task override > trigger config > workspace default > none
    let ws_default_model = workspace_config.get("defaultModel").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let resolved_model = task.model.as_deref().or(model).or(ws_default_model).map(|m| m.to_string());
    // Resolve CLI: trigger config > workspace config > global settings
    let cli_type = cli.map(|c| c.to_string()).unwrap_or_else(|| {
        let settings = crate::config::AppSettings::load();
        settings.resolve_with_workspace(
            Some(&workspace.config),
            "default_agent_cli",
        ).unwrap_or_else(|| settings.default_agent_cli.clone())
    });

    // Prepend slash command if provided
    let initial_prompt = match command {
        Some(cmd) if resolved_prompt.is_empty() => cmd.to_string(),
        Some(cmd) => format!("{}\n\n{}", cmd, resolved_prompt),
        None => resolved_prompt,
    };

    // Store resolved prompt
    let ts = db::now();
    if let Err(e) = conn.execute(
        "UPDATE tasks SET trigger_prompt = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![initial_prompt, ts, task.id],
    ) {
        log::warn!("Failed to store trigger prompt for task {}: {}", task.id, e);
    }

    let updated_task = db::update_task_pipeline_state(
        conn, &task.id, PipelineState::Running.as_str(), Some(&ts), Option::None,
    )?;

    // Build env vars
    let mut env_vars = HashMap::new();
    env_vars.insert("WORKING_DIR".to_string(), working_dir.clone());
    env_vars.insert("TRIGGER_PROMPT".to_string(), initial_prompt.clone());
    if let Some(cmd) = command {
        env_vars.insert("TRIGGER_COMMAND".to_string(), cmd.to_string());
    }
    if let Some(f) = flags {
        env_vars.insert("TRIGGER_FLAGS".to_string(), f.join(" "));
    }

    emit_pipeline(app, EVT_RUNNING, &task.id, &column.id, PipelineState::Running, Some(format!("CLI trigger: {}", cli_type)));

    // Resolve model: task override > trigger config > workspace config > global settings
    let resolved_model = task.model.as_deref().or(model).map(|m| m.to_string()).or_else(|| {
        let settings = crate::config::AppSettings::load();
        let m = settings.resolve_with_workspace(Some(&workspace.config), "default_model")
            .unwrap_or_else(|| settings.default_model.clone());
        if m.is_empty() { None } else { Some(m) }
    });
    let mut cli_args = Vec::new();
    if let Some(ref m) = resolved_model {
        cli_args.push("--model".to_string());
        cli_args.push(m.clone());
    }

    bridge::spawn_cli_trigger_task(
        app.clone(), task.id.clone(), cli_type, cli_args,
        working_dir, initial_prompt, Some(env_vars),
    );

    Ok(updated_task)
}

fn execute_move_column(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    target: &str,
) -> Result<Task, AppError> {
    let target_col = resolve_column_target(conn, task, target)?;
    if let Some(col) = target_col {
        let ts = db::now();
        let max_pos: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
                rusqlite::params![col.id], |row| row.get(0),
            )
            .unwrap_or(-1);

        conn.execute(
            "UPDATE tasks SET column_id = ?1, position = ?2, pipeline_state = 'idle', updated_at = ?3 WHERE id = ?4",
            rusqlite::params![col.id, max_pos + 1, ts, task.id],
        ).map_err(AppError::from)?;

        emit_pipeline(app, EVT_ADVANCED, &task.id, &col.id, PipelineState::Idle, Some(format!("Moved to {}", col.name)));

        let moved_task = db::get_task(conn, &task.id)?;
        super::emit_tasks_changed(app, &task.workspace_id, "trigger_move_column");
        let _ = super::fire_trigger(conn, app, &moved_task, &col);
        return Ok(db::get_task(conn, &task.id)?);
    }
    Ok(task.clone())
}

fn execute_trigger_task(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    column: &Column,
    target_task_id: &str,
    task_action: &str,
    target_column: Option<&str>,
    inject_prompt: Option<&str>,
) -> Result<Task, AppError> {
    if let Ok(target) = db::get_task(conn, target_task_id) {
        match task_action {
            "move_column" => {
                if let Some(col_target) = target_column {
                    if let Some(col) = resolve_column_target(conn, &target, col_target)? {
                        let ts = db::now();
                        let max_pos: i64 = conn
                            .query_row(
                                "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
                                rusqlite::params![col.id], |row| row.get(0),
                            )
                            .unwrap_or(-1);
                        conn.execute(
                            "UPDATE tasks SET column_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
                            rusqlite::params![col.id, max_pos + 1, ts, target.id],
                        ).map_err(AppError::from)?;
                    }
                }
            }
            "unblock" => {
                conn.execute(
                    "UPDATE tasks SET blocked = 0, updated_at = ?1 WHERE id = ?2",
                    rusqlite::params![db::now(), target.id],
                ).map_err(AppError::from)?;
            }
            "start" => {
                let col = db::get_column(conn, &target.column_id)?;
                let _ = super::fire_trigger(conn, app, &target, &col);
            }
            _ => {}
        }

        // Inject prompt if specified
        if let Some(inject) = inject_prompt {
            let workspace = db::get_workspace(conn, &task.workspace_id)?;
            let ctx = TemplateContext {
                task, column, workspace: &workspace,
                prev_column: Option::None, next_column: Option::None, dep_tasks: HashMap::new(),
            };
            let resolved = template::interpolate(inject, &ctx);
            conn.execute(
                "UPDATE tasks SET trigger_prompt = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![resolved, db::now(), target.id],
            ).map_err(AppError::from)?;
        }
    }
    Ok(task.clone())
}

fn execute_create_pr(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    column: &Column,
    base_branch: Option<&str>,
) -> Result<Task, AppError> {
    let workspace = db::get_workspace(conn, &task.workspace_id)?;

    let branch_name = match &task.branch_name {
        Some(b) if !b.is_empty() => b.clone(),
        _ => {
            return super::handle_trigger_failure(
                conn, app, task, column,
                "Cannot create PR: task has no branch_name",
            );
        }
    };

    if task.pr_number.is_some() {
        log::info!("[create_pr] Task {} already has PR #{}, skipping", task.id, task.pr_number.unwrap());
        let updated = db::update_task_pipeline_state(
            conn, &task.id, PipelineState::Idle.as_str(), None, None,
        )?;
        return Ok(updated);
    }

    let base = base_branch.unwrap_or("main").to_string();
    let pr_title = task.title.clone();
    let pr_body = task.description.clone().unwrap_or_default();
    let repo_path = resolve_working_dir(task, &workspace.repo_path);
    let task_id = task.id.clone();
    let column_id = column.id.clone();

    let updated_task = db::update_task_pipeline_state(
        conn, &task.id, PipelineState::Running.as_str(),
        Some(&db::now()), None,
    )?;

    emit_pipeline(app, EVT_RUNNING, &task.id, &column.id, PipelineState::Running, Some("Creating PR".to_string()));

    let app_handle = app.clone();

    tokio::spawn(async move {
        let result = tokio::task::spawn_blocking(move || -> Result<(i64, String), String> {
            // Push branch to remote first (gh pr create requires the branch to exist on remote)
            let push_output = std::process::Command::new("git")
                .args(["push", "-u", "origin", &branch_name])
                .current_dir(&repo_path)
                .output()
                .map_err(|e| format!("Failed to push branch: {}", e))?;

            if !push_output.status.success() {
                let stderr = String::from_utf8_lossy(&push_output.stderr);
                // "Everything up-to-date" is not an error
                if !stderr.contains("up-to-date") && !stderr.contains("already exists") {
                    // Fallback: force-push if regular push fails (e.g. stale remote branch)
                    // Safety: only force-push bentoya/* branches, never main/master
                    if branch_name.starts_with("bentoya/") {
                        log::warn!("[pipeline] Regular push failed, trying force-push: {}", stderr.trim());
                        let force_output = std::process::Command::new("git")
                            .args(["push", "-u", "origin", &branch_name, "--force"])
                            .current_dir(&repo_path)
                            .output()
                            .map_err(|e| format!("Failed to force-push branch: {}", e))?;
                        if !force_output.status.success() {
                            let force_stderr = String::from_utf8_lossy(&force_output.stderr);
                            return Err(format!("git push --force failed: {}", force_stderr.trim()));
                        }
                    } else {
                        return Err(format!("git push failed (force-push not allowed on '{}'): {}", branch_name, stderr.trim()));
                    }
                }
            }

            let output = std::process::Command::new("gh")
                .args([
                    "pr", "create",
                    "--title", &pr_title,
                    "--body", &pr_body,
                    "--base", &base,
                    "--head", &branch_name,
                ])
                .current_dir(&repo_path)
                .output()
                .map_err(|e| format!("Failed to run gh CLI: {}", e))?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("gh pr create failed: {}", stderr));
            }

            let stdout = String::from_utf8_lossy(&output.stdout);
            let pr_url = stdout.trim().to_string();
            let pr_number = pr_url
                .rsplit('/')
                .next()
                .and_then(|s| s.parse::<i64>().ok())
                .ok_or_else(|| format!("Failed to parse PR number from URL: {}", pr_url))?;

            Ok((pr_number, pr_url))
        }).await;

        let db_path = crate::db::db_path();
        let conn = match rusqlite::Connection::open(&db_path) {
            Ok(c) => { let _ = c.execute_batch("PRAGMA journal_mode=WAL;"); Some(c) }
            Err(e) => { log::error!("[create_pr] Failed to open DB: {}", e); None }
        };

        let success = match result {
            Ok(Ok((pr_number, pr_url))) => {
                log::info!("[create_pr] Created PR #{} for task {}: {}", pr_number, task_id, pr_url);
                if let Some(ref conn) = conn {
                    let _ = db::update_task_pr_info(conn, &task_id, Some(pr_number), Some(&pr_url));
                }
                true
            }
            Ok(Err(e)) => {
                log::error!("[create_pr] Failed for task {}: {}", task_id, e);
                let _ = app_handle.emit("pipeline:error", &super::PipelineEvent {
                    task_id: task_id.clone(),
                    column_id: column_id.clone(),
                    event_type: "error".to_string(),
                    state: PipelineState::Idle.as_str().to_string(),
                    message: Some(e),
                });
                false
            }
            Err(e) => {
                log::error!("[create_pr] Join error for task {}: {}", task_id, e);
                false
            }
        };

        // Mark complete so pipeline can advance (also emits tasks:changed)
        if let Some(conn) = conn {
            if let Err(e) = super::mark_complete(&conn, &app_handle, &task_id, success) {
                log::error!("[create_pr] mark_complete failed: {}", e);
            }
        }
    });

    Ok(updated_task)
}

fn execute_run_script(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    column: &Column,
    other_column: Option<&Column>,
    script_id: &str,
) -> Result<Task, AppError> {
            // Load script from DB and execute steps sequentially
            let script = db::get_script(conn, script_id)
                .map_err(|_| AppError::NotFound(format!("Script '{}' not found", script_id)))?;
            let workspace = db::get_workspace(conn, &task.workspace_id)?;
            let working_dir = resolve_working_dir(task, &workspace.repo_path);

            // Validate working dir exists
            if !working_dir.is_empty() && !std::path::Path::new(&working_dir).exists() {
                log::warn!("Working dir '{}' does not exist, script may fail", working_dir);
            }

            let ts = db::now();
            let updated_task = db::update_task_pipeline_state(
                conn,
                &task.id,
                PipelineState::Running.as_str(),
                Some(&ts),
                Option::None,
            )?;

            emit_pipeline(app, EVT_RUNNING, &task.id, &column.id, PipelineState::Running, Some(format!("Running script: {}", script.name)));

            // Parse steps
            let steps: Vec<serde_json::Value> = serde_json::from_str(&script.steps)
                .unwrap_or_default();

            // Pre-interpolate all template variables before moving into async block
            let ctx = TemplateContext {
                task,
                column,
                workspace: &workspace,
                prev_column: other_column,
                next_column: Option::None,
                dep_tasks: HashMap::new(),
            };

            // Resolve all steps into owned data
            let resolved_steps: Vec<ResolvedStep> = steps.iter().map(|step| {
                let step_type = step.get("type").and_then(|v| v.as_str()).unwrap_or("bash").to_string();
                let step_name = step.get("name").and_then(|v| v.as_str()).unwrap_or("Step").to_string();

                match step_type.as_str() {
                    "bash" | "check" => {
                        let command = step.get("command").and_then(|v| v.as_str()).unwrap_or("");
                        let command = template::interpolate(command, &ctx);
                        let work_dir = step.get("workDir")
                            .and_then(|v| v.as_str())
                            .map(|d| template::interpolate(d, &ctx))
                            .unwrap_or_else(|| working_dir.clone());
                        let continue_on_error = step.get("continueOnError")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let fail_message = step.get("failMessage")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());

                        ResolvedStep::Shell {
                            name: step_name,
                            is_check: step_type == "check",
                            command,
                            work_dir,
                            continue_on_error,
                            fail_message,
                        }
                    }
                    "agent" => {
                        let prompt = step.get("prompt").and_then(|v| v.as_str()).unwrap_or("");
                        let prompt = template::interpolate(prompt, &ctx);
                        let model = step.get("model").and_then(|v| v.as_str()).map(|s| s.to_string());
                        let command = step.get("command").and_then(|v| v.as_str()).map(|s| s.to_string());

                        ResolvedStep::Agent {
                            name: step_name,
                            prompt,
                            model,
                            command,
                        }
                    }
                    _ => ResolvedStep::Shell {
                        name: step_name,
                        is_check: false,
                        command: String::new(),
                        work_dir: working_dir.clone(),
                        continue_on_error: true,
                        fail_message: None,
                    },
                }
            }).collect();

            let task_id = task.id.clone();
            let app_handle = app.clone();
            let column_id = column.id.clone();
            let workspace_path = working_dir.clone();

            // Execute steps in a background task (all data is owned)
            tokio::spawn(async move {
                let mut success = true;
                let total = resolved_steps.len();

                for (i, step) in resolved_steps.iter().enumerate() {
                    let step_name = step.name();

                    // Emit progress
                    let _ = app_handle.emit(
                        "pipeline:step_progress",
                        &serde_json::json!({
                            "taskId": task_id,
                            "columnId": column_id,
                            "step": i + 1,
                            "total": total,
                            "name": step_name,
                            "type": step.step_type(),
                        }),
                    );

                    match step {
                        ResolvedStep::Shell { name, is_check, command, work_dir, continue_on_error, fail_message } => {
                            let output = tokio::process::Command::new("sh")
                                .arg("-c")
                                .arg(command)
                                .current_dir(work_dir)
                                .output()
                                .await;

                            match output {
                                Ok(out) => {
                                    let stdout = String::from_utf8_lossy(&out.stdout);
                                    let stderr = String::from_utf8_lossy(&out.stderr);
                                    log::info!(
                                        "[script:{}] Step {}/{} '{}': exit={}, stdout={} bytes",
                                        task_id, i + 1, total, name,
                                        out.status.code().unwrap_or(-1),
                                        stdout.len()
                                    );
                                    if !stderr.is_empty() {
                                        log::warn!("[script:{}] stderr: {}", task_id, stderr.chars().take(500).collect::<String>());
                                    }
                                    if !out.status.success() {
                                        if *is_check {
                                            let msg = fail_message.as_deref().unwrap_or("Check failed");
                                            log::warn!("[script:{}] Check failed: {}", task_id, msg);
                                        }
                                        if !continue_on_error {
                                            success = false;
                                            break;
                                        }
                                    }
                                }
                                Err(e) => {
                                    log::error!("[script:{}] Failed to run step '{}': {}", task_id, name, e);
                                    if !continue_on_error {
                                        success = false;
                                        break;
                                    }
                                }
                            }
                        }
                        ResolvedStep::Agent { prompt, model, command, .. } => {
                            let initial_prompt = if let Some(cmd) = command {
                                if prompt.is_empty() {
                                    cmd.clone()
                                } else {
                                    format!("{}\n\n{}", cmd, prompt)
                                }
                            } else {
                                prompt.clone()
                            };

                            let mut cli_args = Vec::new();
                            if let Some(m) = model {
                                cli_args.push("--model".to_string());
                                cli_args.push(m.clone());
                            }

                            // Spawn CLI — mark_complete called by PTY exit handler
                            bridge::spawn_cli_trigger_task(
                                app_handle.clone(),
                                task_id.clone(),
                                "claude".to_string(),
                                cli_args,
                                workspace_path.clone(),
                                initial_prompt,
                                Option::None,
                            );

                            // Agent step hands off to PTY exit handler
                            return;
                        }
                    }
                }

                // All bash/check steps done — call mark_complete
                let db_path = crate::db::db_path();
                match rusqlite::Connection::open(&db_path) {
                    Ok(conn) => {
                        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                        if let Err(e) = super::mark_complete(&conn, &app_handle, &task_id, success) {
                            log::error!("[script:{}] mark_complete failed: {}", task_id, e);
                        }
                    }
                    Err(e) => {
                        log::error!("[script:{}] Failed to open DB for mark_complete: {} — task stuck in running state", task_id, e);
                    }
                }
            });

            Ok(updated_task)
}

// Note: dependency task interpolation ({dep.<id>.title}) is handled at the
// dependency resolution level in dependencies.rs, not here.

/// Resolve a column target string ("next", "previous", or column ID) to a Column.
pub fn resolve_column_target(
    conn: &Connection,
    task: &Task,
    target: &str,
) -> Result<Option<Column>, AppError> {
    let current_col = db::get_column(conn, &task.column_id)?;

    match target {
        "next" => Ok(db::get_next_column(conn, &task.workspace_id, current_col.position)?),
        "previous" => {
            if current_col.position > 0 {
                let cols = db::list_columns(conn, &task.workspace_id)?;
                Ok(cols
                    .into_iter()
                    .find(|c| c.position == current_col.position - 1))
            } else {
                Ok(Option::None)
            }
        }
        col_id => Ok(db::get_column(conn, col_id).ok()),
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn setup() -> (rusqlite::Connection, db::Workspace, db::Column, db::Column, db::Column) {
        let conn = db::init_test().unwrap();
        let ws = db::insert_workspace(&conn, "Test", "/tmp/test").unwrap();
        let col1 = db::insert_column(&conn, &ws.id, "Backlog", 0).unwrap();
        let col2 = db::insert_column(&conn, &ws.id, "Working", 1).unwrap();
        let col3 = db::insert_column(&conn, &ws.id, "Done", 2).unwrap();
        (conn, ws, col1, col2, col3)
    }

    // ─── resolve_trigger tests ────────────────────────────────────────

    #[test]
    fn test_resolve_trigger_returns_column_action() {
        let (conn, ws, col1, _, _) = setup();
        let task = db::insert_task(&conn, &ws.id, &col1.id, "Task", None).unwrap();

        let triggers = ColumnTriggersV2 {
            on_entry: Some(TriggerActionV2::SpawnCli {
                cli: Some("claude".to_string()),
                command: None,
                prompt_template: None,
                prompt: None,
                flags: None,
                use_queue: None,
                model: None,
            }),
            on_exit: None,
            exit_criteria: None,
        };

        let result = resolve_trigger(&triggers, &task, "on_entry");
        assert!(result.is_some());
        assert!(matches!(result.unwrap(), TriggerActionV2::SpawnCli { .. }));
    }

    #[test]
    fn test_resolve_trigger_none_action_returns_none() {
        let (conn, ws, col1, _, _) = setup();
        let task = db::insert_task(&conn, &ws.id, &col1.id, "Task", None).unwrap();

        let triggers = ColumnTriggersV2 {
            on_entry: Some(TriggerActionV2::None),
            on_exit: None,
            exit_criteria: None,
        };

        let result = resolve_trigger(&triggers, &task, "on_entry");
        assert!(result.is_none());
    }

    #[test]
    fn test_resolve_trigger_no_action_returns_none() {
        let (conn, ws, col1, _, _) = setup();
        let task = db::insert_task(&conn, &ws.id, &col1.id, "Task", None).unwrap();

        let triggers = ColumnTriggersV2 {
            on_entry: None,
            on_exit: None,
            exit_criteria: None,
        };

        let result = resolve_trigger(&triggers, &task, "on_entry");
        assert!(result.is_none());
    }

    #[test]
    fn test_resolve_trigger_skip_triggers_override() {
        let (conn, ws, col1, _, _) = setup();
        let task = db::insert_task(&conn, &ws.id, &col1.id, "Task", None).unwrap();

        // Set skip_triggers on the task
        conn.execute(
            "UPDATE tasks SET trigger_overrides = ?1 WHERE id = ?2",
            rusqlite::params![r#"{"skip_triggers": true}"#, task.id],
        ).unwrap();
        let task = db::get_task(&conn, &task.id).unwrap();

        let triggers = ColumnTriggersV2 {
            on_entry: Some(TriggerActionV2::SpawnCli {
                cli: Some("claude".to_string()),
                command: None,
                prompt_template: None,
                prompt: None,
                flags: None,
                use_queue: None,
                model: None,
            }),
            on_exit: None,
            exit_criteria: None,
        };

        let result = resolve_trigger(&triggers, &task, "on_entry");
        assert!(result.is_none(), "skip_triggers should suppress the trigger");
    }

    #[test]
    fn test_resolve_trigger_task_override_merges() {
        let (conn, ws, col1, _, _) = setup();
        let task = db::insert_task(&conn, &ws.id, &col1.id, "Task", None).unwrap();

        // Override the model on the task
        conn.execute(
            "UPDATE tasks SET trigger_overrides = ?1 WHERE id = ?2",
            rusqlite::params![r#"{"on_entry": {"model": "opus"}}"#, task.id],
        ).unwrap();
        let task = db::get_task(&conn, &task.id).unwrap();

        let triggers = ColumnTriggersV2 {
            on_entry: Some(TriggerActionV2::SpawnCli {
                cli: Some("claude".to_string()),
                command: Some("/start-task".to_string()),
                prompt_template: None,
                prompt: None,
                flags: None,
                use_queue: None,
                model: Some("haiku".to_string()),
            }),
            on_exit: None,
            exit_criteria: None,
        };

        let result = resolve_trigger(&triggers, &task, "on_entry");
        assert!(result.is_some());
        if let Some(TriggerActionV2::SpawnCli { model, command, .. }) = result {
            assert_eq!(model.as_deref(), Some("opus"), "task override should win");
            assert_eq!(command.as_deref(), Some("/start-task"), "base command preserved");
        } else {
            panic!("Expected SpawnCli");
        }
    }

    #[test]
    fn test_resolve_trigger_on_exit_uses_exit_action() {
        let (conn, ws, col1, _, _) = setup();
        let task = db::insert_task(&conn, &ws.id, &col1.id, "Task", None).unwrap();

        let triggers = ColumnTriggersV2 {
            on_entry: Some(TriggerActionV2::SpawnCli {
                cli: None, command: None, prompt_template: None,
                prompt: None, flags: None, use_queue: None, model: None,
            }),
            on_exit: Some(TriggerActionV2::MoveColumn {
                target: "next".to_string(),
            }),
            exit_criteria: None,
        };

        // on_entry should return SpawnCli
        let entry = resolve_trigger(&triggers, &task, "on_entry");
        assert!(matches!(entry, Some(TriggerActionV2::SpawnCli { .. })));

        // on_exit should return MoveColumn
        let exit = resolve_trigger(&triggers, &task, "on_exit");
        assert!(matches!(exit, Some(TriggerActionV2::MoveColumn { .. })));
    }

    #[test]
    fn test_resolve_trigger_run_script() {
        let (conn, ws, col1, _, _) = setup();
        let task = db::insert_task(&conn, &ws.id, &col1.id, "Task", None).unwrap();

        let triggers = ColumnTriggersV2 {
            on_entry: Some(TriggerActionV2::RunScript {
                script_id: "code-check".to_string(),
            }),
            on_exit: None,
            exit_criteria: None,
        };

        let result = resolve_trigger(&triggers, &task, "on_entry");
        assert!(result.is_some());
        if let Some(TriggerActionV2::RunScript { script_id }) = result {
            assert_eq!(script_id, "code-check");
        } else {
            panic!("Expected RunScript");
        }
    }

    #[test]
    fn test_resolve_trigger_invalid_hook_returns_none() {
        let (conn, ws, col1, _, _) = setup();
        let task = db::insert_task(&conn, &ws.id, &col1.id, "Task", None).unwrap();

        let triggers = ColumnTriggersV2 {
            on_entry: Some(TriggerActionV2::None),
            on_exit: None,
            exit_criteria: None,
        };

        let result = resolve_trigger(&triggers, &task, "invalid_hook");
        assert!(result.is_none());
    }

    // ─── resolve_column_target tests ──────────────────────────────────

    #[test]
    fn test_resolve_column_target_next() {
        let (conn, ws, _, col2, col3) = setup();
        let task = db::insert_task(&conn, &ws.id, &col2.id, "Task", None).unwrap();

        let result = resolve_column_target(&conn, &task, "next").unwrap();
        assert!(result.is_some());
        assert_eq!(result.unwrap().name, "Done");
    }

    #[test]
    fn test_resolve_column_target_previous() {
        let (conn, ws, col1, col2, _) = setup();
        let task = db::insert_task(&conn, &ws.id, &col2.id, "Task", None).unwrap();

        let result = resolve_column_target(&conn, &task, "previous").unwrap();
        assert!(result.is_some());
        assert_eq!(result.unwrap().name, "Backlog");
    }

    #[test]
    fn test_resolve_column_target_previous_at_first_column() {
        let (conn, ws, col1, _, _) = setup();
        let task = db::insert_task(&conn, &ws.id, &col1.id, "Task", None).unwrap();

        let result = resolve_column_target(&conn, &task, "previous").unwrap();
        assert!(result.is_none(), "No previous column when at position 0");
    }

    #[test]
    fn test_resolve_column_target_next_at_last_column() {
        let (conn, ws, _, _, col3) = setup();
        let task = db::insert_task(&conn, &ws.id, &col3.id, "Task", None).unwrap();

        let result = resolve_column_target(&conn, &task, "next").unwrap();
        assert!(result.is_none(), "No next column when at last position");
    }

    #[test]
    fn test_resolve_column_target_by_id() {
        let (conn, ws, col1, _, _) = setup();
        let task = db::insert_task(&conn, &ws.id, &col1.id, "Task", None).unwrap();

        let result = resolve_column_target(&conn, &task, &col1.id).unwrap();
        assert!(result.is_some());
        assert_eq!(result.unwrap().id, col1.id);
    }

    #[test]
    fn test_resolve_column_target_invalid_id() {
        let (conn, ws, col1, _, _) = setup();
        let task = db::insert_task(&conn, &ws.id, &col1.id, "Task", None).unwrap();

        let result = resolve_column_target(&conn, &task, "nonexistent-id").unwrap();
        assert!(result.is_none());
    }

    // ─── TriggerActionV2 serde tests ──────────────────────────────────

    #[test]
    fn test_trigger_action_serde_run_script() {
        let action = TriggerActionV2::RunScript {
            script_id: "code-check".to_string(),
        };
        let json = serde_json::to_string(&action).unwrap();
        assert!(json.contains("\"type\":\"run_script\""));
        assert!(json.contains("\"script_id\":\"code-check\""));

        let parsed: TriggerActionV2 = serde_json::from_str(&json).unwrap();
        if let TriggerActionV2::RunScript { script_id } = parsed {
            assert_eq!(script_id, "code-check");
        } else {
            panic!("Expected RunScript");
        }
    }

    #[test]
    fn test_trigger_action_serde_roundtrip_all_variants() {
        let variants = vec![
            r#"{"type":"spawn_cli","cli":"claude","command":"/start-task"}"#,
            r#"{"type":"move_column","target":"next"}"#,
            r#"{"type":"run_script","script_id":"test-1"}"#,
            r#"{"type":"none"}"#,
        ];
        for json in variants {
            let parsed: TriggerActionV2 = serde_json::from_str(json).unwrap();
            let reserialized = serde_json::to_string(&parsed).unwrap();
            let reparsed: TriggerActionV2 = serde_json::from_str(&reserialized).unwrap();
            // Verify type tag survives roundtrip
            assert_eq!(
                std::mem::discriminant(&parsed),
                std::mem::discriminant(&reparsed),
            );
        }
    }

    #[test]
    fn test_column_triggers_v2_deserialize_from_frontend() {
        // This is the JSON the frontend sends when saving column config
        let json = r#"{
            "on_entry": {"type": "run_script", "script_id": "code-check"},
            "on_exit": {"type": "move_column", "target": "next"},
            "exit_criteria": {"type": "agent_complete", "auto_advance": true, "max_retries": 2}
        }"#;

        let triggers: ColumnTriggersV2 = serde_json::from_str(json).unwrap();
        assert!(matches!(triggers.on_entry, Some(TriggerActionV2::RunScript { .. })));
        assert!(matches!(triggers.on_exit, Some(TriggerActionV2::MoveColumn { .. })));
        assert!(triggers.exit_criteria.is_some());
        let exit = triggers.exit_criteria.unwrap();
        assert_eq!(exit.criteria_type, "agent_complete");
        assert!(exit.auto_advance);
        assert_eq!(exit.max_retries, Some(2));
    }

    // ─── ResolvedStep construction tests ──────────────────────────────

    #[test]
    fn test_resolved_step_from_bash_json() {
        let step_json: serde_json::Value = serde_json::from_str(
            r#"{"type": "bash", "name": "Build", "command": "npm run build", "continueOnError": true}"#
        ).unwrap();

        let step_type = step_json.get("type").and_then(|v| v.as_str()).unwrap();
        let step_name = step_json.get("name").and_then(|v| v.as_str()).unwrap();
        let command = step_json.get("command").and_then(|v| v.as_str()).unwrap();
        let continue_on_error = step_json.get("continueOnError").and_then(|v| v.as_bool()).unwrap_or(false);

        assert_eq!(step_type, "bash");
        assert_eq!(step_name, "Build");
        assert_eq!(command, "npm run build");
        assert!(continue_on_error);
    }

    #[test]
    fn test_resolved_step_from_check_json() {
        let step_json: serde_json::Value = serde_json::from_str(
            r#"{"type": "check", "name": "Lint clean", "command": "npm run lint", "failMessage": "Lint errors"}"#
        ).unwrap();

        let step_type = step_json.get("type").and_then(|v| v.as_str()).unwrap();
        let fail_message = step_json.get("failMessage").and_then(|v| v.as_str());

        assert_eq!(step_type, "check");
        assert_eq!(fail_message, Some("Lint errors"));
    }

    #[test]
    fn test_resolved_step_from_agent_json() {
        let step_json: serde_json::Value = serde_json::from_str(
            r#"{"type": "agent", "name": "Review", "prompt": "Review this code", "model": "sonnet", "command": "/code-check"}"#
        ).unwrap();

        let step_type = step_json.get("type").and_then(|v| v.as_str()).unwrap();
        let prompt = step_json.get("prompt").and_then(|v| v.as_str()).unwrap();
        let model = step_json.get("model").and_then(|v| v.as_str());
        let command = step_json.get("command").and_then(|v| v.as_str());

        assert_eq!(step_type, "agent");
        assert_eq!(prompt, "Review this code");
        assert_eq!(model, Some("sonnet"));
        assert_eq!(command, Some("/code-check"));
    }

    #[test]
    fn test_resolved_step_defaults() {
        // Step with minimal fields — should use defaults
        let step_json: serde_json::Value = serde_json::from_str(
            r#"{"type": "bash"}"#
        ).unwrap();

        let command = step_json.get("command").and_then(|v| v.as_str()).unwrap_or("");
        let name = step_json.get("name").and_then(|v| v.as_str()).unwrap_or("Step");
        let continue_on_error = step_json.get("continueOnError").and_then(|v| v.as_bool()).unwrap_or(false);

        assert_eq!(command, "");
        assert_eq!(name, "Step");
        assert!(!continue_on_error);
    }

    #[test]
    fn test_built_in_script_steps_parse() {
        // Verify all built-in script JSON actually parses
        let built_in_steps = vec![
            r#"[{"type":"bash","name":"Type check","command":"npm run type-check"},{"type":"bash","name":"Lint","command":"npm run lint"}]"#,
            r#"[{"type":"bash","name":"Run tests","command":"npm test"}]"#,
            r#"[{"type":"bash","name":"Push branch","command":"git push -u origin HEAD"},{"type":"bash","name":"Create PR","command":"gh pr create --title '{task.title}' --fill"}]"#,
            r#"[{"type":"agent","name":"Review code","prompt":"Review the changes","model":"sonnet"}]"#,
            r#"[{"type":"bash","name":"Type check","command":"npm run type-check"},{"type":"bash","name":"Tests","command":"npm test"},{"type":"check","name":"Lint clean","command":"npm run lint","failMessage":"Lint errors found"},{"type":"bash","name":"Create PR","command":"gh pr create --title '{task.title}' --fill"}]"#,
        ];

        for steps_json in built_in_steps {
            let parsed: Vec<serde_json::Value> = serde_json::from_str(steps_json)
                .expect(&format!("Failed to parse: {}", steps_json));
            assert!(!parsed.is_empty());
            for step in &parsed {
                let step_type = step.get("type").and_then(|v| v.as_str());
                assert!(step_type.is_some(), "Step missing type field");
                assert!(
                    matches!(step_type.unwrap(), "bash" | "agent" | "check"),
                    "Invalid step type: {:?}", step_type
                );
            }
        }
    }

    // ─── Exit criteria parsing tests ──────────────────────────────────

    #[test]
    fn test_exit_criteria_type_extraction() {
        // Mimics the JSON parsing in evaluate_exit_criteria
        let triggers_json = r#"{"exit_criteria": {"type": "agent_complete", "auto_advance": true}}"#;
        let parsed: serde_json::Value = serde_json::from_str(triggers_json).unwrap();
        let exit_type = parsed.get("exit_criteria")
            .and_then(|v| v.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("manual");
        assert_eq!(exit_type, "agent_complete");
    }

    #[test]
    fn test_exit_criteria_missing_defaults_to_manual() {
        let triggers_json = r#"{}"#;
        let parsed: serde_json::Value = serde_json::from_str(triggers_json).unwrap();
        let exit_type = parsed.get("exit_criteria")
            .and_then(|v| v.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("manual");
        assert_eq!(exit_type, "manual");
    }

    #[test]
    fn test_max_retries_extraction() {
        let triggers_json = r#"{"exit_criteria": {"type": "agent_complete", "max_retries": 3}}"#;
        let parsed: serde_json::Value = serde_json::from_str(triggers_json).unwrap();
        let max_retries = parsed.get("exit_criteria")
            .and_then(|v| v.get("max_retries"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        assert_eq!(max_retries, 3);
    }

    #[test]
    fn test_auto_advance_extraction() {
        let triggers_json = r#"{"exit_criteria": {"type": "script_success", "auto_advance": true}}"#;
        let parsed: serde_json::Value = serde_json::from_str(triggers_json).unwrap();
        let auto_advance = parsed.get("exit_criteria")
            .and_then(|v| v.get("auto_advance"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        assert!(auto_advance);
    }

    #[test]
    fn test_timeout_extraction() {
        let triggers_json = r#"{"exit_criteria": {"type": "time_elapsed", "timeout": 600}}"#;
        let parsed: serde_json::Value = serde_json::from_str(triggers_json).unwrap();
        let timeout = parsed.get("exit_criteria")
            .and_then(|v| v.get("timeout"))
            .and_then(|v| v.as_u64())
            .unwrap_or(300);
        assert_eq!(timeout, 600);
    }
}
