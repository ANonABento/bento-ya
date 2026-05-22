//! HTTP API server for external control (MCP bridge).
//!
//! When enabled, starts an axum server on a random available port. The port and
//! a per-process bearer token are written to `~/.kaitencode/api.port` so MCP
//! clients can discover it.
//! Mutation endpoints call the same internal functions as Tauri IPC commands.

use crate::db;
use crate::pipeline;
use axum::{
    extract::Request,
    extract::State as AxumState,
    http::{header, StatusCode},
    middleware::{self, Next},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::AppHandle;
use uuid::Uuid;

/// Shared state for axum handlers.
struct ApiState {
    app: AppHandle,
    db: Arc<std::sync::Mutex<rusqlite::Connection>>,
    token: String,
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
    Json(ApiResponse {
        success: true,
        data: Some(data),
        error: None,
    })
}

fn err_response(status: StatusCode, msg: String) -> impl IntoResponse {
    (
        status,
        Json(ApiResponse {
            success: false,
            data: None,
            error: Some(msg),
        }),
    )
}

async fn require_api_auth(
    AxumState(api): AxumState<Arc<ApiState>>,
    req: Request,
    next: Next,
) -> impl IntoResponse {
    let expected = format!("Bearer {}", api.token);
    let authorized = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == expected);

    if !authorized {
        return err_response(StatusCode::UNAUTHORIZED, "Unauthorized".to_string()).into_response();
    }

    next.run(req).await
}

