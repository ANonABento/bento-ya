//! Discord sidecar bridge (MVP).
//!
//! Spawns the Node.js discord.js sidecar at `sidecars/discord-bot` and talks to
//! it over newline-delimited JSON on stdin/stdout (see the protocol doc in
//! `src/index.js` and `.tickets/discord/MVP-PLAN.md`).
//!
//! MVP is one-direction: KaitenCode drives Discord (create threads, post
//! messages). Inbound `message` events are re-emitted to the frontend as
//! `discord:message` but reply-routing is a later slice (T058).

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

pub mod notify;

const COMMAND_TIMEOUT: Duration = Duration::from_secs(20);

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>;

/// Shared, app-managed handle to the (at most one) running sidecar bridge.
pub type SharedDiscord = Arc<tokio::sync::Mutex<Option<DiscordBridge>>>;

pub fn shared() -> SharedDiscord {
    Arc::new(tokio::sync::Mutex::new(None))
}

/// A live connection to the Node sidecar process.
pub struct DiscordBridge {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Pending,
    next_id: AtomicU64,
}

impl DiscordBridge {
    /// Spawn the sidecar process and start the stdout reader. Does not connect
    /// to Discord — call `send_command("connect", { token })` for that.
    pub fn spawn(app: &AppHandle) -> Result<Self, String> {
        let entry = sidecar_entry_path()?;
        // discord.js must be installed in the sidecar dir.
        if let Some(dir) = entry.parent().and_then(|p| p.parent()) {
            if !dir.join("node_modules").exists() {
                return Err(format!(
                    "Discord sidecar dependencies missing — run `npm install` in {}",
                    dir.display()
                ));
            }
        }
        let node = node_path();
        let mut child = Command::new(&node)
            .arg(&entry)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                format!(
                    "failed to spawn discord sidecar (`{} {}`): {}",
                    node,
                    entry.display(),
                    e
                )
            })?;

        let stdin = child.stdin.take().ok_or("no sidecar stdin")?;
        let stdout = child.stdout.take().ok_or("no sidecar stdout")?;
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));

        // Reader thread: responses (have "id") fulfill waiters; events forward.
        {
            let pending = Arc::clone(&pending);
            let app = app.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines().map_while(Result::ok) {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let value: Value = match serde_json::from_str(trimmed) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    if let Some(id) = value.get("id").and_then(Value::as_str) {
                        if let Some(tx) = pending.lock().unwrap().remove(id) {
                            let result =
                                if value.get("success").and_then(Value::as_bool).unwrap_or(false) {
                                    Ok(value.get("data").cloned().unwrap_or(Value::Null))
                                } else {
                                    Err(value
                                        .get("error")
                                        .and_then(Value::as_str)
                                        .unwrap_or("unknown sidecar error")
                                        .to_string())
                                };
                            let _ = tx.send(result);
                        }
                    } else if let Some(event) = value.get("event").and_then(Value::as_str) {
                        let payload = value.get("payload").cloned().unwrap_or(Value::Null);
                        let _ = app.emit(&format!("discord:{event}"), payload);
                    }
                }
                // stdout closed → the sidecar exited.
                let _ = app.emit("discord:disconnect", json!({ "reason": "sidecar_exited" }));
            });
        }

        // Drain stderr to the log so connection failures are diagnosable.
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    log::warn!("[discord-sidecar] {line}");
                }
            });
        }

        Ok(Self {
            child,
            stdin: Arc::new(Mutex::new(stdin)),
            pending,
            next_id: AtomicU64::new(1),
        })
    }

    /// Send a command and await its correlated response (with a timeout).
    pub async fn send_command(&self, cmd_type: &str, payload: Value) -> Result<Value, String> {
        let id = format!("c{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id.clone(), tx);

        let line = serde_json::to_string(&json!({ "id": id, "type": cmd_type, "payload": payload }))
            .map_err(|e| e.to_string())?;
        {
            let mut stdin = self.stdin.lock().unwrap();
            stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
            stdin.write_all(b"\n").map_err(|e| e.to_string())?;
            stdin.flush().map_err(|e| e.to_string())?;
        }

        match tokio::time::timeout(COMMAND_TIMEOUT, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("sidecar dropped the response".to_string()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(format!("discord command '{cmd_type}' timed out"))
            }
        }
    }

    pub fn shutdown(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for DiscordBridge {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Resolve the sidecar entry script. Honors `KAITENCODE_DISCORD_SIDECAR`, then
/// looks in the dev tree (cwd = `src-tauri` or repo root), then next to the exe.
fn sidecar_entry_path() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("KAITENCODE_DISCORD_SIDECAR") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Ok(pb);
        }
    }
    let rel = "sidecars/discord-bot/src/index.js";
    let candidates = [
        PathBuf::from(rel),                                  // cwd = src-tauri (tauri dev)
        PathBuf::from("src-tauri").join(rel),                // cwd = repo root
    ];
    for c in candidates {
        if c.exists() {
            return Ok(c);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join(rel);
            if p.exists() {
                return Ok(p);
            }
        }
    }
    Err(format!(
        "discord sidecar not found — set KAITENCODE_DISCORD_SIDECAR to the path of {rel}"
    ))
}

fn node_path() -> String {
    crate::commands::cli_detect::find_cli("node").unwrap_or_else(|| "node".to_string())
}
