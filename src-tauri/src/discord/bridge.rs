//! Discord sidecar bridge
//!
//! Manages the Node.js Discord bot process and provides async IPC.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, Mutex};

/// Incoming command from the sidecar (sidecar requesting data from Rust)
#[derive(Debug, Clone, Deserialize)]
pub struct IncomingCommand {
    pub id: String,
    #[serde(rename = "type")]
    pub cmd_type: String,
    pub payload: serde_json::Value,
}

/// Shared Discord bridge state
pub type SharedDiscordBridge = Arc<Mutex<DiscordBridge>>;

/// Create a new shared Discord bridge
pub fn new_shared_discord_bridge() -> SharedDiscordBridge {
    Arc::new(Mutex::new(DiscordBridge::new()))
}

/// Command sent to the sidecar
#[derive(Debug, Clone, Serialize)]
pub struct BridgeCommand {
    pub id: String,
    #[serde(rename = "type")]
    pub cmd_type: String,
    pub payload: serde_json::Value,
}

/// Response from the sidecar (also used to send responses TO the sidecar)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeResponse {
    pub id: String,
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

/// Event from the sidecar (no correlation ID)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeEvent {
    pub event: String,
    pub payload: serde_json::Value,
}

/// Discord connection status
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiscordStatus {
    pub connected: bool,
    pub ready: bool,
    pub user: Option<DiscordUser>,
    pub guild_id: Option<String>,
    pub guild_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordUser {
    pub id: String,
    pub tag: String,
    pub username: String,
}

/// Setup workspace result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupWorkspaceResult {
    pub category_id: String,
    pub channel_map: HashMap<String, String>,
    pub chef_channel_id: String,
    pub notifications_channel_id: String,
}

/// Create thread result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateThreadResult {
    pub thread_id: String,
    pub message_id: String,
}

/// Queue status for rate limiter monitoring
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueStatus {
    pub pending_count: u32,
    pub limited_channels: Vec<String>,
    pub last_error: Option<String>,
}

/// Discord bot sidecar bridge
pub struct DiscordBridge {
    /// The running sidecar process
    process: Option<Child>,
    /// Sender to the sidecar stdin writer thread
    stdin_tx: Option<mpsc::UnboundedSender<String>>,
    /// Pending response channels
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<BridgeResponse>>>>,
    /// Current status
    status: DiscordStatus,
    /// Command counter for unique IDs
    cmd_counter: u64,
    /// Receiver for incoming commands from the sidecar
    incoming_rx: Option<mpsc::UnboundedReceiver<IncomingCommand>>,
}

impl DiscordBridge {
    pub fn new() -> Self {
        Self {
            process: None,
            stdin_tx: None,
            pending: Arc::new(Mutex::new(HashMap::new())),
            status: DiscordStatus::default(),
            cmd_counter: 0,
            incoming_rx: None,
        }
    }

    /// Check if the sidecar is running
    pub fn is_running(&self) -> bool {
        self.process.is_some()
    }

    /// Get current status
    pub fn get_status(&self) -> &DiscordStatus {
        &self.status
    }

