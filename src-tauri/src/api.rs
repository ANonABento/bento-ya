//! HTTP API server for external control (MCP bridge).
//!
//! Starts an axum server on a random available port. The port is written
//! to `~/.bentoya/api.port` so MCP clients can discover it.
//! Mutation endpoints call the same internal functions as Tauri IPC commands.

use crate::db;
use crate::pipeline;
use axum::{
    extract::State as AxumState,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::AppHandle;

/// Shared state for axum handlers.
struct ApiState {
    app: AppHandle,
    db: Arc<std::sync::Mutex<rusqlite::Connection>>,
}

/// Standard API response.
#[derive(Serialize)]
struct ApiResponse {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn ok_response(data: serde_json::Value) -> impl IntoResponse {
    Json(ApiResponse { success: true, data: Some(data), error: None })
}

fn err_response(status: StatusCode, msg: String) -> impl IntoResponse {
    (status, Json(ApiResponse { success: false, data: None, error: Some(msg) }))
}

macro_rules! get_db {
    ($api:expr) => {
        match $api.db.lock() {
            Ok(c) => c,
            Err(e) => return err_response(StatusCode::INTERNAL_SERVER_ERROR, format!("DB lock failed: {}", e)).into_response(),
        }
    };
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct MoveTaskReq {
    id: String,
    target_column_id: String,
    #[serde(default)]
    position: i64,
}

async fn move_task(
    AxumState(api): AxumState<Arc<ApiState>>,
    Json(req): Json<MoveTaskReq>,
) -> impl IntoResponse {
    // Phase 1: DB updates (hold lock briefly)
    let (task, task_before, old_column_id, column_changed) = {
        let conn = get_db!(api);

        let task_before = match db::get_task(&conn, &req.id) {
            Ok(t) => t, Err(e) => return err_response(StatusCode::NOT_FOUND, e.to_string()).into_response(),
        };

        let old_column_id = task_before.column_id.clone();
        let column_changed = old_column_id != req.target_column_id;

        let ts = db::now();
        if column_changed {
            let _ = conn.execute(
                "UPDATE tasks SET column_id = ?1, position = ?2, pipeline_state = 'idle', pipeline_triggered_at = NULL, pipeline_error = NULL, updated_at = ?3 WHERE id = ?4",
                rusqlite::params![req.target_column_id, req.position, ts, req.id],
            );
        } else {
            let _ = conn.execute(
                "UPDATE tasks SET column_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
                rusqlite::params![req.target_column_id, req.position, ts, req.id],
            );
        }

        let task = match db::get_task(&conn, &req.id) {
            Ok(t) => t, Err(e) => return err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        };

        (task, task_before, old_column_id, column_changed)
    }; // DB lock released

    // Phase 2: Pipeline triggers (may spawn async tasks)
    if column_changed {
        let conn = get_db!(api);
        let old_column = db::get_column(&conn, &old_column_id).ok();
        let target_column = db::get_column(&conn, &req.target_column_id).ok();

        if let (Some(ref old_col), Some(ref tgt_col)) = (&old_column, &target_column) {
            let _ = pipeline::triggers::fire_on_exit(&conn, &api.app, &task_before, old_col, Some(tgt_col));
        }

        pipeline::emit_tasks_changed(&api.app, &task.workspace_id, "api_task_moved");

        if let Some(ref tgt_col) = target_column {
            let _ = pipeline::fire_trigger(&conn, &api.app, &task, tgt_col);
        }

        let task = db::get_task(&conn, &req.id).unwrap_or(task);
        return ok_response(serde_json::to_value(&task).unwrap_or_default()).into_response();
    }

    ok_response(serde_json::to_value(&task).unwrap_or_default()).into_response()
}

#[derive(Deserialize)]
struct CreateTaskReq {
    workspace_id: String,
    column_id: String,
    title: String,
    description: Option<String>,
    trigger_prompt: Option<String>,
}

async fn create_task(
    AxumState(api): AxumState<Arc<ApiState>>,
    Json(req): Json<CreateTaskReq>,
) -> impl IntoResponse {
    let conn = get_db!(api);

    let task = match db::insert_task(&conn, &req.workspace_id, &req.column_id, req.title.trim(), req.description.as_deref()) {
        Ok(t) => t, Err(e) => return err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

    if let Some(ref prompt) = req.trigger_prompt {
        let ts = db::now();
        let _ = conn.execute(
            "UPDATE tasks SET trigger_prompt = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![prompt, ts, task.id],
        );
    }

    let task = db::get_task(&conn, &task.id).unwrap_or(task);

    // Fire column trigger
    if let Ok(column) = db::get_column(&conn, &req.column_id) {
        let _ = pipeline::fire_trigger(&conn, &api.app, &task, &column);
    }

    pipeline::emit_tasks_changed(&api.app, &req.workspace_id, "api_task_created");

    let task = db::get_task(&conn, &task.id).unwrap_or(task);
    ok_response(serde_json::to_value(&task).unwrap_or_default()).into_response()
}

#[derive(Deserialize)]
struct TaskIdReq {
    id: String,
}

async fn delete_task(
    AxumState(api): AxumState<Arc<ApiState>>,
    Json(req): Json<TaskIdReq>,
) -> impl IntoResponse {
    let task = {
        let conn = get_db!(api);
        match db::get_task(&conn, &req.id) {
            Ok(t) => t, Err(e) => return err_response(StatusCode::NOT_FOUND, e.to_string()).into_response(),
        }
    };

    // Clean up worktree
    if task.worktree_path.is_some() {
        let conn = get_db!(api);
        if let Ok(ws) = db::get_workspace(&conn, &task.workspace_id) {
            let _ = crate::git::branch_manager::remove_task_worktree(&ws.repo_path, &req.id);
        }
        drop(conn);
    }

    {
        let conn = get_db!(api);
        let _ = db::delete_task(&conn, &req.id);
    }

    pipeline::emit_tasks_changed(&api.app, &task.workspace_id, "api_task_deleted");
    ok_response(serde_json::json!({"deleted": true})).into_response()
}

async fn approve_task(
    AxumState(api): AxumState<Arc<ApiState>>,
    Json(req): Json<TaskIdReq>,
) -> impl IntoResponse {
    let conn = get_db!(api);

    let task = match db::update_task_review_status(&conn, &req.id, Some("approved")) {
        Ok(t) => t, Err(e) => return err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

    let column = match db::get_column(&conn, &task.column_id) {
        Ok(c) => c, Err(e) => return err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

    if let Some(advanced) = pipeline::try_auto_advance(&conn, &api.app, &task, &column).ok().flatten() {
        return ok_response(serde_json::to_value(&advanced).unwrap_or_default()).into_response();
    }

    ok_response(serde_json::to_value(&task).unwrap_or_default()).into_response()
}

async fn reject_task(
    AxumState(api): AxumState<Arc<ApiState>>,
    Json(req): Json<TaskIdReq>,
) -> impl IntoResponse {
    let conn = get_db!(api);

    let task = match db::update_task_review_status(&conn, &req.id, Some("rejected")) {
        Ok(t) => t, Err(e) => return err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

    ok_response(serde_json::to_value(&task).unwrap_or_default()).into_response()
}

#[derive(Deserialize)]
struct RetryReq {
    task_id: String,
}

async fn retry_task(
    AxumState(api): AxumState<Arc<ApiState>>,
    Json(req): Json<RetryReq>,
) -> impl IntoResponse {
    let conn = get_db!(api);

    let task = match db::get_task(&conn, &req.task_id) {
        Ok(t) => t, Err(e) => return err_response(StatusCode::NOT_FOUND, e.to_string()).into_response(),
    };

    let column = match db::get_column(&conn, &task.column_id) {
        Ok(c) => c, Err(e) => return err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

    let _ = db::update_task_pipeline_state(&conn, &req.task_id, pipeline::PipelineState::Idle.as_str(), None, None);

    let task = match db::get_task(&conn, &req.task_id) {
        Ok(t) => t, Err(e) => return err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };

    match pipeline::fire_trigger(&conn, &api.app, &task, &column) {
        Ok(t) => ok_response(serde_json::to_value(&t).unwrap_or_default()).into_response(),
        Err(e) => err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn health() -> impl IntoResponse {
    Json(ApiResponse { success: true, data: Some(serde_json::json!({"status": "ok"})), error: None })
}

// ─── Server lifecycle ───────────────────────────────────────────────────────

fn port_file_path() -> std::path::PathBuf {
    dirs::home_dir().unwrap_or_default().join(".bentoya").join("api.port")
}

/// Start the HTTP API server on a random port. Writes port to ~/.bentoya/api.port.
pub fn start(app: AppHandle) {
    // Open a separate DB connection for the API server (WAL allows concurrent access)
    let db = Arc::new(std::sync::Mutex::new(
        rusqlite::Connection::open(crate::db::db_path())
            .expect("Failed to open DB for API server"),
    ));

    // Set WAL mode on the API's connection
    if let Ok(conn) = db.lock() {
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
    }

    let api_state = Arc::new(ApiState { app, db });

    tauri::async_runtime::spawn(async move {
        let router = Router::new()
            .route("/api/health", get(health))
            .route("/api/move_task", post(move_task))
            .route("/api/create_task", post(create_task))
            .route("/api/delete_task", post(delete_task))
            .route("/api/approve_task", post(approve_task))
            .route("/api/reject_task", post(reject_task))
            .route("/api/retry_task", post(retry_task))
            .with_state(api_state);

        // Bind to random available port
        let listener = match tokio::net::TcpListener::bind("127.0.0.1:0").await {
            Ok(l) => l,
            Err(e) => {
                log::error!("[api] Failed to bind: {}", e);
                return;
            }
        };

        let addr: SocketAddr = listener.local_addr().unwrap();
        log::info!("[api] HTTP API server listening on {}", addr);

        // Write port file
        let port_path = port_file_path();
        if let Err(e) = std::fs::write(&port_path, addr.port().to_string()) {
            log::error!("[api] Failed to write port file: {}", e);
        }

        // Serve
        if let Err(e) = axum::serve(listener, router).await {
            log::error!("[api] Server error: {}", e);
        }

        // Cleanup port file on shutdown
        let _ = std::fs::remove_file(port_file_path());
    });
}

/// Remove the port file (call on app shutdown).
pub fn cleanup() {
    let _ = std::fs::remove_file(port_file_path());
}
