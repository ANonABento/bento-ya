use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

const DEFAULT_SCROLLBACK_BYTES: usize = 5000 * 200;
const MAX_CONCURRENT_PTYS: usize = 5;
const OUTPUT_BUFFER_INTERVAL_MS: u64 = 16;

#[derive(Error, Debug)]
pub enum PtyError {
    #[error("PTY not found: {0}")]
    NotFound(String),
    #[error("Max concurrent PTYs reached ({0})")]
    MaxReached(usize),
    #[error("Failed to spawn PTY: {0}")]
    SpawnFailed(String),
    #[error("Failed to write to PTY: {0}")]
    WriteFailed(String),
    #[error("Failed to resize PTY: {0}")]
    ResizeFailed(String),
}

struct PtySession {
    #[allow(dead_code)]
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    scrollback: Arc<Mutex<Vec<u8>>>,
    #[allow(dead_code)]
    reader_handle: Option<JoinHandle<()>>,
    shutdown_tx: Option<mpsc::Sender<()>>,
    pid: Option<u32>,
}

pub struct PtyManager {
    sessions: HashMap<String, PtySession>,
    max_ptys: usize,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            max_ptys: MAX_CONCURRENT_PTYS,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn(
        &mut self,
        task_id: &str,
        command: &str,
        args: &[String],
        working_dir: Option<&str>,
        env_vars: Option<&HashMap<String, String>>,
        cols: u16,
        rows: u16,
        app_handle: AppHandle,
    ) -> Result<u32, PtyError> {
        if self.sessions.len() >= self.max_ptys {
            return Err(PtyError::MaxReached(self.max_ptys));
        }

        let pty_system = native_pty_system();
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system
            .openpty(size)
            .map_err(|e| PtyError::SpawnFailed(e.to_string()))?;

        let mut cmd = CommandBuilder::new(command);
        for arg in args {
            cmd.arg(arg);
        }

        if let Some(dir) = working_dir {
            cmd.cwd(dir);
        }

        if let Some(vars) = env_vars {
            for (key, value) in vars {
                cmd.env(key, value);
            }
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::SpawnFailed(e.to_string()))?;

        let pid = child.process_id();

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::SpawnFailed(e.to_string()))?;

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::SpawnFailed(e.to_string()))?;

        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        let (data_tx, mut data_rx) = mpsc::channel::<Vec<u8>>(256);

        // Channel for child process exit notification
        let (child_exit_tx, mut child_exit_rx) = mpsc::channel::<()>(1);

        // Dedicated reader thread (blocking I/O on PTY)
        let data_tx_clone = data_tx.clone();
        std::thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if data_tx_clone.blocking_send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        });

        // Child process watcher thread — waitpid to detect exit on macOS
        // (PTY read may not return EOF after child exits on macOS)
        std::thread::spawn(move || {
            let _ = child.wait(); // blocks until child exits
            drop(data_tx); // drop the other sender to signal reader task
            let _ = child_exit_tx.blocking_send(());
        });

        let scrollback: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
        let scrollback_writer = Arc::clone(&scrollback);
        let task_id_emit = task_id.to_string();

        // Async task: buffer output at ~60fps and emit Tauri events
        let reader_handle = tokio::spawn(async move {
            let mut buffer = Vec::new();
            let mut interval =
                tokio::time::interval(Duration::from_millis(OUTPUT_BUFFER_INTERVAL_MS));

            loop {
                tokio::select! {
                    _ = shutdown_rx.recv() => {
                        break;
                    }
                    _ = child_exit_rx.recv() => {
                        // Child process exited (waitpid returned)
                        // Drain any remaining data from the reader
                        while let Ok(bytes) = data_rx.try_recv() {
                            buffer.extend_from_slice(&bytes);
                        }
                        if !buffer.is_empty() {
                            let _ = app_handle.emit(
                                &format!("pty:{}:output", task_id_emit),
                                base64_encode(&buffer),
                            );
                            buffer.clear();
                        }
                        let _ = app_handle.emit(
                            &format!("pty:{}:exit", task_id_emit),
                            serde_json::json!({ "taskId": task_id_emit }),
                        );
                        break;
                    }
                    data = data_rx.recv() => {
                        match data {
                            Some(bytes) => {
                                buffer.extend_from_slice(&bytes);

                                if let Ok(mut sb) = scrollback_writer.lock() {
                                    sb.extend_from_slice(&bytes);
                                    if sb.len() > DEFAULT_SCROLLBACK_BYTES {
                                        let drain_to = sb.len() - DEFAULT_SCROLLBACK_BYTES;
                                        sb.drain(..drain_to);
                                    }
                                }
                            }
                            None => {
                                // Reader thread exited — flush and emit exit
                                if !buffer.is_empty() {
                                    let _ = app_handle.emit(
                                        &format!("pty:{}:output", task_id_emit),
                                        base64_encode(&buffer),
                                    );
                                    buffer.clear();
                                }
                                let _ = app_handle.emit(
                                    &format!("pty:{}:exit", task_id_emit),
                                    serde_json::json!({ "taskId": task_id_emit }),
                                );
                                break;
                            }
                        }
                    }
                    _ = interval.tick() => {
                        if !buffer.is_empty() {
                            let _ = app_handle.emit(
                                &format!("pty:{}:output", task_id_emit),
                                base64_encode(&buffer),
                            );
                            buffer.clear();
                        }
                    }
                }
            }
        });

        let session = PtySession {
            master: pair.master,
            writer,
            scrollback,
            reader_handle: Some(reader_handle),
            shutdown_tx: Some(shutdown_tx),
            pid,
        };

        self.sessions.insert(task_id.to_string(), session);
        Ok(pid.unwrap_or(0))
    }

    pub fn write(&mut self, task_id: &str, data: &[u8]) -> Result<(), PtyError> {
        let session = self
            .sessions
            .get_mut(task_id)
            .ok_or_else(|| PtyError::NotFound(task_id.to_string()))?;

        session
            .writer
            .write_all(data)
            .map_err(|e| PtyError::WriteFailed(e.to_string()))?;

        session
            .writer
            .flush()
            .map_err(|e| PtyError::WriteFailed(e.to_string()))?;

        Ok(())
    }

    pub fn resize(&self, task_id: &str, cols: u16, rows: u16) -> Result<(), PtyError> {
        let session = self
            .sessions
            .get(task_id)
            .ok_or_else(|| PtyError::NotFound(task_id.to_string()))?;

        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyError::ResizeFailed(e.to_string()))?;

        Ok(())
    }

    pub fn kill(&mut self, task_id: &str) -> Result<(), PtyError> {
        let session = self
            .sessions
            .remove(task_id)
            .ok_or_else(|| PtyError::NotFound(task_id.to_string()))?;

        if let Some(tx) = &session.shutdown_tx {
            let _ = tx.try_send(());
        }

        drop(session);
        Ok(())
    }

    pub fn get_scrollback(&self, task_id: &str) -> Result<String, PtyError> {
        let session = self
            .sessions
            .get(task_id)
            .ok_or_else(|| PtyError::NotFound(task_id.to_string()))?;

        let sb = session.scrollback.lock().unwrap_or_else(|e| e.into_inner());
        Ok(base64_encode(&sb))
    }

    pub fn active_sessions(&self) -> Vec<(String, Option<u32>)> {
        self.sessions
            .iter()
            .map(|(id, s)| (id.clone(), s.pid))
            .collect()
    }

    pub fn has_session(&self, task_id: &str) -> bool {
        self.sessions.contains_key(task_id)
    }

    pub fn shutdown_all(&mut self) {
        let task_ids: Vec<String> = self.sessions.keys().cloned().collect();
        for task_id in task_ids {
            let _ = self.kill(&task_id);
        }
    }
}

impl Drop for PtyManager {
    fn drop(&mut self) {
        self.shutdown_all();
    }
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}