    /// Spawn the Discord bot sidecar
    pub async fn spawn(&mut self, sidecar_path: &str, app: &AppHandle) -> Result<(), String> {
        // Kill existing process if any
        self.kill().await;

        // Spawn the Node.js process
        let mut child = Command::new("node")
            .arg(sidecar_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn Discord sidecar: {}", e))?;

        // Take handles
        let stdin = child
            .stdin
            .take()
            .ok_or("Failed to capture stdin")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture stdout")?;

        // Create channel for stdin writes
        let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();

        // Create channel for incoming commands from sidecar
        let (incoming_tx, incoming_rx) = mpsc::unbounded_channel::<IncomingCommand>();

        // Spawn stdin writer thread
        thread::spawn(move || {
            let mut stdin = stdin;
            while let Some(line) = stdin_rx.blocking_recv() {
                if writeln!(stdin, "{}", line).is_err() {
                    break;
                }
                if stdin.flush().is_err() {
                    break;
                }
            }
        });

        // Spawn stdout reader thread
        let pending_clone = Arc::clone(&self.pending);
        let app_clone = app.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                if line.is_empty() {
                    continue;
                }

                // Try to parse as response first (has "success" field)
                if let Ok(response) = serde_json::from_str::<BridgeResponse>(&line) {
                    // Find and complete the pending request
                    let mut pending = pending_clone.blocking_lock();
                    if let Some(tx) = pending.remove(&response.id) {
                        let _ = tx.send(response);
                    }
                    drop(pending);
                    continue;
                }

                // Try to parse as event (has "event" field)
                if let Ok(event) = serde_json::from_str::<BridgeEvent>(&line) {
                    // Emit to frontend
                    let _ = app_clone.emit("discord:event", &event);
                    continue;
                }

                // Try to parse as incoming command from sidecar (has "type" field)
                if let Ok(command) = serde_json::from_str::<IncomingCommand>(&line) {
                    // Forward to command handler
                    let _ = incoming_tx.send(command);
                }
            }
        });

        self.process = Some(child);
        self.stdin_tx = Some(stdin_tx);
        self.incoming_rx = Some(incoming_rx);
        self.status = DiscordStatus::default();

        Ok(())
    }

    /// Kill the sidecar process
    pub async fn kill(&mut self) {
        if let Some(mut process) = self.process.take() {
            let _ = process.kill();
            let _ = process.wait();
        }
        self.stdin_tx = None;
        self.incoming_rx = None;
        self.status = DiscordStatus::default();
    }

    /// Receive the next incoming command from the sidecar
    pub async fn recv_command(&mut self) -> Option<IncomingCommand> {
        if let Some(rx) = &mut self.incoming_rx {
            rx.recv().await
        } else {
            None
        }
    }

    /// Send a response to an incoming command from the sidecar
    pub fn send_response(&self, id: &str, success: bool, data: Option<serde_json::Value>, error: Option<String>) -> Result<(), String> {
        let stdin_tx = self
            .stdin_tx
            .as_ref()
            .ok_or("Sidecar not running")?;

        let response = BridgeResponse {
            id: id.to_string(),
            success,
            data,
            error,
        };

        let json = serde_json::to_string(&response)
            .map_err(|e| format!("Failed to serialize response: {}", e))?;

        stdin_tx
            .send(json)
            .map_err(|e| format!("Failed to send response: {}", e))?;

        Ok(())
    }

    /// Send a command and wait for response
    pub async fn send_command(
        &mut self,
        cmd_type: &str,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let stdin_tx = self
            .stdin_tx
            .as_ref()
            .ok_or("Sidecar not running")?;

        // Generate unique command ID
        self.cmd_counter += 1;
        let id = format!("cmd-{}", self.cmd_counter);

        let command = BridgeCommand {
            id: id.clone(),
            cmd_type: cmd_type.to_string(),
            payload,
        };

        // Create response channel
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            pending.insert(id.clone(), tx);
        }

        // Send command
        let json = serde_json::to_string(&command)
            .map_err(|e| format!("Failed to serialize command: {}", e))?;
        stdin_tx
            .send(json)
            .map_err(|e| format!("Failed to send command: {}", e))?;

        // Wait for response with timeout
        let response = tokio::time::timeout(std::time::Duration::from_secs(30), rx)
            .await
            .map_err(|_| "Command timed out")?
            .map_err(|_| "Response channel closed")?;

        // Clean up pending
        {
            let mut pending = self.pending.lock().await;
            pending.remove(&id);
        }

        if response.success {
            Ok(response.data.unwrap_or(serde_json::Value::Null))
        } else {
            Err(response.error.unwrap_or_else(|| "Unknown error".to_string()))
        }
    }

    /// Connect to Discord
    pub async fn connect(
        &mut self,
        token: &str,
        guild_id: Option<&str>,
    ) -> Result<DiscordStatus, String> {
        let payload = serde_json::json!({
            "token": token,
            "guildId": guild_id,
        });

        let result = self.send_command("connect", payload).await?;
        let status: DiscordStatus = serde_json::from_value(result)
            .map_err(|e| format!("Failed to parse status: {}", e))?;

        self.status = status.clone();
        Ok(status)
    }

    /// Disconnect from Discord
    pub async fn disconnect(&mut self) -> Result<(), String> {
        self.send_command("disconnect", serde_json::Value::Null).await?;
        self.status = DiscordStatus::default();
        Ok(())
    }

    /// Ping the sidecar
    pub async fn ping(&mut self) -> Result<serde_json::Value, String> {
        self.send_command("ping", serde_json::Value::Null).await
    }

    /// Get status from sidecar
    pub async fn fetch_status(&mut self) -> Result<DiscordStatus, String> {
        let result = self.send_command("get_status", serde_json::Value::Null).await?;
        let status: DiscordStatus = serde_json::from_value(result)
            .map_err(|e| format!("Failed to parse status: {}", e))?;
        self.status = status.clone();
        Ok(status)
    }

    /// Setup Discord workspace structure
    pub async fn setup_workspace(
        &mut self,
        guild_id: &str,
        workspace_name: &str,
        columns: Vec<(String, String, i32)>, // (id, name, position)
    ) -> Result<SetupWorkspaceResult, String> {
        let payload = serde_json::json!({
            "guildId": guild_id,
            "workspaceName": workspace_name,
            "columns": columns.iter().map(|(id, name, pos)| {
                serde_json::json!({
                    "id": id,
                    "name": name,
                    "position": pos,
                })
            }).collect::<Vec<_>>(),
        });

        let result = self.send_command("setup_workspace", payload).await?;
        serde_json::from_value(result).map_err(|e| format!("Failed to parse result: {}", e))
    }

    /// Create a thread for a task
    pub async fn create_thread(
        &mut self,
        channel_id: &str,
        task_id: &str,
        task_title: &str,
    ) -> Result<CreateThreadResult, String> {
        let payload = serde_json::json!({
            "channelId": channel_id,
            "taskId": task_id,
            "taskTitle": task_title,
        });

        let result = self.send_command("create_thread", payload).await?;
        serde_json::from_value(result).map_err(|e| format!("Failed to parse result: {}", e))
    }

    /// Archive a thread
    pub async fn archive_thread(
        &mut self,
        thread_id: &str,
        reason: Option<&str>,
    ) -> Result<bool, String> {
        let payload = serde_json::json!({
            "threadId": thread_id,
            "reason": reason,
        });

        let result = self.send_command("archive_thread", payload).await?;
        let archived = result
            .get("archived")
            .and_then(|v| v.as_bool())
            .ok_or("Missing archived in response")?;
        Ok(archived)
    }

    /// Update a thread's name
    pub async fn update_thread_name(
        &mut self,
        thread_id: &str,
        name: &str,
    ) -> Result<bool, String> {
        let payload = serde_json::json!({
            "threadId": thread_id,
            "name": name,
        });

        let result = self.send_command("update_thread_name", payload).await?;
        let updated = result
            .get("updated")
            .and_then(|v| v.as_bool())
            .ok_or("Missing updated in response")?;
        Ok(updated)
    }

    /// Post a message to a channel or thread
    pub async fn post_message(
        &mut self,
        channel_id: &str,
        thread_id: Option<&str>,
        content: Option<&str>,
        embeds: Option<serde_json::Value>,
    ) -> Result<String, String> {
        let payload = serde_json::json!({
            "channelId": channel_id,
            "threadId": thread_id,
            "content": content,
            "embeds": embeds,
        });

        let result = self.send_command("post_message", payload).await?;
        let message_id = result
            .get("messageId")
            .and_then(|v| v.as_str())
            .ok_or("Missing messageId in response")?;
        Ok(message_id.to_string())
    }

    // ─── Agent Output Streaming ─────────────────────────────────────────────────

    /// Register a thread ID for a task (for agent output streaming)
    pub async fn register_thread(&mut self, task_id: &str, thread_id: &str) -> Result<(), String> {
        let payload = serde_json::json!({
            "taskId": task_id,
            "threadId": thread_id,
        });

        self.send_command("register_thread", payload).await?;
        Ok(())
    }

    /// Stream agent output delta to Discord
    pub async fn send_agent_output(
        &mut self,
        task_id: &str,
        delta: &str,
        output_type: Option<&str>,
    ) -> Result<(), String> {
        let payload = serde_json::json!({
            "taskId": task_id,
            "delta": delta,
            "type": output_type.unwrap_or("stdout"),
        });

        self.send_command("agent_output", payload).await?;
        Ok(())
    }

    /// Signal agent completion with summary
    pub async fn send_agent_complete(
        &mut self,
        task_id: &str,
        success: bool,
        summary: &str,
        duration_ms: Option<u64>,
        tokens_used: Option<u64>,
    ) -> Result<(), String> {
        let payload = serde_json::json!({
            "taskId": task_id,
            "success": success,
            "summary": summary,
            "duration": duration_ms,
            "tokensUsed": tokens_used,
        });

        self.send_command("agent_complete", payload).await?;
        Ok(())
    }

    /// Get queue status from rate limiter
    pub async fn get_queue_status(&mut self) -> Result<QueueStatus, String> {
        let result = self.send_command("get_queue_status", serde_json::Value::Null).await?;
        serde_json::from_value(result).map_err(|e| format!("Failed to parse queue status: {}", e))
    }
}

impl Default for DiscordBridge {
    fn default() -> Self {
        Self::new()
    }
}
