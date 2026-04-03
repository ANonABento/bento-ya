//! Pipe-based transport for structured CLI sessions.
//!
//! Spawns `claude --print --output-format stream-json --verbose` with the message
//! as a positional argument. Parses JSON events from stdout into `ChatEvent` types.
//!
//! Non-interactive: each message spawns a fresh process. Conversation continuity
//! via `--resume <session_id>`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio::time::timeout;

use super::events::{parse_json_event, spawn_stderr_reader, ChatEvent};
use super::transport::{ChatTransport, SpawnConfig, TransportEvent};

/// Timeout for reading a response from the CLI (5 minutes)
const MESSAGE_TIMEOUT: Duration = Duration::from_secs(300);

/// Pipe transport — structured JSON streaming via CLI.
///
/// Each `spawn()` starts a new CLI process. The message must be included
/// in the args of the SpawnConfig (as the last positional argument).
pub struct PipeTransport {
    /// Handle to the running child process (for kill)
    child: Option<tokio::process::Child>,
    /// Whether the process is still alive (shared with async reader task)
    alive: Arc<AtomicBool>,
}

impl PipeTransport {
    pub fn new() -> Self {
        Self {
            child: None,
            alive: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl ChatTransport for PipeTransport {
    fn spawn(&mut self, config: SpawnConfig) -> Result<mpsc::Receiver<TransportEvent>, String> {
        let mut cmd = Command::new(&config.command);

        for arg in &config.args {
            cmd.arg(arg);
        }

        // Set working directory if specified and exists
        if let Some(ref dir) = config.working_dir {
            let path = std::path::Path::new(dir);
            if path.exists() && path.is_dir() {
                cmd.current_dir(dir);
            } else if let Ok(home) = std::env::var("HOME") {
                cmd.current_dir(home);
            }
        }

        if let Some(ref vars) = config.env_vars {
            for (key, value) in vars {
                cmd.env(key, value);
            }
        }

        // No stdin needed - message is in args
        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn CLI: {}", e))?;

        self.alive.store(true, Ordering::SeqCst);

        // Spawn stderr reader (shared with legacy cli_shared)
        if let Some(stderr) = child.stderr.take() {
            spawn_stderr_reader(stderr, config.command.clone());
        }

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture stdout".to_string())?;

        self.child = Some(child);

        let (event_tx, event_rx) = mpsc::channel::<TransportEvent>(256);
        let alive_flag = Arc::clone(&self.alive);

        // Async reader task: parse JSON lines and emit events
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut full_response = String::new();

            loop {
                let mut line = String::new();
                let read_result = timeout(MESSAGE_TIMEOUT, reader.read_line(&mut line)).await;

                match read_result {
                    Err(_) => {
                        let _ = event_tx
                            .send(TransportEvent::Chat(ChatEvent::TextContent(
                                "[error: CLI response timed out after 5 minutes]".to_string(),
                            )))
                            .await;
                        break;
                    }
                    Ok(Err(e)) => {
                        let _ = event_tx
                            .send(TransportEvent::Chat(ChatEvent::TextContent(
                                format!("[error: Failed to read stdout: {}]", e),
                            )))
                            .await;
                        break;
                    }
                    Ok(Ok(0)) => {
                        // EOF — process ended
                        break;
                    }
                    Ok(Ok(_)) => {
                        // Skip assistant events to avoid double-counting with streaming deltas
                        let is_assistant_event = line.contains("\"type\":\"assistant\"")
                            || line.contains("\"type\": \"assistant\"");

                        if is_assistant_event {
                            let event = parse_json_event(&line);
                            if let ChatEvent::TextContent(text) = &event {
                                if full_response.is_empty() {
                                    full_response = text.clone();
                                    let _ = event_tx
                                        .send(TransportEvent::Chat(event))
                                        .await;
                                }
                            }
                            continue;
                        }

                        let event = parse_json_event(&line);

                        match &event {
                            ChatEvent::TextContent(text) => {
                                full_response.push_str(text);
                            }
                            ChatEvent::Complete => {
                                let _ = event_tx
                                    .send(TransportEvent::Chat(event))
                                    .await;
                                break;
                            }
                            _ => {}
                        }

                        let _ = event_tx.send(TransportEvent::Chat(event)).await;
                    }
                }
            }

            // Mark process as no longer alive and signal exit
            alive_flag.store(false, Ordering::SeqCst);
            let _ = event_tx.send(TransportEvent::Exited(None)).await;
        });

        Ok(event_rx)
    }

    fn write(&mut self, _data: &[u8]) -> Result<(), String> {
        // Pipe transport is non-interactive — message is passed as CLI arg.
        Ok(())
    }

    fn resize(&mut self, _cols: u16, _rows: u16) -> Result<(), String> {
        // No terminal to resize
        Ok(())
    }

    fn kill(&mut self) -> Result<(), String> {
        if let Some(ref mut child) = self.child {
            let _ = child.start_kill();
        }
        self.child = None;
        self.alive.store(false, Ordering::SeqCst);
        Ok(())
    }

    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    fn pid(&self) -> Option<u32> {
        self.child.as_ref().and_then(|c| c.id())
    }
}

impl Default for PipeTransport {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pipe_transport_new() {
        let transport = PipeTransport::new();
        assert!(!transport.is_alive());
        assert!(transport.pid().is_none());
    }
}
