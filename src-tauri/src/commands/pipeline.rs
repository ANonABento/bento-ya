//! Pipeline commands for Tauri IPC

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::db::{self, AppState, Task};
use crate::error::AppError;
use crate::pipeline::{self, PipelineState};
use crate::process::agent_runner::AgentRunner;
use crate::process::pty_manager::PtyManager;
use tauri::{AppHandle, Emitter, State};

/// Mark a pipeline execution as complete
#[tauri::command]
pub fn mark_pipeline_complete(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
    success: bool,
) -> Result<Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    pipeline::mark_complete(&conn, &app, &task_id, success)
}

/// Get the pipeline state for a task
#[tauri::command]
pub fn get_pipeline_state(
    state: State<AppState>,
    task_id: String,
) -> Result<String, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let task = db::get_task(&conn, &task_id)?;
    Ok(task.pipeline_state)
}

/// Try to advance a task to the next column
#[tauri::command]
pub fn try_advance_task(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
) -> Result<Option<Task>, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let task = db::get_task(&conn, &task_id)?;
    let column = db::get_column(&conn, &task.column_id)?;
    pipeline::try_auto_advance(&conn, &app, &task, &column)
}

/// Set pipeline error state for a task
#[tauri::command]
pub fn set_pipeline_error(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
    error_message: String,
) -> Result<Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let task = db::get_task(&conn, &task_id)?;
    let column = db::get_column(&conn, &task.column_id)?;
    pipeline::handle_trigger_failure(&conn, &app, &task, &column, &error_message)
}

/// Fire agent trigger - spawns agent and links session to task
/// Called by frontend after receiving pipeline:spawn_agent event
#[tauri::command(rename_all = "camelCase")]
pub async fn fire_agent_trigger(
    task_id: String,
    agent_type: String,
    env_vars: Option<HashMap<String, String>>,
    cli_path: Option<String>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
    agent_runner: State<'_, Arc<Mutex<AgentRunner>>>,
) -> Result<Task, String> {
    // Get task and workspace to find working directory
    let (_task, workspace, column) = {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        let task = db::get_task(&conn, &task_id).map_err(|e| format!("Task not found: {}", e))?;
        let workspace = db::get_workspace(&conn, &task.workspace_id)
            .map_err(|e| format!("Workspace not found: {}", e))?;
        let column = db::get_column(&conn, &task.column_id)
            .map_err(|e| format!("Column not found: {}", e))?;
        (task, workspace, column)
    };

    let working_dir = workspace.repo_path.clone();

    // Spawn the agent via agent_runner
    let session = {
        let mut runner = agent_runner
            .lock()
            .map_err(|e| format!("Agent runner lock error: {}", e))?;

        runner.start_agent(
            &task_id,
            &agent_type,
            &working_dir,
            env_vars,
            cli_path,
            app_handle.clone(),
        )?
    };

    // Update task: set pipeline state to running and link agent session
    let updated_task = {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        let ts = db::now();

        // Update pipeline state to running
        db::update_task_pipeline_state(
            &conn,
            &task_id,
            PipelineState::Running.as_str(),
            Some(&ts),
            None,
        )
        .map_err(|e| format!("Failed to update pipeline state: {}", e))?;

        // Link agent session to task
        db::update_task_agent_session(&conn, &task_id, Some(&session.task_id))
            .map_err(|e| format!("Failed to link agent session: {}", e))?
    };

    // Emit running event
    let _ = app_handle.emit(
        "pipeline:running",
        &pipeline::PipelineEvent {
            task_id: task_id.clone(),
            column_id: column.id.clone(),
            event_type: "running".to_string(),
            state: PipelineState::Running.as_str().to_string(),
            message: Some(format!("Agent spawned: {} (pid: {:?})", agent_type, session.pid)),
        },
    );

    Ok(updated_task)
}

