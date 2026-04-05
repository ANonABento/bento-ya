//! V2 Trigger types and execution engine.
//!
//! Handles the new unified `triggers` JSON format on columns,
//! supporting spawn_cli, move_column, trigger_task actions.

use crate::chat::bridge;
use crate::db::{self, Column, Task};
use crate::error::AppError;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

use super::template::{self, TemplateContext};
use super::{PipelineEvent, PipelineState};

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

    let _ = app.emit(
        "pipeline:triggered",
        &PipelineEvent {
            task_id: task.id.clone(),
            column_id: column.id.clone(),
            event_type: "triggered".to_string(),
            state: PipelineState::Triggered.as_str().to_string(),
            message: Some("V2 trigger fired".to_string()),
        },
    );

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

/// Execute a trigger action.
fn execute_action(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    column: &Column,
    action: &TriggerActionV2,
    other_column: Option<&Column>,
) -> Result<Task, AppError> {
    match action {
        TriggerActionV2::SpawnCli {
            cli,
            command,
            prompt_template,
            prompt,
            flags,
            use_queue: _,
            model,
        } => {
            // Build template context
            let workspace = db::get_workspace(conn, &task.workspace_id)?;

            // Validate workspace repo_path exists
            if !workspace.repo_path.is_empty() && !std::path::Path::new(&workspace.repo_path).exists() {
                log::warn!("Workspace repo_path '{}' does not exist, agent may fail", workspace.repo_path);
            }

            let ctx = TemplateContext {
                task,
                column,
                workspace: &workspace,
                prev_column: other_column,
                next_column: Option::None,
                dep_tasks: HashMap::new(),
            };

            // Resolve prompt: direct prompt wins over template
            let resolved_prompt = if let Some(p) = prompt {
                if !p.is_empty() {
                    template::interpolate(p, &ctx)
                } else if let Some(tmpl) = prompt_template {
                    template::interpolate(tmpl, &ctx)
                } else {
                    format!("{}\n\n{}", task.title, task.description.as_deref().unwrap_or(""))
                }
            } else if let Some(tmpl) = prompt_template {
                template::interpolate(tmpl, &ctx)
            } else {
                // Default prompt
                format!("{}\n\n{}", task.title, task.description.as_deref().unwrap_or(""))
            };

            let cli_type = cli.as_deref().unwrap_or("claude").to_string();

            // Build initial prompt: prepend slash command if provided
            let initial_prompt = if let Some(ref cmd) = command {
                if resolved_prompt.is_empty() {
                    cmd.clone()
                } else {
                    format!("{}\n\n{}", cmd, resolved_prompt)
                }
            } else {
                resolved_prompt
            };

            // Store resolved prompt in task
            let ts = db::now();
            if let Err(e) = conn.execute(
                "UPDATE tasks SET trigger_prompt = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![initial_prompt, ts, task.id],
            ) {
                log::warn!("Failed to store trigger prompt for task {}: {}", task.id, e);
            }

            // Set pipeline state to Running
            let updated_task = db::update_task_pipeline_state(
                conn,
                &task.id,
                PipelineState::Running.as_str(),
                Some(&ts),
                Option::None,
            )?;

            // Build env vars
            let mut env_vars = HashMap::new();
            env_vars.insert("WORKING_DIR".to_string(), workspace.repo_path.clone());
            env_vars.insert("TRIGGER_PROMPT".to_string(), initial_prompt.clone());
            if let Some(ref cmd) = command {
                env_vars.insert("TRIGGER_COMMAND".to_string(), cmd.clone());
            }
            if let Some(ref f) = flags {
                env_vars.insert("TRIGGER_FLAGS".to_string(), f.join(" "));
            }

            // Emit running event for frontend state visualization
            let _ = app.emit(
                "pipeline:running",
                &PipelineEvent {
                    task_id: task.id.clone(),
                    column_id: column.id.clone(),
                    event_type: "running".to_string(),
                    state: PipelineState::Running.as_str().to_string(),
                    message: Some(format!("CLI trigger: {}", cli_type)),
                },
            );

            // Resolve model: task override > trigger config > none (CLI default)
            let resolved_model = task.model.as_deref()
                .or(model.as_deref())
                .map(|m| m.to_string());

            let mut cli_args = Vec::new();
            if let Some(ref m) = resolved_model {
                cli_args.push("--model".to_string());
                cli_args.push(m.clone());
            }

            // Spawn background task — directly runs PTY session, monitors exit,
            // calls mark_complete. No frontend round-trip needed.
            bridge::spawn_cli_trigger_task(
                app.clone(),
                task.id.clone(),
                cli_type,
                cli_args,
                workspace.repo_path.clone(),
                initial_prompt,
                Some(env_vars),
            );

            Ok(updated_task)
        }

        TriggerActionV2::MoveColumn { target } => {
            let target_col = resolve_column_target(conn, task, target)?;
            if let Some(col) = target_col {
                let ts = db::now();
                let max_pos: i64 = conn
                    .query_row(
                        "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
                        rusqlite::params![col.id],
                        |row| row.get(0),
                    )
                    .unwrap_or(-1);

                conn.execute(
                    "UPDATE tasks SET column_id = ?1, position = ?2, pipeline_state = 'idle', updated_at = ?3 WHERE id = ?4",
                    rusqlite::params![col.id, max_pos + 1, ts, task.id],
                )
                .map_err(AppError::from)?;

                let _ = app.emit(
                    "pipeline:advanced",
                    &PipelineEvent {
                        task_id: task.id.clone(),
                        column_id: col.id.clone(),
                        event_type: "advanced".to_string(),
                        state: "idle".to_string(),
                        message: Some(format!("Moved to {}", col.name)),
                    },
                );

                let moved_task = db::get_task(conn, &task.id)?;
                // Notify frontend that tasks changed
                super::emit_tasks_changed(app, &task.workspace_id, "trigger_move_column");
                // Fire on_entry on the new column
                let _ = super::fire_trigger(conn, app, &moved_task, &col);
                return Ok(db::get_task(conn, &task.id)?);
            }
            Ok(task.clone())
        }

        TriggerActionV2::TriggerTask {
            target_task,
            action: task_action,
            target_column,
            inject_prompt,
        } => {
            // Look up target task
            if let Ok(target) = db::get_task(conn, target_task) {
                match task_action.as_str() {
                    "move_column" => {
                        if let Some(col_target) = target_column {
                            let col = resolve_column_target(conn, &target, col_target)?;
                            if let Some(col) = col {
                                let ts = db::now();
                                let max_pos: i64 = conn
                                    .query_row(
                                        "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
                                        rusqlite::params![col.id],
                                        |row| row.get(0),
                                    )
                                    .unwrap_or(-1);

                                conn.execute(
                                    "UPDATE tasks SET column_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
                                    rusqlite::params![col.id, max_pos + 1, ts, target.id],
                                )
                                .map_err(AppError::from)?;
                            }
                        }
                    }
                    "unblock" => {
                        // Unblock the target task
                        conn.execute(
                            "UPDATE tasks SET blocked = 0, updated_at = ?1 WHERE id = ?2",
                            rusqlite::params![db::now(), target.id],
                        )
                        .map_err(AppError::from)?;
                    }
                    "start" => {
                        // Fire trigger on the target task's current column
                        let col = db::get_column(conn, &target.column_id)?;
                        let _ = super::fire_trigger(conn, app, &target, &col);
                    }
                    _ => {}
                }

                // Inject prompt if specified
                if let Some(inject) = inject_prompt {
                    let workspace = db::get_workspace(conn, &task.workspace_id)?;
                    let ctx = TemplateContext {
                        task,
                        column,
                        workspace: &workspace,
                        prev_column: Option::None,
                        next_column: Option::None,
                        dep_tasks: HashMap::new(),
                    };
                    let resolved = template::interpolate(inject, &ctx);
                    conn.execute(
                        "UPDATE tasks SET trigger_prompt = ?1, updated_at = ?2 WHERE id = ?3",
                        rusqlite::params![resolved, db::now(), target.id],
                    )
                    .map_err(AppError::from)?;
                }
            }
            Ok(task.clone())
        }

        TriggerActionV2::RunScript { script_id } => {
            // Load script from DB and execute steps sequentially
            let script = db::get_script(conn, script_id)
                .map_err(|_| AppError::NotFound(format!("Script '{}' not found", script_id)))?;
            let workspace = db::get_workspace(conn, &task.workspace_id)?;

            let ts = db::now();
            let updated_task = db::update_task_pipeline_state(
                conn,
                &task.id,
                PipelineState::Running.as_str(),
                Some(&ts),
                Option::None,
            )?;

            let _ = app.emit(
                "pipeline:running",
                &PipelineEvent {
                    task_id: task.id.clone(),
                    column_id: column.id.clone(),
                    event_type: "running".to_string(),
                    state: PipelineState::Running.as_str().to_string(),
                    message: Some(format!("Running script: {}", script.name)),
                },
            );

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
                            .unwrap_or_else(|| workspace.repo_path.clone());
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
                        work_dir: workspace.repo_path.clone(),
                        continue_on_error: true,
                        fail_message: None,
                    },
                }
            }).collect();

            let task_id = task.id.clone();
            let app_handle = app.clone();
            let column_id = column.id.clone();
            let workspace_path = workspace.repo_path.clone();

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
                if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                    let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                    let _ = super::mark_complete(&conn, &app_handle, &task_id, success);
                }
            });

            Ok(updated_task)
        }

        TriggerActionV2::None => Ok(task.clone()),
    }
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
