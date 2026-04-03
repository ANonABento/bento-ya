use std::collections::HashMap;
use std::io::{Read, Write};
use std::os::fd::FromRawFd;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::chat::events::base64_encode;
use crate::chat::transport::{DEFAULT_SCROLLBACK_BYTES, OUTPUT_BUFFER_INTERVAL_MS};

const MAX_CONCURRENT_PTYS: usize = 5;

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
    /// Blocking PTY handle for write + resize (kept on main thread)
    pty: pty_process::blocking::Pty,
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

        // Open blocking PTY (used for write/resize from sync context)
        let (pty, pts) =
            pty_process::blocking::open().map_err(|e| PtyError::SpawnFailed(e.to_string()))?;

        pty.resize(pty_process::Size::new(rows, cols))
            .map_err(|e| PtyError::ResizeFailed(e.to_string()))?;

        // Build and spawn the command
        let mut cmd = pty_process::blocking::Command::new(command);
        for arg in args {
            cmd = cmd.arg(arg);
        }
        if let Some(dir) = working_dir {
            cmd = cmd.current_dir(dir);
        }
        if let Some(vars) = env_vars {
            for (key, value) in vars {
                cmd = cmd.env(key, value);
            }
        }

        let mut child = cmd
            .spawn(pts)
            .map_err(|e| PtyError::SpawnFailed(e.to_string()))?;

        let pid = child.id();

        // Dup the PTY fd for the reader thread (blocking::Pty doesn't have try_clone)
        use std::os::fd::AsRawFd;
        let pty_fd = pty.as_raw_fd();
        let dup_fd = unsafe { libc::dup(pty_fd) };
        if dup_fd < 0 {
            return Err(PtyError::SpawnFailed("Failed to dup PTY fd".to_string()));
        }
        let reader_file = unsafe { std::fs::File::from_raw_fd(dup_fd) };

        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        let (data_tx, mut data_rx) = mpsc::channel::<Vec<u8>>(256);
        let (exit_tx, mut exit_rx) = mpsc::channel::<()>(1);

        // Blocking reader thread — reads PTY output via duped fd
        std::thread::spawn(move || {
            let mut reader = reader_file;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if data_tx.blocking_send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        });

        // Child exit watcher thread — uses libc::waitpid directly
        // std::process::Child::wait() can block on macOS due to PTY process group,
        // so we poll with WNOHANG instead
        let child_pid = pid as libc::pid_t;
        std::thread::spawn(move || {
            // Drop the Child to avoid double-wait conflicts, but DON'T call wait()
            // which blocks. We'll poll waitpid ourselves.
            std::mem::forget(child); // Prevent Child destructor from calling wait/kill

            loop {
                let mut status: libc::c_int = 0;
                let result = unsafe { libc::waitpid(child_pid, &mut status, libc::WNOHANG) };
                if result == child_pid {
                    // Child exited
                    let _ = exit_tx.blocking_send(());
                    break;
                } else if result == -1 {
                    // Error (e.g., no such process) — treat as exited
                    let _ = exit_tx.blocking_send(());
                    break;
                }
                // Not yet exited — poll again
                std::thread::sleep(Duration::from_millis(250));
            }
        });

        let scrollback: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
        let scrollback_writer = Arc::clone(&scrollback);
        let task_id_emit = task_id.to_string();

        // Async task: buffer output and emit Tauri events
        let reader_handle = tokio::spawn(async move {
            let mut buffer = Vec::new();
            let mut interval =
                tokio::time::interval(Duration::from_millis(OUTPUT_BUFFER_INTERVAL_MS));

            loop {
                tokio::select! {
                    _ = shutdown_rx.recv() => {
                        break;
                    }
                    _ = exit_rx.recv() => {
                        // Child exited (waitpid returned)
                        // Drain remaining data
                        while let Ok(bytes) = data_rx.try_recv() {
                            buffer.extend_from_slice(&bytes);
                        }
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        while let Ok(bytes) = data_rx.try_recv() {
                            buffer.extend_from_slice(&bytes);
                        }
                        // Flush
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
                                // Reader thread exited (EOF) — flush and exit
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
            pty,
            scrollback,
            reader_handle: Some(reader_handle),
            shutdown_tx: Some(shutdown_tx),
            pid: Some(pid),
        };

        self.sessions.insert(task_id.to_string(), session);
        Ok(pid)
    }

    pub fn write(&mut self, task_id: &str, data: &[u8]) -> Result<(), PtyError> {
        let session = self
            .sessions
            .get_mut(task_id)
            .ok_or_else(|| PtyError::NotFound(task_id.to_string()))?;

        session
            .pty
            .write_all(data)
            .map_err(|e| PtyError::WriteFailed(e.to_string()))?;

        session
            .pty
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
            .pty
            .resize(pty_process::Size::new(rows, cols))
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