/// Fire CLI trigger (V2) - spawns CLI agent with resolved prompt
/// Called by frontend after receiving pipeline:spawn_cli event
#[tauri::command(rename_all = "camelCase")]
pub async fn fire_cli_trigger(
    task_id: String,
    cli_type: String,
    command: Option<String>,
    prompt: String,
    flags: Option<Vec<String>>,
    use_queue: bool,
    cli_path: Option<String>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
    agent_runner: State<'_, Arc<Mutex<AgentRunner>>>,
) -> Result<Task, String> {
    // Get task and workspace
    let (workspace, column) = {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        let task = db::get_task(&conn, &task_id).map_err(|e| format!("Task not found: {}", e))?;
        let workspace = db::get_workspace(&conn, &task.workspace_id)
            .map_err(|e| format!("Workspace not found: {}", e))?;
        let column = db::get_column(&conn, &task.column_id)
            .map_err(|e| format!("Column not found: {}", e))?;

        // Store the resolved prompt in the task's trigger_prompt field
        let ts = db::now();
        conn.execute(
            "UPDATE tasks SET trigger_prompt = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![prompt, ts, task_id],
        )
        .map_err(|e| format!("Failed to store trigger prompt: {}", e))?;

        (workspace, column)
    };

    let working_dir = workspace.repo_path.clone();

    // Build env vars with prompt and command info
    let mut env_vars = HashMap::new();
    env_vars.insert("WORKING_DIR".to_string(), working_dir.clone());
    env_vars.insert("TRIGGER_PROMPT".to_string(), prompt.clone());
    if let Some(ref cmd) = command {
        env_vars.insert("TRIGGER_COMMAND".to_string(), cmd.clone());
    }
    if let Some(ref f) = flags {
        env_vars.insert("TRIGGER_FLAGS".to_string(), f.join(" "));
    }

    let _ = use_queue; // Queue support handled by frontend

    // Spawn the agent
    let session = {
        let mut runner = agent_runner
            .lock()
            .map_err(|e| format!("Agent runner lock error: {}", e))?;

        runner.start_agent(
            &task_id,
            &cli_type,
            &working_dir,
            Some(env_vars),
            cli_path,
            app_handle.clone(),
        )?
    };

    // Update task state
    let updated_task = {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        let ts = db::now();

        db::update_task_pipeline_state(
            &conn,
            &task_id,
            PipelineState::Running.as_str(),
            Some(&ts),
            None,
        )
        .map_err(|e| format!("Failed to update pipeline state: {}", e))?;

        db::update_task_agent_session(&conn, &task_id, Some(&session.task_id))
            .map_err(|e| format!("Failed to link agent session: {}", e))?
    };

    let _ = app_handle.emit(
        "pipeline:running",
        &pipeline::PipelineEvent {
            task_id: task_id.clone(),
            column_id: column.id.clone(),
            event_type: "running".to_string(),
            state: PipelineState::Running.as_str().to_string(),
            message: Some(format!("CLI trigger spawned: {} (pid: {:?})", cli_type, session.pid)),
        },
    );

    Ok(updated_task)
}

/// Fire script trigger - spawns script via PTY and tracks exit code
/// Called by frontend after receiving pipeline:spawn_script event
#[tauri::command(rename_all = "camelCase")]
pub async fn fire_script_trigger(
    task_id: String,
    script_path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
    pty_manager: State<'_, Arc<Mutex<PtyManager>>>,
) -> Result<Task, String> {
    // Get task and workspace to find working directory
    let (task, workspace, column) = {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        let task = db::get_task(&conn, &task_id).map_err(|e| format!("Task not found: {}", e))?;
        let workspace = db::get_workspace(&conn, &task.workspace_id)
            .map_err(|e| format!("Workspace not found: {}", e))?;
        let column = db::get_column(&conn, &task.column_id)
            .map_err(|e| format!("Column not found: {}", e))?;
        (task, workspace, column)
    };

    let working_dir = workspace.repo_path.clone();

    // Build environment variables for the script
    let mut env_vars = HashMap::new();
    env_vars.insert("TASK_ID".to_string(), task_id.clone());
    env_vars.insert("WORKSPACE_PATH".to_string(), working_dir.clone());
    env_vars.insert("TASK_TITLE".to_string(), task.title.clone());

    // Parse the script path - could be a command with args
    let parts: Vec<&str> = script_path.split_whitespace().collect();
    let (command, args): (&str, Vec<String>) = if parts.is_empty() {
        return Err("Empty script path".to_string());
    } else {
        (parts[0], parts[1..].iter().map(|s| s.to_string()).collect())
    };

    // Spawn the script via PTY (use script_<task_id> as session key to avoid collision with agents)
    let session_key = format!("script_{}", task_id);
    let pid = {
        let mut mgr = pty_manager
            .lock()
            .map_err(|e| format!("PTY manager lock error: {}", e))?;

        mgr.spawn(
            &session_key,
            command,
            &args,
            Some(&working_dir),
            Some(&env_vars),
            120,
            40,
            app_handle.clone(),
        )
        .map_err(|e| format!("Failed to spawn script: {}", e))?
    };

    // Update task: set pipeline state to running and clear previous exit code
    let updated_task = {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        let ts = db::now();

        // Clear previous exit code
        db::update_task_script_exit_code(&conn, &task_id, None)
            .map_err(|e| format!("Failed to clear exit code: {}", e))?;

        // Update pipeline state to running
        db::update_task_pipeline_state(
            &conn,
            &task_id,
            PipelineState::Running.as_str(),
            Some(&ts),
            None,
        )
        .map_err(|e| format!("Failed to update pipeline state: {}", e))?
    };

    // Emit running event
    let _ = app_handle.emit(
        "pipeline:running",
        &pipeline::PipelineEvent {
            task_id: task_id.clone(),
            column_id: column.id.clone(),
            event_type: "running".to_string(),
            state: PipelineState::Running.as_str().to_string(),
            message: Some(format!("Script spawned: {} (pid: {})", script_path, pid)),
        },
    );

    Ok(updated_task)
}

