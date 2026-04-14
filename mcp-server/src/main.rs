use std::io::{self, BufRead, Write};

use chrono::Utc;
use clap::Parser;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

#[derive(Parser)]
#[command(name = "bento-mcp", about = "MCP server for bento-ya kanban board")]
struct Args {
    /// Path to bento-ya SQLite database
    #[arg(long)]
    db: Option<String>,
}

fn default_db_path() -> String {
    // Primary: ~/.bentoya/data.db (custom app data dir)
    let home = dirs::home_dir().expect("Could not determine home directory");
    let primary = home.join(".bentoya").join("data.db");
    if primary.exists() {
        return primary.to_string_lossy().to_string();
    }

    // Fallback: platform-specific Tauri data dir
    // macOS: ~/Library/Application Support/com.bento-ya.app/bento-ya.db
    let data_dir = dirs::data_dir().expect("Could not determine data directory");
    let fallback = data_dir.join("com.bento-ya.app").join("bento-ya.db");
    fallback.to_string_lossy().to_string()
}

// ---------------------------------------------------------------------------
// JSON-RPC types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct JsonRpcRequest {
    #[allow(dead_code)]
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

#[derive(Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<Value>,
}

// ---------------------------------------------------------------------------
// API bridge — proxies mutations through the Tauri app's HTTP API
// ---------------------------------------------------------------------------

/// Flush WAL to main DB after direct writes so other connections (e.g. Tauri app) see changes.
fn checkpoint_wal(conn: &Connection) {
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE);");
}

/// Read the API port from ~/.bentoya/api.port
fn read_api_port() -> Option<u16> {
    let home = dirs::home_dir()?;
    let port_str = std::fs::read_to_string(home.join(".bentoya").join("api.port")).ok()?;
    port_str.trim().parse().ok()
}

/// Check if the Bento-ya app is running and its API is reachable.
/// Verifies response body contains {"status":"ok"} to avoid false positives
/// from a different process on a stale port.
fn is_app_running() -> bool {
    let port = match read_api_port() {
        Some(p) => p,
        None => return false,
    };
    let url = format!("http://127.0.0.1:{}/api/health", port);
    match ureq::get(&url).call() {
        Ok(resp) => {
            resp.into_body()
                .read_json::<Value>()
                .ok()
                .and_then(|v| v.get("data")?.get("status")?.as_str().map(|s| s == "ok"))
                .unwrap_or(false)
        }
        Err(_) => false,
    }
}

/// Require the app to be running for mutations. Returns an error Value if not.
/// Skipped in test mode (tests use direct DB, no app needed).
fn require_app() -> Result<(), Value> {
    #[cfg(test)]
    return Ok(());

    #[cfg(not(test))]
    if is_app_running() {
        Ok(())
    } else {
        Err(json!({ "error": "Bento-ya app is not running. Start the app to use this tool." }))
    }
}

/// Call the Tauri app's HTTP API. Returns the response JSON or None if app isn't running.
fn api_call(endpoint: &str, body: &Value) -> Option<Value> {
    let port = read_api_port()?;
    let url = format!("http://127.0.0.1:{}{}", port, endpoint);
    let resp = ureq::post(&url)
        .send_json(body)
        .ok()?;
    resp.into_body().read_json().ok()
}

/// Whether to allow direct DB fallback when API is unreachable.
/// In production: false (mutations MUST go through the app API for triggers).
/// In tests: true (no app running, direct DB is fine).
fn allow_db_fallback() -> bool {
    cfg!(test)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn now() -> String {
    Utc::now().format("%Y-%m-%d %H:%M:%S%.6f+00:00").to_string()
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

fn success_response(id: Value, result: Value) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".into(),
        id,
        result: Some(result),
        error: None,
    }
}

fn error_response(id: Value, code: i64, message: &str) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".into(),
        id,
        result: None,
        error: Some(json!({ "code": code, "message": message })),
    }
}

fn tool_result(id: Value, content: &Value) -> JsonRpcResponse {
    let text = serde_json::to_string_pretty(content).unwrap_or_default();
    success_response(
        id,
        json!({
            "content": [{ "type": "text", "text": text }]
        }),
    )
}

fn tool_error(id: Value, message: &str) -> JsonRpcResponse {
    tool_result(
        id,
        &json!({ "error": message }),
    )
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

fn tool(name: &str, description: &str, input_schema: Value) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": input_schema
    })
}

fn get_tools() -> Vec<Value> {
    vec![
        tool(
            "get_workspaces",
            "List all workspaces",
            json!({ "type": "object", "properties": {} }),
        ),
        tool(
            "get_board",
            "Get full board state (columns + tasks) for a workspace",
            json!({
                "type": "object",
                "properties": {
                    "workspace": { "type": "string", "description": "Workspace name or ID" }
                },
                "required": ["workspace"]
            }),
        ),
        tool(
            "create_task",
            "Create a new task",
            json!({
                "type": "object",
                "properties": {
                    "workspace": { "type": "string", "description": "Workspace name or ID (uses first workspace if omitted)" },
                    "title": { "type": "string" },
                    "description": { "type": "string" },
                    "column": { "type": "string", "description": "Column name (default: first column)" },
                    "model": { "type": "string", "description": "AI model (opus, sonnet, haiku)" }
                },
                "required": ["title"]
            }),
        ),
        tool(
            "move_task",
            "Move a task to a different column",
            json!({
                "type": "object",
                "properties": {
                    "task": { "type": "string", "description": "Task title or ID" },
                    "column": { "type": "string", "description": "Target column name or ID" }
                },
                "required": ["task", "column"]
            }),
        ),
        tool(
            "update_task",
            "Update task title or description",
            json!({
                "type": "object",
                "properties": {
                    "task": { "type": "string", "description": "Task title or ID" },
                    "title": { "type": "string" },
                    "description": { "type": "string" }
                },
                "required": ["task"]
            }),
        ),
        tool(
            "delete_task",
            "Delete a task",
            json!({
                "type": "object",
                "properties": {
                    "task": { "type": "string", "description": "Task title or ID" }
                },
                "required": ["task"]
            }),
        ),
        tool(
            "approve_task",
            "Approve a task (quality gate)",
            json!({
                "type": "object",
                "properties": {
                    "task": { "type": "string", "description": "Task title or ID" }
                },
                "required": ["task"]
            }),
        ),
        tool(
            "reject_task",
            "Reject a task with optional reason",
            json!({
                "type": "object",
                "properties": {
                    "task": { "type": "string", "description": "Task title or ID" },
                    "reason": { "type": "string" }
                },
                "required": ["task"]
            }),
        ),
        tool(
            "add_dependency",
            "Add a dependency between tasks",
            json!({
                "type": "object",
                "properties": {
                    "task": { "type": "string", "description": "Task that will be blocked" },
                    "depends_on": { "type": "string", "description": "Task that must complete first" },
                    "condition": { "type": "string", "description": "completed (default), agent_complete, or moved_to_column", "default": "completed" }
                },
                "required": ["task", "depends_on"]
            }),
        ),
        tool(
            "remove_dependency",
            "Remove a dependency",
            json!({
                "type": "object",
                "properties": {
                    "task": { "type": "string", "description": "Task title or ID" },
                    "depends_on": { "type": "string", "description": "Blocker task title or ID to remove" }
                },
                "required": ["task", "depends_on"]
            }),
        ),
        tool(
            "mark_complete",
            "Mark a task's pipeline as complete",
            json!({
                "type": "object",
                "properties": {
                    "task": { "type": "string", "description": "Task title or ID" },
                    "success": { "type": "boolean", "default": true }
                },
                "required": ["task"]
            }),
        ),
        tool(
            "retry_task",
            "Retry a failed task (reset pipeline state and clear error)",
            json!({
                "type": "object",
                "properties": {
                    "task": { "type": "string", "description": "Task title or ID" }
                },
                "required": ["task"]
            }),
        ),
        tool(
            "create_workspace",
            "Create a new workspace pointing to a git repository",
            json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "Workspace name" },
                    "repo_path": { "type": "string", "description": "Absolute path to the git repository" }
                },
                "required": ["name", "repo_path"]
            }),
        ),
        tool(
            "create_column",
            "Create a new column in a workspace",
            json!({
                "type": "object",
                "properties": {
                    "workspace": { "type": "string", "description": "Workspace name or ID" },
                    "name": { "type": "string", "description": "Column name" },
                    "position": { "type": "integer", "description": "Position (0-based, default: append)" }
                },
                "required": ["name"]
            }),
        ),
        tool(
            "configure_triggers",
            "Configure column triggers (on_entry, exit_criteria, auto_advance, max_retries)",
            json!({
                "type": "object",
                "properties": {
                    "column": { "type": "string", "description": "Column name or ID" },
                    "workspace": { "type": "string", "description": "Workspace name or ID" },
                    "triggers": { "type": "string", "description": "Triggers JSON: {on_entry, on_exit, exit_criteria}" }
                },
                "required": ["column", "triggers"]
            }),
        ),
        tool(
            "get_task",
            "Get detailed information about a single task",
            json!({
                "type": "object",
                "properties": {
                    "task": { "type": "string", "description": "Task title or ID" }
                },
                "required": ["task"]
            }),
        ),
        tool(
            "list_scripts",
            "List all automation scripts (built-in and custom)",
            json!({ "type": "object", "properties": {} }),
        ),
        tool(
            "create_script",
            "Create a custom automation script with steps (bash, agent, check)",
            json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "Script name" },
                    "description": { "type": "string", "description": "What the script does" },
                    "steps": { "type": "string", "description": "JSON array of steps. Each step: {type:'bash',name?,command,continueOnError?} | {type:'agent',name?,prompt,model?,command?} | {type:'check',name?,command,failMessage?}" }
                },
                "required": ["name", "steps"]
            }),
        ),
        tool(
            "run_script",
            "Set a column trigger to run a script when tasks enter",
            json!({
                "type": "object",
                "properties": {
                    "script": { "type": "string", "description": "Script name or ID" },
                    "column": { "type": "string", "description": "Column name or ID" },
                    "workspace": { "type": "string", "description": "Workspace name or ID (optional if only one)" }
                },
                "required": ["script", "column"]
            }),
        ),
    ]
}

