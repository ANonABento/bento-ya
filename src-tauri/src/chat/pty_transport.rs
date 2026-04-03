//! PTY-based transport for interactive terminal sessions.
//!
//! Spawns a process in a pseudo-terminal, providing full terminal emulation.
//! Output is raw bytes (base64-encoded for frontend), rendered in xterm.js.
//!
//! Uses `pty-process` crate with blocking I/O, three threads per session:
//! 1. Reader thread: reads PTY output via duped fd
//! 2. Exit watcher: `libc::waitpid(WNOHANG)` polling (macOS-safe)
//! 3. Async task: buffers output, sends events via channel

use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::mpsc;

use super::events::ChatEvent;
use super::transport::{ChatTransport, SpawnConfig, TransportEvent};

const OUTPUT_BUFFER_INTERVAL_MS: u64 = 16;
const DEFAULT_SCROLLBACK_BYTES: usize = 5000 * 200;

/// PTY transport — interactive terminal session.
pub struct PtyTransport {
    /// Blocking PTY handle for write + resize
    pty: Option<pty_process::blocking::Pty>,
    /// Scrollback buffer for reconnection
    scrollback: Arc<Mutex<Vec<u8>>>,
    /// Shutdown signal
    shutdown_tx: Option<mpsc::Sender<()>>,
    /// Process ID
    child_pid: Option<u32>,
    /// Whether the process is still running
    alive: Arc<std::sync::atomic::AtomicBool>,
}

impl PtyTransport {
    pub fn new() -> Self {
        Self {
            pty: None,
            scrollback: Arc::new(Mutex::new(Vec::new())),
            shutdown_tx: None,
            child_pid: None,
            alive: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    /// Get the scrollback buffer as base64-encoded string.
    pub fn get_scrollback(&self) -> String {
        let sb = self.scrollback.lock().unwrap_or_else(|e| e.into_inner());
        base64_encode(&sb)
    }
}

impl ChatTransport for PtyTransport {
    fn spawn(&mut self, config: SpawnConfig) -> Result<mpsc::Receiver<TransportEvent>, String> {
        let cols = config.cols;
        let rows = config.rows;

        // Open blocking PTY
        let (pty, pts) =
            pty_process::blocking::open().map_err(|e| format!("Failed to open PTY: {}", e))?;

        pty.resize(pty_process::Size::new(rows, cols))
            .map_err(|e| format!("Failed to resize PTY: {}", e))?;

        // Build and spawn the command
        let mut cmd = pty_process::blocking::Command::new(&config.command);
        for arg in &config.args {
            cmd = cmd.arg(arg);
        }
        if let Some(ref dir) = config.working_dir {
            cmd = cmd.current_dir(dir);
        }
        if let Some(ref vars) = config.env_vars {
            for (key, value) in vars {
                cmd = cmd.env(key, value);
            }
        }

        let mut child = cmd
            .spawn(pts)
            .map_err(|e| format!("Failed to spawn PTY process: {}", e))?;

        let pid = child.id();
        self.child_pid = Some(pid);
        self.alive.store(true, std::sync::atomic::Ordering::SeqCst);

        // Dup the PTY fd for the reader thread
        let pty_fd = pty.as_raw_fd();
        let dup_fd = unsafe { libc::dup(pty_fd) };
        if dup_fd < 0 {
            return Err("Failed to dup PTY fd".to_string());
        }
        let reader_file = unsafe { std::fs::File::from_raw_fd(dup_fd) };

        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        let (data_tx, mut data_rx) = mpsc::channel::<Vec<u8>>(256);
        let (exit_tx, mut exit_rx) = mpsc::channel::<()>(1);
        let (event_tx, event_rx) = mpsc::channel::<TransportEvent>(256);

        // Store PTY handle for write/resize
        self.pty = Some(pty);
        self.shutdown_tx = Some(shutdown_tx);

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
        let child_pid = pid as libc::pid_t;
        let alive_flag = Arc::clone(&self.alive);
        std::thread::spawn(move || {
            // Prevent Child destructor from calling wait/kill
            std::mem::forget(child);

            loop {
                let mut status: libc::c_int = 0;
                let result = unsafe { libc::waitpid(child_pid, &mut status, libc::WNOHANG) };
                if result == child_pid || result == -1 {
                    alive_flag.store(false, std::sync::atomic::Ordering::SeqCst);
                    let _ = exit_tx.blocking_send(());
                    break;
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        });

        // Async task: buffer output and emit events
        let scrollback_writer = Arc::clone(&self.scrollback);
        tokio::spawn(async move {
            let mut buffer = Vec::new();
            let mut interval =
                tokio::time::interval(Duration::from_millis(OUTPUT_BUFFER_INTERVAL_MS));

            loop {
                tokio::select! {
                    _ = shutdown_rx.recv() => {
                        break;
                    }
                    _ = exit_rx.recv() => {
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
                            let _ = event_tx
                                .send(TransportEvent::Chat(ChatEvent::RawOutput(
                                    base64_encode(&buffer),
                                )))
                                .await;
                            buffer.clear();
                        }
                        let _ = event_tx.send(TransportEvent::Exited(None)).await;
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
                                // Reader thread exited (EOF)
                                if !buffer.is_empty() {
                                    let _ = event_tx
                                        .send(TransportEvent::Chat(ChatEvent::RawOutput(
                                            base64_encode(&buffer),
                                        )))
                                        .await;
                                    buffer.clear();
                                }
                                let _ = event_tx.send(TransportEvent::Exited(None)).await;
                                break;
                            }
                        }
                    }
                    _ = interval.tick() => {
                        if !buffer.is_empty() {
                            let _ = event_tx
                                .send(TransportEvent::Chat(ChatEvent::RawOutput(
                                    base64_encode(&buffer),
                                )))
                                .await;
                            buffer.clear();
                        }
                    }
                }
            }
        });

        Ok(event_rx)
    }

    fn write(&mut self, data: &[u8]) -> Result<(), String> {
        let pty = self.pty.as_mut().ok_or("PTY not spawned")?;
        pty.write_all(data)
            .map_err(|e| format!("Failed to write to PTY: {}", e))?;
        pty.flush()
            .map_err(|e| format!("Failed to flush PTY: {}", e))?;
        Ok(())
    }

    fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String> {
        let pty = self.pty.as_ref().ok_or("PTY not spawned")?;
        pty.resize(pty_process::Size::new(rows, cols))
            .map_err(|e| format!("Failed to resize PTY: {}", e))?;
        Ok(())
    }

    fn kill(&mut self) -> Result<(), String> {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.try_send(());
        }
        self.pty = None;
        self.alive.store(false, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }

    fn is_alive(&self) -> bool {
        self.alive.load(std::sync::atomic::Ordering::SeqCst)
    }

    fn pid(&self) -> Option<u32> {
        self.child_pid
    }
}

impl Default for PtyTransport {
    fn default() -> Self {
        Self::new()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base64_encode() {
        assert_eq!(base64_encode(b"hello"), "aGVsbG8=");
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"a"), "YQ==");
        assert_eq!(base64_encode(b"ab"), "YWI=");
        assert_eq!(base64_encode(b"abc"), "YWJj");
    }

    #[test]
    fn test_pty_transport_new() {
        let transport = PtyTransport::new();
        assert!(!transport.is_alive());
        assert!(transport.pid().is_none());
    }
}