/// Fire skill trigger - spawns Claude CLI and sends skill command
/// Called by frontend after receiving pipeline:spawn_skill event
#[tauri::command(rename_all = "camelCase")]
pub async fn fire_skill_trigger(
    task_id: String,
    skill_name: String,
    env_vars: Option<HashMap<String, String>>,
    cli_path: Option<String>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
    agent_runner: State<'_, Arc<Mutex<AgentRunner>>>,
) -> Result<Task, String> {
    // Get task and workspace to find working directory
    let (_task, workspace, column) = {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        let task = db::get_task(&conn, &task_id).map_err(|e| format!("Task not found: {}", e))?;
        let workspace = db::get_workspace(&conn, &task.workspace_id)
            .map_err(|e| format!("Workspace not found: {}", e))?;
        let column = db::get_column(&conn, &task.column_id)
            .map_err(|e| format!("Column not found: {}", e))?;
        (task, workspace, column)
    };

    let working_dir = workspace.repo_path.clone();

    // Build the skill prompt: /<skill_name>
    let skill_prompt = format!("/{}", skill_name);

    // Spawn the agent with initial skill prompt
    let session = {
        let mut runner = agent_runner
            .lock()
            .map_err(|e| format!("Agent runner lock error: {}", e))?;

        runner.start_agent_with_prompt(
            &task_id,
            "skill", // agent_type - mark as skill
            &working_dir,
            env_vars,
            cli_path,
            &skill_prompt,
            app_handle.clone(),
        )?
    };

    // Update task: set pipeline state to running and link agent session
    let updated_task = {
        let conn = state.db.lock().map_err(|e| format!("Database lock error: {}", e))?;
        let ts = db::now();

        // Update pipeline state to running
        db::update_task_pipeline_state(
            &conn,
            &task_id,
            PipelineState::Running.as_str(),
            Some(&ts),
            None,
        )
        .map_err(|e| format!("Failed to update pipeline state: {}", e))?;

        // Link agent session to task (reuse agent session tracking for skills)
        db::update_task_agent_session(&conn, &task_id, Some(&session.task_id))
            .map_err(|e| format!("Failed to link agent session: {}", e))?
    };

    // Emit running event
    let _ = app_handle.emit(
        "pipeline:running",
        &pipeline::PipelineEvent {
            task_id: task_id.clone(),
            column_id: column.id.clone(),
            event_type: "running".to_string(),
            state: PipelineState::Running.as_str().to_string(),
            message: Some(format!("Skill spawned: {} (pid: {:?})", skill_name, session.pid)),
        },
    );

    Ok(updated_task)
}

/// Update script exit code for a task (called when script PTY exits)
#[tauri::command(rename_all = "camelCase")]
pub fn update_script_exit_code(
    app: AppHandle,
    state: State<AppState>,
    task_id: String,
    exit_code: i64,
) -> Result<Task, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Update the exit code
    db::update_task_script_exit_code(&conn, &task_id, Some(exit_code))?;

    // Mark pipeline as complete with success based on exit code
    let success = exit_code == 0;
    pipeline::mark_complete(&conn, &app, &task_id, success)
}
