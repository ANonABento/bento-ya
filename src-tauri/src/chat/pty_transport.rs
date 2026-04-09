//! PTY-based transport for interactive terminal sessions.
//!
//! Spawns a process in a pseudo-terminal, providing full terminal emulation.
//! Output is raw bytes (base64-encoded for frontend), rendered in xterm.js.
//!
//! Uses `pty-process` crate with blocking I/O, three threads per session:
//! 1. Reader thread: reads PTY output via duped fd
//! 2. Exit watcher: `libc::waitpid(WNOHANG)` polling (macOS-safe)
//! 3. Async task: buffers output, sends events via broadcast channel

use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::{broadcast, mpsc};

use super::events::{base64_encode, ChatEvent};
use super::transport::{
    ChatTransport, SpawnConfig, TransportEvent,
    DEFAULT_SCROLLBACK_BYTES, OUTPUT_BUFFER_INTERVAL_MS,
};

/// PTY transport — interactive terminal session.
pub struct PtyTransport {
    /// Blocking PTY handle for write + resize
    pty: Option<pty_process::blocking::Pty>,
    /// Scrollback buffer for reconnection
    scrollback: Arc<Mutex<Vec<u8>>>,
    /// Broadcast sender for events (supports multiple receivers)
    event_broadcast: Option<broadcast::Sender<TransportEvent>>,
    /// Shutdown signal
    shutdown_tx: Option<mpsc::Sender<()>>,
    /// Process ID
    child_pid: Option<u32>,
    /// Whether the process is still running
    alive: Arc<AtomicBool>,
}

impl PtyTransport {
    pub fn new() -> Self {
        Self {
            pty: None,
            scrollback: Arc::new(Mutex::new(Vec::new())),
            event_broadcast: None,
            shutdown_tx: None,
            child_pid: None,
            alive: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Get the scrollback buffer as base64-encoded string.
    pub fn get_scrollback(&self) -> String {
        let sb = self.scrollback.lock().unwrap_or_else(|e| e.into_inner());
        base64_encode(&sb)
    }

    /// Create a new event receiver for this transport (for bridge reconnection).
    /// Returns None if no broadcast sender exists (transport not spawned).
    pub fn resubscribe(&self) -> Option<broadcast::Receiver<TransportEvent>> {
        self.event_broadcast.as_ref().map(|tx| tx.subscribe())
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

        let child = cmd
            .spawn(pts)
            .map_err(|e| format!("Failed to spawn PTY process: {}", e))?;

        let pid = child.id();

        // Dup the PTY fd for the reader thread
        let pty_fd = pty.as_raw_fd();
        let dup_fd = unsafe { libc::dup(pty_fd) };
        if dup_fd < 0 {
            return Err("Failed to dup PTY fd".to_string());
        }
        let reader_file = unsafe { std::fs::File::from_raw_fd(dup_fd) };

        self.child_pid = Some(pid);
        self.alive.store(true, Ordering::SeqCst);

        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        let (data_tx, mut data_rx) = mpsc::channel::<Vec<u8>>(256);
        let (exit_tx, mut exit_rx) = mpsc::channel::<()>(1);

        // Broadcast channel for events (supports multiple bridge receivers)
        let (broadcast_tx, _) = broadcast::channel::<TransportEvent>(256);
        self.event_broadcast = Some(broadcast_tx.clone());

        // Also create an mpsc for backward compat (returned to caller)
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

        // Child exit watcher thread
        let child_pid = pid as libc::pid_t;
        let alive_flag = Arc::clone(&self.alive);
        std::thread::spawn(move || {
            std::mem::forget(child);

            loop {
                let mut status: libc::c_int = 0;
                let result = unsafe { libc::waitpid(child_pid, &mut status, libc::WNOHANG) };
                if result == child_pid || result == -1 {
                    alive_flag.store(false, Ordering::SeqCst);
                    let _ = exit_tx.blocking_send(());
                    break;
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        });

        // Async task: buffer output and emit events to BOTH mpsc and broadcast
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
                            let event = TransportEvent::Chat(ChatEvent::RawOutput(
                                base64_encode(&buffer),
                            ));
                            let _ = event_tx.send(event.clone()).await;
                            let _ = broadcast_tx.send(event);
                            buffer.clear();
                        }
                        let exit_event = TransportEvent::Exited(None);
                        let _ = event_tx.send(exit_event.clone()).await;
                        let _ = broadcast_tx.send(exit_event);
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
                                    let event = TransportEvent::Chat(ChatEvent::RawOutput(
                                        base64_encode(&buffer),
                                    ));
                                    let _ = event_tx.send(event.clone()).await;
                                    let _ = broadcast_tx.send(event);
                                    buffer.clear();
                                }
                                let exit_event = TransportEvent::Exited(None);
                                let _ = event_tx.send(exit_event.clone()).await;
                                let _ = broadcast_tx.send(exit_event);
                                break;
                            }
                        }
                    }
                    _ = interval.tick() => {
                        if !buffer.is_empty() {
                            let event = TransportEvent::Chat(ChatEvent::RawOutput(
                                base64_encode(&buffer),
                            ));
                            let _ = event_tx.send(event.clone()).await;
                            let _ = broadcast_tx.send(event);
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
            .map_err(|e| format!("Failed to resize PTY: {}", e))
    }

    fn kill(&mut self) -> Result<(), String> {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.try_send(());
        }
        // Explicitly terminate the child process
        if let Some(pid) = self.child_pid {
            unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM); }
        }
        self.pty = None;
        self.alive.store(false, Ordering::SeqCst);
        Ok(())
    }

    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    fn pid(&self) -> Option<u32> {
        self.child_pid
    }

    fn scrollback(&self) -> String {
        self.get_scrollback()
    }
}

impl Default for PtyTransport {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pty_transport_new() {
        let transport = PtyTransport::new();
        assert!(!transport.is_alive());
        assert!(transport.pid().is_none());
        assert!(transport.get_scrollback().is_empty());
        assert!(transport.resubscribe().is_none());
    }
}