// ---------------------------------------------------------------------------
// Resolution helpers — find workspace/task/column by name or ID
// ---------------------------------------------------------------------------

/// Find workspace by name or ID. Returns (id, name).
fn find_workspace(conn: &Connection, query: &str) -> Result<(String, String), String> {
    // Exact ID match
    let mut stmt = conn
        .prepare("SELECT id, name FROM workspaces WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    if let Ok(row) = stmt.query_row(params![query], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    }) {
        return Ok(row);
    }

    // Case-insensitive exact name
    let mut stmt = conn
        .prepare("SELECT id, name FROM workspaces WHERE LOWER(name) = LOWER(?1)")
        .map_err(|e| e.to_string())?;
    if let Ok(row) = stmt.query_row(params![query], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    }) {
        return Ok(row);
    }

    // Partial name match
    let pattern = format!("%{}%", query);
    let mut stmt = conn
        .prepare("SELECT id, name FROM workspaces WHERE LOWER(name) LIKE LOWER(?1)")
        .map_err(|e| e.to_string())?;
    if let Ok(row) = stmt.query_row(params![pattern], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    }) {
        return Ok(row);
    }

    Err(format!("Workspace not found: {}", query))
}

/// Get the first workspace (fallback when none specified).
fn first_workspace(conn: &Connection) -> Result<(String, String), String> {
    conn.prepare("SELECT id, name FROM workspaces ORDER BY tab_order ASC, created_at ASC LIMIT 1")
        .map_err(|e| e.to_string())?
        .query_row([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|_| "No workspaces found".to_string())
}

/// Find task by title or ID, optionally scoped to a workspace. Returns task JSON.
fn find_task(conn: &Connection, query: &str, workspace_id: Option<&str>) -> Result<Value, String> {
    let task_row = |r: &rusqlite::Row| -> rusqlite::Result<Value> {
        Ok(json!({
            "id": r.get::<_, String>(0)?,
            "workspace_id": r.get::<_, String>(1)?,
            "column_id": r.get::<_, String>(2)?,
            "title": r.get::<_, String>(3)?,
            "description": r.get::<_, Option<String>>(4)?,
            "position": r.get::<_, i64>(5)?,
            "priority": r.get::<_, String>(6)?,
            "pipeline_state": r.get::<_, Option<String>>(7)?,
            "pipeline_error": r.get::<_, Option<String>>(8)?,
            "review_status": r.get::<_, Option<String>>(9)?,
            "blocked": r.get::<_, i64>(10)?,
            "dependencies": r.get::<_, Option<String>>(11)?,
            "retry_count": r.get::<_, i64>(12)?,
            "model": r.get::<_, Option<String>>(13)?,
            "created_at": r.get::<_, String>(14)?,
            "updated_at": r.get::<_, String>(15)?,
        }))
    };

    let select = "SELECT id, workspace_id, column_id, title, description, position, priority, \
                   pipeline_state, pipeline_error, review_status, blocked, dependencies, \
                   retry_count, model, created_at, updated_at FROM tasks";

    // Exact ID
    let sql = format!("{} WHERE id = ?1", select);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    if let Ok(row) = stmt.query_row(params![query], task_row) {
        return Ok(row);
    }

    // Case-insensitive exact title (optionally within workspace)
    if let Some(ws) = workspace_id {
        let sql = format!(
            "{} WHERE LOWER(title) = LOWER(?1) AND workspace_id = ?2",
            select
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        if let Ok(row) = stmt.query_row(params![query, ws], task_row) {
            return Ok(row);
        }
    } else {
        let sql = format!("{} WHERE LOWER(title) = LOWER(?1)", select);
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        if let Ok(row) = stmt.query_row(params![query], task_row) {
            return Ok(row);
        }
    }

    // Partial title match
    let pattern = format!("%{}%", query);
    if let Some(ws) = workspace_id {
        let sql = format!(
            "{} WHERE LOWER(title) LIKE LOWER(?1) AND workspace_id = ?2",
            select
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        if let Ok(row) = stmt.query_row(params![pattern, ws], task_row) {
            return Ok(row);
        }
    } else {
        let sql = format!("{} WHERE LOWER(title) LIKE LOWER(?1)", select);
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        if let Ok(row) = stmt.query_row(params![pattern], task_row) {
            return Ok(row);
        }
    }

    Err(format!("Task not found: {}", query))
}

/// Find column by name or ID within workspace. Returns (id, name).
fn find_column(conn: &Connection, query: &str, workspace_id: &str) -> Result<(String, String), String> {
    // Exact ID
    let mut stmt = conn
        .prepare("SELECT id, name FROM columns WHERE id = ?1 AND workspace_id = ?2")
        .map_err(|e| e.to_string())?;
    if let Ok(row) = stmt.query_row(params![query, workspace_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    }) {
        return Ok(row);
    }

    // Case-insensitive exact name
    let mut stmt = conn
        .prepare("SELECT id, name FROM columns WHERE LOWER(name) = LOWER(?1) AND workspace_id = ?2")
        .map_err(|e| e.to_string())?;
    if let Ok(row) = stmt.query_row(params![query, workspace_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    }) {
        return Ok(row);
    }

    // Partial name match
    let pattern = format!("%{}%", query);
    let mut stmt = conn
        .prepare("SELECT id, name FROM columns WHERE LOWER(name) LIKE LOWER(?1) AND workspace_id = ?2")
        .map_err(|e| e.to_string())?;
    if let Ok(row) = stmt.query_row(params![pattern, workspace_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    }) {
        return Ok(row);
    }

    Err(format!("Column not found: {}", query))
}

/// Get the first column in a workspace.
fn first_column(conn: &Connection, workspace_id: &str) -> Result<(String, String), String> {
    conn.prepare("SELECT id, name FROM columns WHERE workspace_id = ?1 ORDER BY position ASC LIMIT 1")
        .map_err(|e| e.to_string())?
        .query_row(params![workspace_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|_| "No columns found in workspace".to_string())
}

/// Get the max position for tasks in a column.
fn max_task_position(conn: &Connection, column_id: &str) -> i64 {
    conn.prepare("SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1")
        .ok()
        .and_then(|mut s| s.query_row(params![column_id], |r| r.get::<_, i64>(0)).ok())
        .unwrap_or(-1)
}

// ---------------------------------------------------------------------------
// Tool call handler
// ---------------------------------------------------------------------------

fn handle_tool_call(conn: &Connection, name: &str, args: &Value) -> Value {
    match name {
        "get_workspaces" => handle_get_workspaces(conn),
        "get_board" => handle_get_board(conn, args),
        "create_task" => handle_create_task(conn, args),
        "move_task" => handle_move_task(conn, args),
        "update_task" => handle_update_task(conn, args),
        "delete_task" => handle_delete_task(conn, args),
        "approve_task" => handle_approve_task(conn, args),
        "reject_task" => handle_reject_task(conn, args),
        "add_dependency" => handle_add_dependency(conn, args),
        "remove_dependency" => handle_remove_dependency(conn, args),
        "mark_complete" => handle_mark_complete(conn, args),
        "retry_task" => handle_retry_task(conn, args),
        "create_workspace" => handle_create_workspace(conn, args),
        "create_column" => handle_create_column(conn, args),
        "configure_triggers" => handle_configure_triggers(conn, args),
        "get_task" => handle_get_task(conn, args),
        "list_scripts" => handle_list_scripts(conn),
        "create_script" => handle_create_script(conn, args),
        "run_script" => handle_run_script(conn, args),
        _ => json!({ "error": format!("Unknown tool: {}", name) }),
    }
}

fn handle_get_workspaces(conn: &Connection) -> Value {
    let mut stmt = match conn.prepare(
        "SELECT id, name, repo_path, tab_order, is_active, config, created_at, updated_at \
         FROM workspaces ORDER BY tab_order ASC",
    ) {
        Ok(s) => s,
        Err(e) => return json!({ "error": e.to_string() }),
    };

    let rows: Vec<Value> = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "name": r.get::<_, String>(1)?,
                "repo_path": r.get::<_, String>(2)?,
                "tab_order": r.get::<_, i64>(3)?,
                "is_active": r.get::<_, i64>(4)? != 0,
                "config": r.get::<_, Option<String>>(5)?,
                "created_at": r.get::<_, String>(6)?,
                "updated_at": r.get::<_, String>(7)?,
            }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    json!({ "workspaces": rows })
}

fn handle_get_board(conn: &Connection, args: &Value) -> Value {
    let ws_query = match args.get("workspace").and_then(|v| v.as_str()) {
        Some(q) => q.to_string(),
        None => return json!({ "error": "workspace is required" }),
    };

    let (ws_id, ws_name) = match find_workspace(conn, &ws_query) {
        Ok(w) => w,
        Err(e) => return json!({ "error": e }),
    };

    // Fetch columns
    let mut col_stmt = match conn.prepare(
        "SELECT id, name, icon, position, color, visible, triggers \
         FROM columns WHERE workspace_id = ?1 ORDER BY position ASC",
    ) {
        Ok(s) => s,
        Err(e) => return json!({ "error": e.to_string() }),
    };

    let columns: Vec<Value> = col_stmt
        .query_map(params![&ws_id], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "name": r.get::<_, String>(1)?,
                "icon": r.get::<_, Option<String>>(2)?,
                "position": r.get::<_, i64>(3)?,
                "color": r.get::<_, Option<String>>(4)?,
                "visible": r.get::<_, i64>(5)? != 0,
                "triggers": r.get::<_, Option<String>>(6)?,
            }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    // Fetch tasks
    let select = "SELECT id, workspace_id, column_id, title, description, position, priority, \
                   pipeline_state, pipeline_error, review_status, blocked, dependencies, \
                   retry_count, model, created_at, updated_at FROM tasks";
    let sql = format!("{} WHERE workspace_id = ?1 ORDER BY position ASC", select);
    let mut task_stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(e) => return json!({ "error": e.to_string() }),
    };

    let tasks: Vec<Value> = task_stmt
        .query_map(params![&ws_id], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "workspace_id": r.get::<_, String>(1)?,
                "column_id": r.get::<_, String>(2)?,
                "title": r.get::<_, String>(3)?,
                "description": r.get::<_, Option<String>>(4)?,
                "position": r.get::<_, i64>(5)?,
                "priority": r.get::<_, String>(6)?,
                "pipeline_state": r.get::<_, Option<String>>(7)?,
                "pipeline_error": r.get::<_, Option<String>>(8)?,
                "review_status": r.get::<_, Option<String>>(9)?,
                "blocked": r.get::<_, i64>(10)? != 0,
                "dependencies": r.get::<_, Option<String>>(11)?,
                "retry_count": r.get::<_, i64>(12)?,
                "model": r.get::<_, Option<String>>(13)?,
                "created_at": r.get::<_, String>(14)?,
                "updated_at": r.get::<_, String>(15)?,
            }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    // Group tasks by column
    let columns_with_tasks: Vec<Value> = columns
        .into_iter()
        .map(|mut col| {
            let col_id = col["id"].as_str().unwrap_or_default().to_string();
            let col_tasks: Vec<&Value> = tasks
                .iter()
                .filter(|t| t["column_id"].as_str() == Some(&col_id))
                .collect();
            col.as_object_mut()
                .unwrap()
                .insert("tasks".into(), json!(col_tasks));
            col
        })
        .collect();

    json!({
        "workspace": { "id": ws_id, "name": ws_name },
        "columns": columns_with_tasks
    })
}

fn handle_create_task(conn: &Connection, args: &Value) -> Value {
    if let Err(e) = require_app() { return e; }
    let title = match args.get("title").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return json!({ "error": "title is required" }),
    };
    let description = args.get("description").and_then(|v| v.as_str());

    // Resolve workspace
    let (ws_id, _ws_name) = if let Some(ws_q) = args.get("workspace").and_then(|v| v.as_str()) {
        match find_workspace(conn, ws_q) {
            Ok(w) => w,
            Err(e) => return json!({ "error": e }),
        }
    } else {
        match first_workspace(conn) {
            Ok(w) => w,
            Err(e) => return json!({ "error": e }),
        }
    };

    // Resolve column
    let (col_id, col_name) = if let Some(col_q) = args.get("column").and_then(|v| v.as_str()) {
        match find_column(conn, col_q, &ws_id) {
            Ok(c) => c,
            Err(e) => return json!({ "error": e }),
        }
    } else {
        match first_column(conn, &ws_id) {
            Ok(c) => c,
            Err(e) => return json!({ "error": e }),
        }
    };

    let model = args.get("model").and_then(|v| v.as_str());

    // Route through app API (triggers pipeline + updates UI)
    if let Some(resp) = api_call("/api/create_task", &json!({
        "workspace_id": ws_id,
        "column_id": col_id,
        "title": title,
        "description": description,
    })) {
        if resp.get("success").and_then(|v| v.as_bool()) == Some(true) {
            return json!({
                "task": resp.get("data"),
                "message": format!("Created task '{}' in column '{}'", title, col_name)
            });
        }
    }

    if !allow_db_fallback() {
        return json!({ "error": "Failed to reach app API — is the app running?" });
    }

    // Test-only fallback: direct DB write
    let id = new_id();
    let ts = now();
    let position = max_task_position(conn, &col_id) + 1;
    match conn.execute(
        "INSERT INTO tasks (id, workspace_id, column_id, title, description, position, priority, \
         pipeline_state, blocked, dependencies, retry_count, model, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'medium', 'idle', 0, '[]', 0, ?7, ?8, ?8)",
        params![id, ws_id, col_id, title, description, position, model, ts],
    ) {
        Ok(_) => json!({
            "task": { "id": id, "title": title, "column": col_name },
            "message": format!("Created task '{}' in column '{}'", title, col_name)
        }),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn handle_move_task(conn: &Connection, args: &Value) -> Value {
    if let Err(e) = require_app() { return e; }
    let task_q = match args.get("task").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return json!({ "error": "task is required" }),
    };
    let col_q = match args.get("column").and_then(|v| v.as_str()) {
        Some(c) => c,
        None => return json!({ "error": "column is required" }),
    };

    let task = match find_task(conn, task_q, None) {
        Ok(t) => t,
        Err(e) => return json!({ "error": e }),
    };

    let task_id = task["id"].as_str().unwrap();
    let ws_id = task["workspace_id"].as_str().unwrap();

    let (col_id, col_name) = match find_column(conn, col_q, ws_id) {
        Ok(c) => c,
        Err(e) => return json!({ "error": e }),
    };

    let position = max_task_position(conn, &col_id) + 1;

    // Route through app API (triggers pipeline + updates UI)
    if let Some(resp) = api_call("/api/move_task", &json!({
        "id": task_id,
        "target_column_id": col_id,
        "position": position,
    })) {
        if resp.get("success").and_then(|v| v.as_bool()) == Some(true) {
            return json!({
                "task_id": task_id,
                "title": task["title"],
                "column": col_name,
                "message": format!("Moved '{}' to '{}'", task["title"].as_str().unwrap_or("?"), col_name)
            });
        }
    }

    if !allow_db_fallback() {
        return json!({ "error": "Failed to reach app API — is the app running?" });
    }

    // Test-only fallback: direct DB write
    let ts = now();
    match conn.execute(
        "UPDATE tasks SET column_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
        params![col_id, position, ts, task_id],
    ) {
        Ok(_) => json!({
            "task_id": task_id, "title": task["title"], "column": col_name,
            "message": format!("Moved '{}' to '{}'", task["title"].as_str().unwrap_or("?"), col_name)
        }),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn handle_update_task(conn: &Connection, args: &Value) -> Value {
    if let Err(e) = require_app() { return e; }
    let task_q = match args.get("task").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return json!({ "error": "task is required" }),
    };

    let task = match find_task(conn, task_q, None) {
        Ok(t) => t,
        Err(e) => return json!({ "error": e }),
    };
    let task_id = task["id"].as_str().unwrap();

    let new_title = args.get("title").and_then(|v| v.as_str());
    let new_desc = args.get("description").and_then(|v| v.as_str());

    if new_title.is_none() && new_desc.is_none() {
        return json!({ "error": "Nothing to update — provide title or description" });
    }

    let ts = now();
    let mut updates = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(t) = new_title {
        updates.push(format!("title = ?{}", param_values.len() + 1));
        param_values.push(Box::new(t.to_string()));
    }
    if let Some(d) = new_desc {
        updates.push(format!("description = ?{}", param_values.len() + 1));
        param_values.push(Box::new(d.to_string()));
    }
    updates.push(format!("updated_at = ?{}", param_values.len() + 1));
    param_values.push(Box::new(ts));

    let sql = format!(
        "UPDATE tasks SET {} WHERE id = ?{}",
        updates.join(", "),
        param_values.len() + 1
    );
    param_values.push(Box::new(task_id.to_string()));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    match conn.execute(&sql, param_refs.as_slice()) {
        Ok(_) => json!({
            "task_id": task_id,
            "title": new_title.unwrap_or(task["title"].as_str().unwrap_or("")),
            "message": "Task updated"
        }),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn handle_delete_task(conn: &Connection, args: &Value) -> Value {
    if let Err(e) = require_app() { return e; }
    let task_q = match args.get("task").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return json!({ "error": "task is required" }),
    };

    let task = match find_task(conn, task_q, None) {
        Ok(t) => t,
        Err(e) => return json!({ "error": e }),
    };
    let task_id = task["id"].as_str().unwrap();
    let title = task["title"].as_str().unwrap_or("?");

    // Route through app API (cleans up worktrees + updates UI)
    if let Some(resp) = api_call("/api/delete_task", &json!({"id": task_id})) {
        if resp.get("success").and_then(|v| v.as_bool()) == Some(true) {
            return json!({ "message": format!("Deleted task '{}'", title) });
        }
    }

    if !allow_db_fallback() {
        return json!({ "error": "Failed to reach app API — is the app running?" });
    }

    match conn.execute("DELETE FROM tasks WHERE id = ?1", params![task_id]) {
        Ok(_) => json!({ "message": format!("Deleted task '{}'", title) }),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn handle_approve_task(conn: &Connection, args: &Value) -> Value {
    if let Err(e) = require_app() { return e; }
    let task_q = match args.get("task").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return json!({ "error": "task is required" }),
    };

    let task = match find_task(conn, task_q, None) {
        Ok(t) => t,
        Err(e) => return json!({ "error": e }),
    };
    let task_id = task["id"].as_str().unwrap();

    // Route through app API (triggers auto-advance + updates UI)
    if let Some(resp) = api_call("/api/approve_task", &json!({"id": task_id})) {
        if resp.get("success").and_then(|v| v.as_bool()) == Some(true) {
            return json!({
                "task_id": task_id, "title": task["title"], "review_status": "approved",
                "message": format!("Approved task '{}'", task["title"].as_str().unwrap_or("?"))
            });
        }
    }

    if !allow_db_fallback() {
        return json!({ "error": "Failed to reach app API — is the app running?" });
    }

    let ts = now();
    match conn.execute("UPDATE tasks SET review_status = 'approved', updated_at = ?1 WHERE id = ?2", params![ts, task_id]) {
        Ok(_) => json!({ "task_id": task_id, "title": task["title"], "review_status": "approved",
            "message": format!("Approved task '{}'", task["title"].as_str().unwrap_or("?")) }),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn handle_reject_task(conn: &Connection, args: &Value) -> Value {
    if let Err(e) = require_app() { return e; }
    let task_q = match args.get("task").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return json!({ "error": "task is required" }),
    };

    let task = match find_task(conn, task_q, None) {
        Ok(t) => t,
        Err(e) => return json!({ "error": e }),
    };
    let task_id = task["id"].as_str().unwrap();
    let reason = args.get("reason").and_then(|v| v.as_str()).unwrap_or("");

    // Route through app API (updates UI)
    if let Some(resp) = api_call("/api/reject_task", &json!({"id": task_id})) {
        if resp.get("success").and_then(|v| v.as_bool()) == Some(true) {
            return json!({
                "task_id": task_id, "title": task["title"], "review_status": "rejected",
                "reason": reason, "message": format!("Rejected task '{}'", task["title"].as_str().unwrap_or("?"))
            });
        }
    }

    if !allow_db_fallback() {
        return json!({ "error": "Failed to reach app API — is the app running?" });
    }

    let ts = now();
    match conn.execute("UPDATE tasks SET review_status = 'rejected', pipeline_error = ?1, updated_at = ?2 WHERE id = ?3", params![reason, ts, task_id]) {
        Ok(_) => json!({ "task_id": task_id, "title": task["title"], "review_status": "rejected",
            "reason": reason, "message": format!("Rejected task '{}'", task["title"].as_str().unwrap_or("?")) }),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn handle_add_dependency(conn: &Connection, args: &Value) -> Value {
    let task_q = match args.get("task").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return json!({ "error": "task is required" }),
    };
    let dep_q = match args.get("depends_on").and_then(|v| v.as_str()) {
        Some(d) => d,
        None => return json!({ "error": "depends_on is required" }),
    };
    let condition = args
        .get("condition")
        .and_then(|v| v.as_str())
        .unwrap_or("completed");

    let task = match find_task(conn, task_q, None) {
        Ok(t) => t,
        Err(e) => return json!({ "error": e }),
    };
    let dep_task = match find_task(conn, dep_q, None) {
        Ok(t) => t,
        Err(e) => return json!({ "error": format!("Blocker task: {}", e) }),
    };

    let task_id = task["id"].as_str().unwrap();
    let dep_id = dep_task["id"].as_str().unwrap();

    // Parse existing dependencies
    let deps_str = task["dependencies"]
        .as_str()
        .unwrap_or("[]");
    let mut deps: Vec<Value> = serde_json::from_str(deps_str).unwrap_or_default();

    // Check for duplicate
    if deps.iter().any(|d| d["task_id"].as_str() == Some(dep_id)) {
        return json!({ "error": "Dependency already exists" });
    }

    deps.push(json!({
        "task_id": dep_id,
        "condition": condition
    }));

    let deps_json = serde_json::to_string(&deps).unwrap();
    let ts = now();
    let blocked = 1; // Has dependencies, so blocked

    match conn.execute(
        "UPDATE tasks SET dependencies = ?1, blocked = ?2, updated_at = ?3 WHERE id = ?4",
        params![deps_json, blocked, ts, task_id],
    ) {
        Ok(_) => json!({
            "task_id": task_id,
            "title": task["title"],
            "depends_on": dep_task["title"],
            "condition": condition,
            "blocked": true,
            "message": format!(
                "'{}' now depends on '{}' ({})",
                task["title"].as_str().unwrap_or("?"),
                dep_task["title"].as_str().unwrap_or("?"),
                condition
            )
        }),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn handle_remove_dependency(conn: &Connection, args: &Value) -> Value {
    let task_q = match args.get("task").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return json!({ "error": "task is required" }),
    };
    let dep_q = match args.get("depends_on").and_then(|v| v.as_str()) {
        Some(d) => d,
        None => return json!({ "error": "depends_on is required" }),
    };

    let task = match find_task(conn, task_q, None) {
        Ok(t) => t,
        Err(e) => return json!({ "error": e }),
    };
    let dep_task = match find_task(conn, dep_q, None) {
        Ok(t) => t,
        Err(e) => return json!({ "error": format!("Blocker task: {}", e) }),
    };

    let task_id = task["id"].as_str().unwrap();
    let dep_id = dep_task["id"].as_str().unwrap();

    let deps_str = task["dependencies"].as_str().unwrap_or("[]");
    let mut deps: Vec<Value> = serde_json::from_str(deps_str).unwrap_or_default();

    let before_len = deps.len();
    deps.retain(|d| d["task_id"].as_str() != Some(dep_id));

    if deps.len() == before_len {
        return json!({ "error": "Dependency not found" });
    }

    let deps_json = serde_json::to_string(&deps).unwrap();
    let blocked = if deps.is_empty() { 0 } else { 1 };
    let ts = now();

    match conn.execute(
        "UPDATE tasks SET dependencies = ?1, blocked = ?2, updated_at = ?3 WHERE id = ?4",
        params![deps_json, blocked, ts, task_id],
    ) {
        Ok(_) => json!({
            "task_id": task_id,
            "title": task["title"],
            "removed": dep_task["title"],
            "blocked": blocked != 0,
            "message": format!(
                "Removed dependency '{}' from '{}'",
                dep_task["title"].as_str().unwrap_or("?"),
                task["title"].as_str().unwrap_or("?")
            )
        }),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn handle_mark_complete(conn: &Connection, args: &Value) -> Value {
    if let Err(e) = require_app() { return e; }
    let task_q = match args.get("task").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return json!({ "error": "task is required" }),
    };
    let success = args.get("success").and_then(|v| v.as_bool()).unwrap_or(true);

    let task = match find_task(conn, task_q, None) {
        Ok(t) => t,
        Err(e) => return json!({ "error": e }),
    };
    let task_id = task["id"].as_str().unwrap();
    let ts = now();

    let new_state = if success { "completed" } else { "failed" };

    match conn.execute(
        "UPDATE tasks SET pipeline_state = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_state, ts, task_id],
    ) {
        Ok(_) => json!({
            "task_id": task_id,
            "title": task["title"],
            "pipeline_state": new_state,
            "message": format!(
                "Marked '{}' as {}",
                task["title"].as_str().unwrap_or("?"),
                new_state
            )
        }),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn handle_retry_task(conn: &Connection, args: &Value) -> Value {
    if let Err(e) = require_app() { return e; }
    let task_q = match args.get("task").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return json!({ "error": "task is required" }),
    };

    let task = match find_task(conn, task_q, None) {
        Ok(t) => t,
        Err(e) => return json!({ "error": e }),
    };
    let task_id = task["id"].as_str().unwrap();

    // Route through app API (re-fires pipeline trigger + updates UI)
    if let Some(resp) = api_call("/api/retry_task", &json!({"task_id": task_id})) {
        if resp.get("success").and_then(|v| v.as_bool()) == Some(true) {
            return json!({
                "task_id": task_id, "title": task["title"],
                "message": format!("Retrying '{}'", task["title"].as_str().unwrap_or("?"))
            });
        }
    }

    if !allow_db_fallback() {
        return json!({ "error": "Failed to reach app API — is the app running?" });
    }

    let retry_count = task["retry_count"].as_i64().unwrap_or(0) + 1;
    let ts = now();
    match conn.execute(
        "UPDATE tasks SET pipeline_state = 'idle', pipeline_error = NULL, retry_count = ?1, updated_at = ?2 WHERE id = ?3",
        params![retry_count, ts, task_id],
    ) {
        Ok(_) => json!({ "task_id": task_id, "title": task["title"], "retry_count": retry_count,
            "message": format!("Reset '{}' for retry (attempt #{})", task["title"].as_str().unwrap_or("?"), retry_count) }),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn handle_create_workspace(conn: &Connection, args: &Value) -> Value {
    let name = match args.get("name").and_then(|v| v.as_str()) {
        Some(n) => n,
        None => return json!({ "error": "name is required" }),
    };
    let repo_path = match args.get("repo_path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => return json!({ "error": "repo_path is required" }),
    };

    let id = Uuid::new_v4().to_string();
    let ts = now();

    match conn.execute(
        "INSERT INTO workspaces (id, name, repo_path, tab_order, is_active, config, created_at, updated_at) \
         VALUES (?1, ?2, ?3, 0, 1, '{}', ?4, ?5)",
        params![id, name, repo_path, ts, ts],
    ) {
        Ok(_) => {
            // Create default columns
            let columns = ["Backlog", "Working", "Review", "Done"];
            for (i, col_name) in columns.iter().enumerate() {
                let col_id = Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO columns (id, workspace_id, name, icon, position, visible, created_at, updated_at) \
                     VALUES (?1, ?2, ?3, 'list', ?4, 1, ?5, ?6)",
                    params![col_id, id, col_name, i as i64, ts, ts],
                ).ok();
            }
            checkpoint_wal(conn);
            json!({
                "message": format!("Created workspace '{}' with 4 columns", name),
                "workspace": {
                    "id": id,
                    "name": name,
                    "repo_path": repo_path,
                    "columns": columns
                }
            })
        }
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn handle_create_column(conn: &Connection, args: &Value) -> Value {
    let name = match args.get("name").and_then(|v| v.as_str()) {
        Some(n) => n,
        None => return json!({ "error": "name is required" }),
    };

    let ws_q = args.get("workspace").and_then(|v| v.as_str()).unwrap_or("");
    let workspace_id = if ws_q.is_empty() {
        // Use first workspace
        match conn.query_row("SELECT id FROM workspaces ORDER BY tab_order LIMIT 1", [], |r| r.get::<_, String>(0)) {
            Ok(id) => id,
            Err(_) => return json!({ "error": "No workspaces found" }),
        }
    } else {
        match find_workspace(conn, ws_q) {
            Ok((id, _)) => id,
            Err(e) => return json!({ "error": e }),
        }
    };

    let position = args.get("position").and_then(|v| v.as_i64()).unwrap_or_else(|| {
        conn.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM columns WHERE workspace_id = ?1",
            params![workspace_id],
            |r| r.get(0),
        ).unwrap_or(0)
    });

    let id = Uuid::new_v4().to_string();
    let ts = now();

    match conn.execute(
        "INSERT INTO columns (id, workspace_id, name, icon, position, visible, created_at, updated_at) \
         VALUES (?1, ?2, ?3, 'list', ?4, 1, ?5, ?6)",
        params![id, workspace_id, name, position, ts, ts],
    ) {
        Ok(_) => {
            checkpoint_wal(conn);
            json!({
                "message": format!("Created column '{}' at position {}", name, position),
                "column": { "id": id, "name": name, "position": position }
            })
        }
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn handle_configure_triggers(conn: &Connection, args: &Value) -> Value {
    let col_q = match args.get("column").and_then(|v| v.as_str()) {
        Some(c) => c,
        None => return json!({ "error": "column is required" }),
    };
    let triggers = match args.get("triggers").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return json!({ "error": "triggers JSON is required" }),
    };

    // Validate JSON structure
    let parsed: Value = match serde_json::from_str(triggers) {
        Ok(v) => v,
        Err(e) => return json!({ "error": format!("Invalid triggers JSON: {}", e) }),
    };

    // Validate trigger action types if present
    let valid_types = ["spawn_cli", "move_column", "trigger_task", "run_script", "create_pr", "none"];
    for key in &["on_entry", "on_exit"] {
        if let Some(action) = parsed.get(key) {
            if let Some(action_type) = action.get("type").and_then(|t| t.as_str()) {
                if !valid_types.contains(&action_type) {
                    return json!({ "error": format!("Invalid trigger type '{}' in {}. Valid types: {:?}", action_type, key, valid_types) });
                }
                if action_type == "run_script" && action.get("script_id").is_none() {
                    return json!({ "error": format!("{} has type 'run_script' but missing required 'script_id'. Use 'steps' format in Scripts, not inline triggers.", key) });
                }
            }
        }
    }

    // Find workspace for column resolution
    let ws_q = args.get("workspace").and_then(|v| v.as_str()).unwrap_or("");
    let workspace_id = if ws_q.is_empty() {
        match conn.query_row("SELECT id FROM workspaces ORDER BY tab_order LIMIT 1", [], |r| r.get::<_, String>(0)) {
            Ok(id) => id,
            Err(_) => return json!({ "error": "No workspaces found" }),
        }
    } else {
        match find_workspace(conn, ws_q) {
            Ok((id, _)) => id,
            Err(e) => return json!({ "error": e }),
        }
    };

    let (col_id, col_name) = match find_column(conn, col_q, &workspace_id) {
        Ok(c) => c,
        Err(e) => return json!({ "error": e }),
    };

    let ts = now();
    match conn.execute(
        "UPDATE columns SET triggers = ?1, updated_at = ?2 WHERE id = ?3",
        params![triggers, ts, col_id],
    ) {
        Ok(_) => {
            checkpoint_wal(conn);
            json!({
                "message": format!("Configured triggers for column '{}'", col_name),
                "column": col_name,
                "triggers": serde_json::from_str::<Value>(triggers).unwrap_or(Value::Null)
            })
        }
        Err(e) => json!({ "error": e.to_string() }),
    }
}

fn handle_get_task(conn: &Connection, args: &Value) -> Value {
    let task_q = match args.get("task").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return json!({ "error": "task is required" }),
    };

    match find_task(conn, task_q, None) {
        Ok(task) => task,
        Err(e) => json!({ "error": e }),
    }
}

// ---------------------------------------------------------------------------
// Script handlers
// ---------------------------------------------------------------------------

fn handle_list_scripts(conn: &Connection) -> Value {
    let mut stmt = match conn.prepare(
        "SELECT id, name, description, steps, is_built_in, created_at, updated_at \
         FROM scripts ORDER BY is_built_in DESC, name",
    ) {
        Ok(s) => s,
        Err(e) => return json!({ "error": e.to_string() }),
    };

    let rows: Vec<Value> = stmt
        .query_map([], |r| {
            let steps_str = r.get::<_, String>(3)?;
            let steps_parsed: Value = serde_json::from_str(&steps_str).unwrap_or(Value::Array(vec![]));
            let step_count = steps_parsed.as_array().map_or(0, |a| a.len());

            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "name": r.get::<_, String>(1)?,
                "description": r.get::<_, Option<String>>(2)?,
                "steps": steps_parsed,
                "step_count": step_count,
                "is_built_in": r.get::<_, i64>(4)? != 0,
            }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    json!({ "scripts": rows, "count": rows.len() })
}

fn handle_create_script(conn: &Connection, args: &Value) -> Value {
    let name = match args.get("name").and_then(|v| v.as_str()) {
        Some(n) => n,
        None => return json!({ "error": "name is required" }),
    };
    let description = args.get("description").and_then(|v| v.as_str()).unwrap_or("");
    let steps = match args.get("steps").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return json!({ "error": "steps is required (JSON array string)" }),
    };

    // Validate steps is valid JSON array
    match serde_json::from_str::<Vec<Value>>(steps) {
        Ok(_) => {}
        Err(e) => return json!({ "error": format!("Invalid steps JSON: {}", e) }),
    };

    let id = new_id();
    let ts = now();
    match conn.execute(
        "INSERT INTO scripts (id, name, description, steps, is_built_in, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)",
        params![id, name, description, steps, ts, ts],
    ) {
        Ok(_) => json!({
            "message": format!("Created script '{}'", name),
            "id": id,
            "name": name,
        }),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

/// Find a script by name or ID
fn find_script(conn: &Connection, query: &str) -> Result<(String, String), String> {
    // Exact ID match
    let mut stmt = conn
        .prepare("SELECT id, name FROM scripts WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    if let Ok(row) = stmt.query_row(params![query], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    }) {
        return Ok(row);
    }

    // Case-insensitive exact name
    let mut stmt = conn
        .prepare("SELECT id, name FROM scripts WHERE LOWER(name) = LOWER(?1)")
        .map_err(|e| e.to_string())?;
    if let Ok(row) = stmt.query_row(params![query], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    }) {
        return Ok(row);
    }

    // Partial name match
    let pattern = format!("%{}%", query);
    let mut stmt = conn
        .prepare("SELECT id, name FROM scripts WHERE LOWER(name) LIKE LOWER(?1)")
        .map_err(|e| e.to_string())?;
    if let Ok(row) = stmt.query_row(params![pattern], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    }) {
        return Ok(row);
    }

    Err(format!("Script '{}' not found", query))
}

fn handle_run_script(conn: &Connection, args: &Value) -> Value {
    let script_q = match args.get("script").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return json!({ "error": "script is required" }),
    };
    let col_q = match args.get("column").and_then(|v| v.as_str()) {
        Some(c) => c,
        None => return json!({ "error": "column is required" }),
    };

    let (script_id, script_name) = match find_script(conn, script_q) {
        Ok(s) => s,
        Err(e) => return json!({ "error": e }),
    };

    // Find workspace (optional)
    let workspace_id = if let Some(ws_q) = args.get("workspace").and_then(|v| v.as_str()) {
        match find_workspace(conn, ws_q) {
            Ok((id, _)) => id,
            Err(e) => return json!({ "error": e }),
        }
    } else {
        // Use first workspace
        match conn.query_row("SELECT id FROM workspaces LIMIT 1", [], |r| r.get::<_, String>(0)) {
            Ok(id) => id,
            Err(_) => return json!({ "error": "No workspaces found" }),
        }
    };

    let (col_id, col_name) = match find_column(conn, col_q, &workspace_id) {
        Ok(c) => c,
        Err(e) => return json!({ "error": e }),
    };

    // Merge with existing triggers (preserve on_exit, exit_criteria)
    let existing_triggers: Value = conn
        .query_row(
            "SELECT triggers FROM columns WHERE id = ?1",
            params![col_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(json!({}));

    let mut triggers = existing_triggers;
    if let Some(obj) = triggers.as_object_mut() {
        obj.insert("on_entry".to_string(), json!({ "type": "run_script", "script_id": script_id }));
    }

    let ts = now();
    match conn.execute(
        "UPDATE columns SET triggers = ?1, updated_at = ?2 WHERE id = ?3",
        params![triggers.to_string(), ts, col_id],
    ) {
        Ok(_) => json!({
            "message": format!("Column '{}' will now run script '{}' on entry", col_name, script_name),
            "column": col_name,
            "script": script_name,
        }),
        Err(e) => json!({ "error": e.to_string() }),
    }
}

// ---------------------------------------------------------------------------
// MCP protocol handlers
// ---------------------------------------------------------------------------

fn handle_initialize(req: &JsonRpcRequest) -> JsonRpcResponse {
    success_response(
        req.id.clone().unwrap_or(Value::Null),
        json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {}
            },
            "serverInfo": {
                "name": "bento-ya",
                "version": "0.1.0"
            }
        }),
    )
}

fn handle_tools_list(req: &JsonRpcRequest) -> JsonRpcResponse {
    success_response(
        req.id.clone().unwrap_or(Value::Null),
        json!({ "tools": get_tools() }),
    )
}

fn handle_tools_call(conn: &Connection, req: &JsonRpcRequest) -> JsonRpcResponse {
    let params = req.params.as_ref().cloned().unwrap_or(Value::Null);
    let tool_name = params
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let arguments = params.get("arguments").cloned().unwrap_or(json!({}));

    if tool_name.is_empty() {
        return tool_error(
            req.id.clone().unwrap_or(Value::Null),
            "Missing tool name in params.name",
        );
    }

    let result = handle_tool_call(conn, tool_name, &arguments);
    tool_result(req.id.clone().unwrap_or(Value::Null), &result)
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

fn main() {
    let args = Args::parse();
    let db_path = args.db.unwrap_or_else(default_db_path);

    // Both bento-ya and bento-mcp share the same rusqlite build via Cargo workspace,
    // so WAL/SHM formats are guaranteed compatible for concurrent access.
    let conn = Connection::open(&db_path).unwrap_or_else(|e| {
        eprintln!("Failed to open database at {}: {}", db_path, e);
        std::process::exit(1);
    });

    conn.execute_batch("PRAGMA journal_mode=WAL;").ok();
    conn.execute_batch("PRAGMA foreign_keys=ON;").ok();
    conn.busy_timeout(std::time::Duration::from_secs(5)).ok();

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut stdout = stdout.lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        if line.trim().is_empty() {
            continue;
        }

        let request: JsonRpcRequest = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                let resp = error_response(Value::Null, -32700, &format!("Parse error: {}", e));
                let json = serde_json::to_string(&resp).unwrap();
                writeln!(stdout, "{}", json).unwrap();
                stdout.flush().unwrap();
                continue;
            }
        };

        // Notifications (no id) — don't send a response
        if request.id.is_none() {
            // "initialized" is a notification, just consume it
            continue;
        }

        let response = match request.method.as_str() {
            "initialize" => handle_initialize(&request),
            "notifications/initialized" | "initialized" => continue,
            "tools/list" => handle_tools_list(&request),
            "tools/call" => handle_tools_call(&conn, &request),
            _ => error_response(
                request.id.clone().unwrap_or(Value::Null),
                -32601,
                &format!("Method not found: {}", request.method),
            ),
        };

        let json = serde_json::to_string(&response).unwrap();
        writeln!(stdout, "{}", json).unwrap();
        stdout.flush().unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();

        // Run all migrations inline (matching src-tauri/src/db/migrations/)
        conn.execute_batch("
            -- 001_initial
            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, repo_path TEXT NOT NULL,
                tab_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 0,
                config TEXT DEFAULT '{}',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS columns (
                id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
                icon TEXT DEFAULT 'list', position INTEGER NOT NULL DEFAULT 0, color TEXT,
                visible INTEGER NOT NULL DEFAULT 1, triggers TEXT DEFAULT '{}',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, column_id TEXT NOT NULL,
                title TEXT NOT NULL, description TEXT, position INTEGER NOT NULL DEFAULT 0,
                priority TEXT NOT NULL DEFAULT 'medium', agent_mode TEXT, branch_name TEXT,
                files_touched TEXT DEFAULT '[]', checklist TEXT,
                pipeline_state TEXT DEFAULT 'idle', pipeline_triggered_at TEXT, pipeline_error TEXT,
                agent_session_id TEXT, last_script_exit_code INTEGER, review_status TEXT,
                pr_number INTEGER, pr_url TEXT,
                siege_iteration INTEGER DEFAULT 0, siege_active INTEGER DEFAULT 0,
                siege_max_iterations INTEGER DEFAULT 5, siege_last_checked TEXT,
                pr_mergeable TEXT, pr_ci_status TEXT, pr_review_decision TEXT,
                pr_comment_count INTEGER DEFAULT 0, pr_is_draft INTEGER DEFAULT 0,
                pr_labels TEXT DEFAULT '[]', pr_last_fetched TEXT, pr_head_sha TEXT,
                notify_stakeholders TEXT, notification_sent_at TEXT,
                trigger_overrides TEXT DEFAULT '{}', trigger_prompt TEXT, last_output TEXT,
                dependencies TEXT DEFAULT '[]', blocked INTEGER DEFAULT 0,
                agent_status TEXT DEFAULT 'idle', queued_at TEXT,
                retry_count INTEGER DEFAULT 0, model TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
                FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS agent_sessions (
                id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL,
                pid INTEGER, status TEXT NOT NULL DEFAULT 'idle',
                pty_cols INTEGER NOT NULL DEFAULT 80, pty_rows INTEGER NOT NULL DEFAULT 24,
                last_output TEXT, exit_code INTEGER,
                agent_type TEXT NOT NULL DEFAULT 'claude', working_dir TEXT,
                scrollback TEXT, resumable INTEGER NOT NULL DEFAULT 0,
                cli_session_id TEXT, model TEXT, effort_level TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS scripts (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
                steps TEXT NOT NULL DEFAULT '[]', is_built_in INTEGER DEFAULT 0,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
        ").unwrap();

        conn
    }

    fn create_test_workspace(conn: &Connection) -> (String, String, String) {
        let ws_id = new_id();
        let col_id = new_id();
        let ts = now();
        conn.execute(
            "INSERT INTO workspaces (id, name, repo_path, is_active, created_at, updated_at) VALUES (?1, 'Test WS', '/tmp/test', 1, ?2, ?3)",
            params![ws_id, ts, ts],
        ).unwrap();
        conn.execute(
            "INSERT INTO columns (id, workspace_id, name, position, created_at, updated_at) VALUES (?1, ?2, 'Backlog', 0, ?3, ?4)",
            params![col_id, ws_id, ts, ts],
        ).unwrap();
        let col2_id = new_id();
        conn.execute(
            "INSERT INTO columns (id, workspace_id, name, position, created_at, updated_at) VALUES (?1, ?2, 'Done', 1, ?3, ?4)",
            params![col2_id, ws_id, ts, ts],
        ).unwrap();
        (ws_id, col_id, col2_id)
    }

    #[test]
    fn test_get_workspaces_empty() {
        let conn = setup_test_db();
        let result = handle_get_workspaces(&conn);
        let ws = result["workspaces"].as_array().unwrap();
        assert!(ws.is_empty());
    }

    #[test]
    fn test_get_workspaces_returns_all() {
        let conn = setup_test_db();
        create_test_workspace(&conn);
        let result = handle_get_workspaces(&conn);
        let ws = result["workspaces"].as_array().unwrap();
        assert_eq!(ws.len(), 1);
        assert_eq!(ws[0]["name"], "Test WS");
        assert_eq!(ws[0]["is_active"], true);
    }

    #[test]
    fn test_create_workspace() {
        let conn = setup_test_db();
        let result = handle_create_workspace(&conn, &json!({
            "name": "My Project",
            "repo_path": "/home/user/project"
        }));
        assert!(result.get("error").is_none(), "Got error: {:?}", result);
        assert_eq!(result["workspace"]["name"], "My Project");

        // Verify it persisted
        let ws = handle_get_workspaces(&conn);
        assert_eq!(ws["workspaces"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_get_board() {
        let conn = setup_test_db();
        let (ws_id, col_id, _) = create_test_workspace(&conn);

        // Create a task
        let task_id = new_id();
        let ts = now();
        conn.execute(
            "INSERT INTO tasks (id, workspace_id, column_id, title, position, created_at, updated_at) VALUES (?1, ?2, ?3, 'Test Task', 0, ?4, ?5)",
            params![task_id, ws_id, col_id, ts, ts],
        ).unwrap();

        let result = handle_get_board(&conn, &json!({ "workspace": "Test WS" }));
        assert!(result.get("error").is_none(), "Got error: {:?}", result);
        assert_eq!(result["workspace"]["name"], "Test WS");
        let columns = result["columns"].as_array().unwrap();
        assert_eq!(columns.len(), 2);
        assert_eq!(columns[0]["name"], "Backlog");
        assert_eq!(columns[0]["tasks"].as_array().unwrap().len(), 1);
        assert_eq!(columns[0]["tasks"][0]["title"], "Test Task");
    }

    #[test]
    fn test_get_board_workspace_not_found() {
        let conn = setup_test_db();
        let result = handle_get_board(&conn, &json!({ "workspace": "nonexistent" }));
        assert!(result["error"].as_str().unwrap().contains("not found"));
    }

    #[test]
    fn test_create_task() {
        let conn = setup_test_db();
        create_test_workspace(&conn);

        let result = handle_create_task(&conn, &json!({
            "workspace": "Test WS",
            "column": "Backlog",
            "title": "New Task",
            "description": "Do something"
        }));
        assert!(result.get("error").is_none(), "Got error: {:?}", result);
        assert_eq!(result["task"]["title"], "New Task");
    }

    #[test]
    fn test_create_task_missing_column() {
        let conn = setup_test_db();
        create_test_workspace(&conn);

        let result = handle_create_task(&conn, &json!({
            "workspace": "Test WS",
            "column": "NonexistentColumn",
            "title": "Task"
        }));
        assert!(result.get("error").is_some());
    }

    #[test]
    fn test_move_task() {
        let conn = setup_test_db();
        let (ws_id, col_id, col2_id) = create_test_workspace(&conn);

        let task_id = new_id();
        let ts = now();
        conn.execute(
            "INSERT INTO tasks (id, workspace_id, column_id, title, position, created_at, updated_at) VALUES (?1, ?2, ?3, 'Task', 0, ?4, ?5)",
            params![task_id, ws_id, col_id, ts, ts],
        ).unwrap();

        let result = handle_move_task(&conn, &json!({
            "task": "Task",
            "column": "Done"
        }));
        assert!(result.get("error").is_none(), "Got error: {:?}", result);
        assert_eq!(result["message"].as_str().unwrap().contains("Done"), true);

        // Verify task moved
        let task: String = conn.query_row(
            "SELECT column_id FROM tasks WHERE id = ?1", params![task_id], |r| r.get(0)
        ).unwrap();
        assert_eq!(task, col2_id);
    }

    #[test]
    fn test_update_task() {
        let conn = setup_test_db();
        let (ws_id, col_id, _) = create_test_workspace(&conn);

        let task_id = new_id();
        let ts = now();
        conn.execute(
            "INSERT INTO tasks (id, workspace_id, column_id, title, position, created_at, updated_at) VALUES (?1, ?2, ?3, 'Old Title', 0, ?4, ?5)",
            params![task_id, ws_id, col_id, ts, ts],
        ).unwrap();

        let result = handle_update_task(&conn, &json!({
            "task": "Old Title",
            "title": "New Title"
        }));
        assert!(result.get("error").is_none(), "Got error: {:?}", result);
        assert_eq!(result["title"], "New Title");
        assert_eq!(result["message"], "Task updated");
    }

    #[test]
    fn test_delete_task() {
        let conn = setup_test_db();
        let (ws_id, col_id, _) = create_test_workspace(&conn);

        let task_id = new_id();
        let ts = now();
        conn.execute(
            "INSERT INTO tasks (id, workspace_id, column_id, title, position, created_at, updated_at) VALUES (?1, ?2, ?3, 'To Delete', 0, ?4, ?5)",
            params![task_id, ws_id, col_id, ts, ts],
        ).unwrap();

        let result = handle_delete_task(&conn, &json!({ "task": "To Delete" }));
        assert!(result.get("error").is_none(), "Got error: {:?}", result);

        // Verify deleted
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_approve_reject_task() {
        let conn = setup_test_db();
        let (ws_id, col_id, _) = create_test_workspace(&conn);

        let task_id = new_id();
        let ts = now();
        conn.execute(
            "INSERT INTO tasks (id, workspace_id, column_id, title, position, created_at, updated_at) VALUES (?1, ?2, ?3, 'Review Me', 0, ?4, ?5)",
            params![task_id, ws_id, col_id, ts, ts],
        ).unwrap();

        // Approve
        let result = handle_approve_task(&conn, &json!({ "task": "Review Me" }));
        assert!(result.get("error").is_none());
        let status: Option<String> = conn.query_row(
            "SELECT review_status FROM tasks WHERE id = ?1", params![task_id], |r| r.get(0)
        ).unwrap();
        assert_eq!(status.as_deref(), Some("approved"));

        // Reject
        let result = handle_reject_task(&conn, &json!({ "task": "Review Me" }));
        assert!(result.get("error").is_none());
        let status: Option<String> = conn.query_row(
            "SELECT review_status FROM tasks WHERE id = ?1", params![task_id], |r| r.get(0)
        ).unwrap();
        assert_eq!(status.as_deref(), Some("rejected"));
    }

    #[test]
    fn test_create_column() {
        let conn = setup_test_db();
        create_test_workspace(&conn);

        let result = handle_create_column(&conn, &json!({
            "workspace": "Test WS",
            "name": "In Progress",
            "position": 1
        }));
        assert!(result.get("error").is_none(), "Got error: {:?}", result);
        assert_eq!(result["column"]["name"], "In Progress");
    }

    #[test]
    fn test_list_scripts_empty() {
        let conn = setup_test_db();
        let result = handle_list_scripts(&conn);
        assert_eq!(result["scripts"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn test_create_script() {
        let conn = setup_test_db();
        let result = handle_create_script(&conn, &json!({
            "name": "My Script",
            "description": "Does stuff",
            "steps": "[{\"type\":\"bash\",\"command\":\"echo hi\"}]"
        }));
        assert!(result.get("error").is_none(), "Got error: {:?}", result);
        assert_eq!(result["name"], "My Script");

        // Verify it shows in list
        let list = handle_list_scripts(&conn);
        assert_eq!(list["scripts"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_handle_tool_call_unknown() {
        let conn = setup_test_db();
        let result = handle_tool_call(&conn, "nonexistent_tool", &json!({}));
        assert!(result["error"].as_str().unwrap().contains("Unknown tool"));
    }

    #[test]
    fn test_fuzzy_workspace_resolution() {
        let conn = setup_test_db();
        let ws_id = new_id();
        let ts = now();
        conn.execute(
            "INSERT INTO workspaces (id, name, repo_path, created_at, updated_at) VALUES (?1, 'My Cool Project', '/tmp', ?2, ?3)",
            params![ws_id, ts, ts],
        ).unwrap();

        // Exact match
        let result = handle_get_board(&conn, &json!({ "workspace": "My Cool Project" }));
        assert_eq!(result["workspace"]["name"], "My Cool Project");

        // Case-insensitive
        let result = handle_get_board(&conn, &json!({ "workspace": "my cool project" }));
        assert_eq!(result["workspace"]["name"], "My Cool Project");

        // ID match
        let result = handle_get_board(&conn, &json!({ "workspace": ws_id }));
        assert_eq!(result["workspace"]["name"], "My Cool Project");
    }

    #[test]
    fn test_get_task() {
        let conn = setup_test_db();
        let (ws_id, col_id, _) = create_test_workspace(&conn);

        let task_id = new_id();
        let ts = now();
        conn.execute(
            "INSERT INTO tasks (id, workspace_id, column_id, title, description, position, created_at, updated_at) VALUES (?1, ?2, ?3, 'Specific Task', 'Details here', 0, ?4, ?5)",
            params![task_id, ws_id, col_id, ts, ts],
        ).unwrap();

        let result = handle_get_task(&conn, &json!({ "task": "Specific Task" }));
        assert!(result.get("error").is_none(), "Got error: {:?}", result);
        assert_eq!(result["title"], "Specific Task");
        assert_eq!(result["description"], "Details here");
    }
}