macro_rules! get_db {
    ($api:expr) => {
        match $api.db.lock() {
            Ok(c) => c,
            Err(e) => {
                return err_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("DB lock failed: {}", e),
                )
                .into_response()
            }
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
            Ok(t) => t,
            Err(e) => return err_response(StatusCode::NOT_FOUND, e.to_string()).into_response(),
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
            Ok(t) => t,
            Err(e) => {
                return err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
                    .into_response()
            }
        };

        (task, task_before, old_column_id, column_changed)
    }; // DB lock released

    // Phase 2: Pipeline triggers (may spawn async tasks)
    if column_changed {
        let conn = get_db!(api);
        let old_column = db::get_column(&conn, &old_column_id).ok();
        let target_column = db::get_column(&conn, &req.target_column_id).ok();

        // Cancel running agent if task is leaving its column AND target has no spawn_cli trigger.
        // If target also has a trigger, the new trigger replaces the old agent — no need to cancel.
        if task_before.agent_status.as_deref() == Some("running") {
            let target_has_trigger = target_column
                .as_ref()
                .and_then(|c| c.triggers.as_deref())
                .map(|t| t.contains("spawn_cli"))
                .unwrap_or(false);

            if !target_has_trigger {
                eprintln!(
                    "[api] Task {} leaving to non-trigger column — cancelling agent",
                    req.id
                );
                crate::chat::tmux_transport::cancel_task_agent(
                    &conn,
                    &req.id,
                    task_before.agent_session_id.as_deref(),
                );
            }
        }

        if let (Some(ref old_col), Some(ref tgt_col)) = (&old_column, &target_column) {
            let _ = pipeline::triggers::fire_on_exit(
                &conn,
                &api.app,
                &task_before,
                old_col,
                Some(tgt_col),
            );
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
    model: Option<String>,
}

async fn create_task(
    AxumState(api): AxumState<Arc<ApiState>>,
    Json(req): Json<CreateTaskReq>,
) -> impl IntoResponse {
    let conn = get_db!(api);

    let task = match db::insert_task(
        &conn,
        &req.workspace_id,
        &req.column_id,
        req.title.trim(),
        req.description.as_deref(),
    ) {
        Ok(t) => t,
        Err(e) => {
            return err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    };

    if let Some(ref prompt) = req.trigger_prompt {
        let ts = db::now();
        let _ = conn.execute(
            "UPDATE tasks SET trigger_prompt = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![prompt, ts, task.id],
        );
    }
    if let Some(ref model) = req.model {
        let ts = db::now();
        let _ = conn.execute(
            "UPDATE tasks SET model = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![model, ts, task.id],
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
            Ok(t) => t,
            Err(e) => return err_response(StatusCode::NOT_FOUND, e.to_string()).into_response(),
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

    let _ = crate::chat::tmux_transport::kill_session(&req.id);

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
        Ok(t) => t,
        Err(e) => {
            return err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    };

    let column = match db::get_column(&conn, &task.column_id) {
        Ok(c) => c,
        Err(e) => {
            return err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    };

    if let Some(advanced) = pipeline::try_auto_advance(&conn, &api.app, &task, &column)
        .ok()
        .flatten()
    {
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
        Ok(t) => t,
        Err(e) => {
            return err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
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
        Ok(t) => t,
        Err(e) => return err_response(StatusCode::NOT_FOUND, e.to_string()).into_response(),
    };

    let column = match db::get_column(&conn, &task.column_id) {
        Ok(c) => c,
        Err(e) => {
            return err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    };

    let _ = db::update_task_pipeline_state(
        &conn,
        &req.task_id,
        pipeline::PipelineState::Idle.as_str(),
        None,
        None,
    );

    let task = match db::get_task(&conn, &req.task_id) {
        Ok(t) => t,
        Err(e) => {
            return err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    };

    match pipeline::fire_trigger(&conn, &api.app, &task, &column) {
        Ok(t) => ok_response(serde_json::to_value(&t).unwrap_or_default()).into_response(),
        Err(e) => err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn retry_from_start(
    AxumState(api): AxumState<Arc<ApiState>>,
    Json(req): Json<RetryReq>,
) -> impl IntoResponse {
    let conn = get_db!(api);

    let task = match db::get_task(&conn, &req.task_id) {
        Ok(t) => t,
        Err(e) => return err_response(StatusCode::NOT_FOUND, e.to_string()).into_response(),
    };

    let old_column_id = task.column_id.clone();

    // Find first column
    let columns = match db::list_columns(&conn, &task.workspace_id) {
        Ok(c) => c,
        Err(e) => {
            return err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    };
    let first_column = match columns.into_iter().next() {
        Some(c) => c,
        None => {
            return err_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "No columns found".to_string(),
            )
            .into_response()
        }
    };

    let column_changed = old_column_id != first_column.id;

    // Reset pipeline state and move to first column
    let ts = db::now();
    if let Err(e) = conn.execute(
        "UPDATE tasks SET column_id = ?1, position = 0, pipeline_state = 'idle', \
         pipeline_triggered_at = NULL, pipeline_error = NULL, retry_count = 0, \
         review_status = NULL, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![first_column.id, ts, req.task_id],
    ) {
        return err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
    }

    // Fire on_exit for old column
    if column_changed {
        if let Ok(old_col) = db::get_column(&conn, &old_column_id) {
            let _ = pipeline::triggers::fire_on_exit(
                &conn,
                &api.app,
                &task,
                &old_col,
                Some(&first_column),
            );
        }
    }

    pipeline::emit_tasks_changed(&api.app, &task.workspace_id, "api_retry_from_start");

    let task = match db::get_task(&conn, &req.task_id) {
        Ok(t) => t,
        Err(e) => {
            return err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    };

    match pipeline::fire_trigger(&conn, &api.app, &task, &first_column) {
        Ok(t) => ok_response(serde_json::to_value(&t).unwrap_or_default()).into_response(),
        Err(e) => err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn health() -> impl IntoResponse {
    Json(ApiResponse {
        success: true,
        data: Some(serde_json::json!({"status": "ok"})),
        error: None,
    })
}

async fn get_settings() -> impl IntoResponse {
    let settings = crate::config::AppSettings::load();
    ok_response(serde_json::to_value(&settings).unwrap_or_default()).into_response()
}

async fn update_settings(Json(updates): Json<serde_json::Value>) -> impl IntoResponse {
    let mut settings = crate::config::AppSettings::load();
    settings.merge_update(&updates);
    match settings.save() {
        Ok(_) => ok_response(serde_json::to_value(&settings).unwrap_or_default()).into_response(),
        Err(e) => err_response(StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

// ─── Pipeline template endpoints (used by kaitencode-mcp) ──────────────────

#[derive(Deserialize)]
struct SavePipelineTemplateReq {
    name: String,
    #[serde(default)]
    description: String,
    source_workspace_id: String,
}

async fn save_pipeline_template_api(
    AxumState(api): AxumState<Arc<ApiState>>,
    Json(req): Json<SavePipelineTemplateReq>,
) -> impl IntoResponse {
    if req.name.trim().is_empty() {
        return err_response(StatusCode::BAD_REQUEST, "Name cannot be empty".into())
            .into_response();
    }
    let conn = get_db!(api);

    if let Ok(Some(existing)) = db::find_pipeline_template_by_name(&conn, req.name.trim()) {
        return err_response(
            StatusCode::CONFLICT,
            format!(
                "Template '{}' already exists (id {})",
                existing.name, existing.id
            ),
        )
        .into_response();
    }

    let column_data =
        match pipeline::templates::extract_template_from_workspace(&conn, &req.source_workspace_id)
        {
            Ok(d) => d,
            Err(e) => {
                return err_response(StatusCode::BAD_REQUEST, e.to_string()).into_response();
            }
        };
    if column_data.is_empty() {
        return err_response(
            StatusCode::BAD_REQUEST,
            "Source workspace has no columns".into(),
        )
        .into_response();
    }
    let columns_json = match serde_json::to_string(&column_data) {
        Ok(s) => s,
        Err(e) => {
            return err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    };
    let id = db::new_id();
    match db::insert_pipeline_template(
        &conn,
        &id,
        req.name.trim(),
        req.description.trim(),
        &columns_json,
        Some(&req.source_workspace_id),
        false,
    ) {
        Ok(t) => ok_response(serde_json::to_value(&t).unwrap_or_default()).into_response(),
        Err(e) => err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
struct ApplyPipelineTemplateReq {
    template_id: String,
    target_workspace_id: String,
    collision_policy: String,
    #[serde(default)]
    placeholders: std::collections::HashMap<String, String>,
    #[serde(default)]
    task_mapping: std::collections::HashMap<String, String>,
}

async fn apply_pipeline_template_api(
    AxumState(api): AxumState<Arc<ApiState>>,
    Json(req): Json<ApplyPipelineTemplateReq>,
) -> impl IntoResponse {
    let conn = get_db!(api);
    let policy = match pipeline::templates::CollisionPolicy::from_str(&req.collision_policy) {
        Ok(p) => p,
        Err(e) => return err_response(StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    };
    let template = match db::get_pipeline_template(&conn, &req.template_id) {
        Ok(t) => t,
        Err(e) => return err_response(StatusCode::NOT_FOUND, e.to_string()).into_response(),
    };
    if let Err(e) = db::get_workspace(&conn, &req.target_workspace_id) {
        return err_response(StatusCode::NOT_FOUND, e.to_string()).into_response();
    }
    let outcome = match policy {
        pipeline::templates::CollisionPolicy::ReplaceAll => {
            pipeline::templates::apply_template_replace_all(
                &conn,
                &template,
                &req.target_workspace_id,
                &req.placeholders,
                &req.task_mapping,
            )
        }
        pipeline::templates::CollisionPolicy::Append => pipeline::templates::apply_template_append(
            &conn,
            &template,
            &req.target_workspace_id,
            &req.placeholders,
        ),
        pipeline::templates::CollisionPolicy::Prompt => {
            return err_response(
                StatusCode::BAD_REQUEST,
                "collision_policy 'prompt' is not yet supported in v1".into(),
            )
            .into_response();
        }
    };
    match outcome {
        Ok(o) => {
            pipeline::emit_tasks_changed(
                &api.app,
                &req.target_workspace_id,
                "pipeline_template_applied",
            );
            ok_response(serde_json::to_value(&o).unwrap_or_default()).into_response()
        }
        Err(e) => err_response(StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
struct DeletePipelineTemplateReq {
    id: String,
}

async fn delete_pipeline_template_api(
    AxumState(api): AxumState<Arc<ApiState>>,
    Json(req): Json<DeletePipelineTemplateReq>,
) -> impl IntoResponse {
    let conn = get_db!(api);
    let existing = match db::get_pipeline_template(&conn, &req.id) {
        Ok(t) => t,
        Err(e) => return err_response(StatusCode::NOT_FOUND, e.to_string()).into_response(),
    };
    if existing.is_built_in {
        return err_response(
            StatusCode::BAD_REQUEST,
            "Cannot delete built-in pipeline templates".into(),
        )
        .into_response();
    }
    match db::delete_pipeline_template(&conn, &req.id) {
        Ok(_) => ok_response(serde_json::json!({ "deleted": req.id })).into_response(),
        Err(e) => err_response(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

// ─── Server lifecycle ───────────────────────────────────────────────────────

fn port_file_path() -> std::path::PathBuf {
    crate::db::data_dir().join("api.port")
}

fn write_api_discovery_file(path: &std::path::Path, contents: &str) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;

        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(contents.as_bytes())?;
        file.write_all(b"\n")
    }

    #[cfg(not(unix))]
    {
        std::fs::write(path, format!("{contents}\n"))
    }
}

/// Start the HTTP API server on a random port. Writes port and token to
/// ~/.kaitencode/api.port.
pub fn start(app: AppHandle) {
    if !local_api_enabled() {
        let _ = std::fs::remove_file(port_file_path());
        log::info!("[api] Local HTTP API disabled; set KAITENCODE_LOCAL_API=1 to enable");
        return;
    }

    // Open a separate DB connection for the API server (WAL allows concurrent access)
    let db = Arc::new(std::sync::Mutex::new(
        rusqlite::Connection::open(crate::db::db_path()).expect("Failed to open DB for API server"),
    ));

    // Set WAL mode on the API's connection
    if let Ok(conn) = db.lock() {
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
    }

    let token = Uuid::new_v4().to_string();
    let api_state = Arc::new(ApiState {
        app,
        db,
        token: token.clone(),
    });

    tauri::async_runtime::spawn(async move {
        let protected = Router::new()
            .route("/api/move_task", post(move_task))
            .route("/api/create_task", post(create_task))
            .route("/api/delete_task", post(delete_task))
            .route("/api/approve_task", post(approve_task))
            .route("/api/reject_task", post(reject_task))
            .route("/api/retry_task", post(retry_task))
            .route("/api/retry_from_start", post(retry_from_start))
            .route("/api/settings", get(get_settings))
            .route("/api/settings", post(update_settings))
            .route(
                "/api/save_pipeline_template",
                post(save_pipeline_template_api),
            )
            .route(
                "/api/apply_pipeline_template",
                post(apply_pipeline_template_api),
            )
            .route(
                "/api/delete_pipeline_template",
                post(delete_pipeline_template_api),
            )
            .route_layer(middleware::from_fn_with_state(
                Arc::clone(&api_state),
                require_api_auth,
            ));

        let router = Router::new()
            .route("/api/health", get(health))
            .merge(protected)
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

        // Write discovery file with user-only permissions where the platform supports it.
        let port_path = port_file_path();
        let discovery = serde_json::json!({
            "port": addr.port(),
            "token": token,
        })
        .to_string();
        if let Err(e) = write_api_discovery_file(&port_path, &discovery) {
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

fn local_api_enabled() -> bool {
    std::env::var("KAITENCODE_LOCAL_API")
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::local_api_enabled;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn local_api_disabled_by_default() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        std::env::remove_var("KAITENCODE_LOCAL_API");
        assert!(!local_api_enabled());
    }

    #[test]
    fn local_api_accepts_explicit_enable_values() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        for value in ["1", "true", "yes", "on"] {
            std::env::set_var("KAITENCODE_LOCAL_API", value);
            assert!(local_api_enabled(), "value {value}");
        }
        std::env::remove_var("KAITENCODE_LOCAL_API");
    }
}
