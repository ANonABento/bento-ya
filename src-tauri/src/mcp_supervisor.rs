//! Supervisor that keeps a `bento-mcp` child process alive.
//!
//! Spawns `bento-mcp` at startup and respawns it if it exits unexpectedly,
//! using exponential backoff (2s → 60s) capped at 5 restarts per minute.
//! Health state (`Healthy` / `Restarting` / `Failed` / `NotInstalled`) is
//! exposed to the frontend via a `mcp:health` event and the
//! `get_mcp_health` IPC command.
//!
//! The child is a regular MCP server reading JSON-RPC over stdio. Bento-ya
//! does not feed it requests — external clients (Claude Code, choomfie, etc.)
//! still spawn their own copies. Keeping a warm child here is a smoke test
//! that the binary is installed and runnable, and it makes the MCP status
//! visible in the app UI.

use std::io::ErrorKind;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;
use tokio::sync::RwLock;

const MCP_BINARY: &str = "bento-mcp";
const HEALTH_EVENT: &str = "mcp:health";

/// Max restarts allowed in any rolling 60-second window before we declare
/// the supervisor failed and pause for a longer cooldown.
const MAX_RESTARTS_PER_MINUTE: u32 = 5;

/// Long cooldown after exceeding the per-minute restart cap.
const FAILED_COOLDOWN_SECS: u64 = 60;

/// Lifespan above which we treat the previous run as healthy and reset
/// the rolling restart window.
const HEALTHY_LIFESPAN_SECS: u64 = 60;

/// Backoff schedule for consecutive restarts (capped at 60s).
fn backoff_for(attempt: u32) -> Duration {
    let secs = match attempt {
        0 | 1 => 2,
        2 => 4,
        3 => 8,
        4 => 16,
        5 => 32,
        _ => 60,
    };
    Duration::from_secs(secs)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpHealthStatus {
    Healthy,
    Restarting,
    Failed,
    NotInstalled,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHealth {
    pub status: McpHealthStatus,
    pub pid: Option<u32>,
    pub restart_count: u32,
    pub last_error: Option<String>,
    pub message: Option<String>,
}

impl McpHealth {
    fn initial() -> Self {
        Self {
            status: McpHealthStatus::Restarting,
            pid: None,
            restart_count: 0,
            last_error: None,
            message: Some("Starting bento-mcp...".to_string()),
        }
    }
}

/// Tauri-managed state holding the latest supervisor health.
pub struct McpSupervisorState(pub Arc<RwLock<McpHealth>>);

impl McpSupervisorState {
    pub fn new() -> Self {
        Self(Arc::new(RwLock::new(McpHealth::initial())))
    }

    pub fn snapshot(&self) -> McpHealth {
        // Block briefly to grab a snapshot. RwLock read is cheap and the
        // supervisor only writes a handful of times during a restart.
        futures::executor::block_on(self.0.read()).clone()
    }
}

impl Default for McpSupervisorState {
    fn default() -> Self {
        Self::new()
    }
}

async fn publish(
    app: &AppHandle,
    health: &Arc<RwLock<McpHealth>>,
    next: McpHealth,
) {
    {
        let mut guard = health.write().await;
        *guard = next.clone();
    }
    if let Err(e) = app.emit(HEALTH_EVENT, &next) {
        log::warn!("[mcp-supervisor] failed to emit health event: {}", e);
    }
}

/// Start the supervisor. Returns the shared health state to register with
/// Tauri (`app.manage(...)`). Idempotent isn't expected — call once.
pub fn start(app: AppHandle) -> McpSupervisorState {
    let state = McpSupervisorState::new();
    let health = Arc::clone(&state.0);
    tauri::async_runtime::spawn(supervise(app, health));
    state
}

async fn supervise(app: AppHandle, health: Arc<RwLock<McpHealth>>) {
    let mut window_start = Instant::now();
    let mut restarts_in_window: u32 = 0;
    let mut total_restarts: u32 = 0;

    loop {
        // Roll the restart-rate window once per minute.
        if window_start.elapsed() > Duration::from_secs(60) {
            window_start = Instant::now();
            restarts_in_window = 0;
        }

        if restarts_in_window >= MAX_RESTARTS_PER_MINUTE {
            let msg = format!(
                "bento-mcp restarted {} times in 60s — pausing for {}s",
                restarts_in_window, FAILED_COOLDOWN_SECS
            );
            log::error!("[mcp-supervisor] {}", msg);
            publish(
                &app,
                &health,
                McpHealth {
                    status: McpHealthStatus::Failed,
                    pid: None,
                    restart_count: total_restarts,
                    last_error: Some(msg.clone()),
                    message: Some(msg),
                },
            )
            .await;
            tokio::time::sleep(Duration::from_secs(FAILED_COOLDOWN_SECS)).await;
            window_start = Instant::now();
            restarts_in_window = 0;
            continue;
        }

        log::info!("[mcp-supervisor] spawning {}", MCP_BINARY);
        let spawn_result = Command::new(MCP_BINARY)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn();

        let mut child = match spawn_result {
            Ok(c) => c,
            Err(e) => {
                if e.kind() == ErrorKind::NotFound {
                    let msg = format!(
                        "{} binary not found in PATH — install via `cargo install --path mcp-server`",
                        MCP_BINARY
                    );
                    log::warn!("[mcp-supervisor] {}", msg);
                    publish(
                        &app,
                        &health,
                        McpHealth {
                            status: McpHealthStatus::NotInstalled,
                            pid: None,
                            restart_count: total_restarts,
                            last_error: Some(msg.clone()),
                            message: Some(msg),
                        },
                    )
                    .await;
                    // Don't churn the retry counter for missing binary; check
                    // back periodically in case the user installs it.
                    tokio::time::sleep(Duration::from_secs(FAILED_COOLDOWN_SECS)).await;
                    continue;
                }
                let msg = format!("failed to spawn {}: {}", MCP_BINARY, e);
                log::error!("[mcp-supervisor] {}", msg);
                restarts_in_window += 1;
                total_restarts += 1;
                let backoff = backoff_for(restarts_in_window);
                publish(
                    &app,
                    &health,
                    McpHealth {
                        status: McpHealthStatus::Restarting,
                        pid: None,
                        restart_count: total_restarts,
                        last_error: Some(msg),
                        message: Some(format!("Retrying in {}s", backoff.as_secs())),
                    },
                )
                .await;
                tokio::time::sleep(backoff).await;
                continue;
            }
        };

        let pid = child.id();
        let spawn_at = Instant::now();
        log::info!(
            "[mcp-supervisor] {} running (pid={:?}, restart#{})",
            MCP_BINARY,
            pid,
            total_restarts
        );
        publish(
            &app,
            &health,
            McpHealth {
                status: McpHealthStatus::Healthy,
                pid,
                restart_count: total_restarts,
                last_error: None,
                message: Some(format!("bento-mcp running (pid {})", pid.unwrap_or(0))),
            },
        )
        .await;

        let exit = child.wait().await;
        let lifespan = spawn_at.elapsed();
        let exit_msg = match &exit {
            Ok(status) => format!("{}", status),
            Err(e) => format!("wait error: {}", e),
        };
        log::warn!(
            "[mcp-supervisor] {} exited after {:?}: {}",
            MCP_BINARY,
            lifespan,
            exit_msg
        );

        // A long, healthy run means whatever crashed it isn't a tight loop —
        // reset the rolling counter so the next failure starts fresh.
        if lifespan >= Duration::from_secs(HEALTHY_LIFESPAN_SECS) {
            window_start = Instant::now();
            restarts_in_window = 0;
        }

        restarts_in_window += 1;
        total_restarts += 1;
        let backoff = backoff_for(restarts_in_window);
        publish(
            &app,
            &health,
            McpHealth {
                status: McpHealthStatus::Restarting,
                pid: None,
                restart_count: total_restarts,
                last_error: Some(exit_msg),
                message: Some(format!("Restarting in {}s", backoff.as_secs())),
            },
        )
        .await;
        tokio::time::sleep(backoff).await;
    }
}

/// IPC: read the latest health snapshot.
#[tauri::command]
pub fn get_mcp_health(state: tauri::State<'_, McpSupervisorState>) -> McpHealth {
    state.snapshot()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_schedule_matches_spec() {
        assert_eq!(backoff_for(1), Duration::from_secs(2));
        assert_eq!(backoff_for(2), Duration::from_secs(4));
        assert_eq!(backoff_for(3), Duration::from_secs(8));
        assert_eq!(backoff_for(4), Duration::from_secs(16));
        assert_eq!(backoff_for(5), Duration::from_secs(32));
        assert_eq!(backoff_for(6), Duration::from_secs(60));
        assert_eq!(backoff_for(50), Duration::from_secs(60));
    }

    #[test]
    fn initial_health_is_restarting() {
        let h = McpHealth::initial();
        assert_eq!(h.status, McpHealthStatus::Restarting);
        assert_eq!(h.restart_count, 0);
        assert!(h.pid.is_none());
        assert!(h.message.is_some());
    }
}
