//! tmux-based transport for universal terminal sessions.
//!
//! Wraps each task's terminal in a tmux session, providing:
//! - Proper resize propagation (SIGWINCH) for TUI apps
//! - Session persistence across app restarts
//! - Clean scrollback capture via `capture-pane`
//! - Structured completion detection via `wait-for`
//!
//! Architecture:
//!   tmux new-session -d -s "kaitencode_{id}" (detached server-side session)
//!   tmux attach-session -t "kaitencode_{id}" (spawned in a PTY for xterm.js output)
//!     └─ reader thread → broadcast channel → ManagedBridge → frontend
//!
//! User input flows through the attached PTY stdin (same as raw PtyTransport).
//! Trigger commands use `tmux send-keys` for injection.
//! Resize uses `tmux resize-window` (propagates SIGWINCH to all panes).

use std::io::{Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{broadcast, mpsc};

use super::events::{base64_encode, ChatEvent};
use super::transport::{ChatTransport, SpawnConfig, TransportEvent, OUTPUT_BUFFER_INTERVAL_MS};

#[cfg(test)]
static TMUX_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[cfg(test)]
pub(crate) async fn tmux_test_lock_async() -> tokio::sync::MutexGuard<'static, ()> {
    TMUX_TEST_LOCK.lock().await
}

#[cfg(test)]
pub(crate) fn tmux_test_lock_blocking() -> tokio::sync::MutexGuard<'static, ()> {
    TMUX_TEST_LOCK.blocking_lock()
}

/// Prefix for tmux session names to avoid collision with user sessions.
const SESSION_PREFIX: &str = "kaitencode_";
const LEGACY_SESSION_PREFIXES: &[&str] = &["bentoya_"];

fn tmux_server_missing(stderr: &str) -> bool {
    stderr.contains("no server running")
        || stderr.contains("error connecting to")
        || stderr.contains("No such file or directory")
}

pub fn default_user_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|shell| !shell.trim().is_empty())
        .unwrap_or_else(|| {
            if cfg!(target_os = "macos") {
                "/bin/zsh".to_string()
            } else {
                "/bin/sh".to_string()
            }
        })
}

/// Check if tmux is available on the system.
/// Returns the version string on success, or an error message.
pub fn check_tmux() -> Result<String, String> {
    Command::new("tmux")
        .arg("-V")
        .output()
        .map_err(|e| format!("tmux not found: {}. Install with: brew install tmux", e))
        .and_then(|output| {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                Err("tmux -V failed".to_string())
            }
        })
}

/// Ensure the tmux server is running and configured for pipeline use.
/// Auto-starts a detached default session if needed, and sets exit-empty off
/// so the server survives when all sessions are killed (e.g. by GC).
pub fn ensure_tmux_server() -> Result<(), String> {
    // Check if server is running
    let check = Command::new("tmux")
        .arg("list-sessions")
        .output()
        .map_err(|e| format!("tmux not found: {}", e))?;

    if !check.status.success() {
        let stderr = String::from_utf8_lossy(&check.stderr);
        if tmux_server_missing(&stderr) {
            eprintln!("[tmux] Server not running — auto-starting");
            let start = Command::new("tmux")
                .args(["new-session", "-d", "-s", "default"])
                .output()
                .map_err(|e| format!("tmux server could not be started: {}", e))?;
            if !start.status.success() {
                return Err(format!(
                    "tmux auto-start failed: {}",
                    String::from_utf8_lossy(&start.stderr)
                ));
            }
            eprintln!("[tmux] Server auto-started successfully");
        } else {
            return Err(format!("tmux error: {}", stderr.trim()));
        }
    }

    // Set exit-empty off so server survives when GC kills all sessions
    let _ = Command::new("tmux")
        .args(["set-option", "-s", "exit-empty", "off"])
        .output();

    // Terminal-fidelity defaults for the agent TUIs we host. Set globally
    // before any session is created so every pane inherits them.
    //
    // - history-limit: tmux defaults to ~2000 lines; a long agent run scrolls
    //   its early output out of reach. 50k keeps a full session in scrollback.
    //   (Only affects panes created AFTER it's set — hence here, pre-session.)
    // - mouse: lets the user scroll/click inside the agent's TUI (pagers,
    //   menus, selection) exactly like a real terminal.
    let _ = Command::new("tmux")
        .args(["set-option", "-g", "history-limit", "50000"])
        .output();
    let _ = Command::new("tmux")
        .args(["set-option", "-g", "mouse", "on"])
        .output();

    Ok(())
}

/// List existing KaitenCode tmux sessions, including legacy names.
/// Returns session names (e.g., ["kaitencode_task-123", "bentoya_task-456"]).
pub fn list_sessions() -> Vec<String> {
    Command::new("tmux")
        .args(["list-sessions", "-F", "#{session_name}"])
        .output()
        .ok()
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter(|line| {
                    line.starts_with(SESSION_PREFIX)
                        || LEGACY_SESSION_PREFIXES
                            .iter()
                            .any(|prefix| line.starts_with(prefix))
                })
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default()
}

/// Extract task_id from a tmux session name.
pub fn session_name_to_task_id(session_name: &str) -> Option<&str> {
    session_name.strip_prefix(SESSION_PREFIX).or_else(|| {
        LEGACY_SESSION_PREFIXES
            .iter()
            .find_map(|prefix| session_name.strip_prefix(prefix))
    })
}

/// Build the tmux session name for a task.
pub fn session_name(task_id: &str) -> String {
    format!("{}{}", SESSION_PREFIX, task_id)
}

fn session_names_for_task(task_id: &str) -> Vec<String> {
    let mut names = vec![session_name(task_id)];
    names.extend(
        LEGACY_SESSION_PREFIXES
            .iter()
            .map(|prefix| format!("{}{}", prefix, task_id)),
    );
    names
}

fn tmux_has_session_name(name: &str) -> bool {
    Command::new("tmux")
        .args(["has-session", "-t", name])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn existing_session_name(task_id: &str) -> Option<String> {
    session_names_for_task(task_id)
        .into_iter()
        .find(|name| tmux_has_session_name(name))
}

fn target_session_name(task_id: &str) -> String {
    existing_session_name(task_id).unwrap_or_else(|| session_name(task_id))
}

/// Check if a tmux session exists.
pub fn has_session(task_id: &str) -> bool {
    existing_session_name(task_id).is_some()
}

/// Kill a tmux session by task id.
pub fn kill_session(task_id: &str) -> Result<(), String> {
    for name in session_names_for_task(task_id) {
        let output = Command::new("tmux")
            .args(["kill-session", "-t", &name])
            .output()
            .map_err(|e| format!("Failed to kill tmux session: {}", e))?;
        if !output.status.success() {
            // Session might already be dead — not an error
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !tmux_server_missing(&stderr)
                && !stderr.contains("session not found")
                && !stderr.contains("can't find session")
            {
                return Err(format!("tmux kill-session failed: {}", stderr));
            }
        }
    }
    Ok(())
}

/// Capture scrollback for a task's tmux session as raw text.
pub fn capture_scrollback_text(task_id: &str) -> String {
    Command::new("tmux")
        .args([
            "capture-pane",
            "-t",
            &target_session_name(task_id),
            "-p",
            "-e",
            "-J",
            "-S",
            "-",
        ])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default()
}

/// Capture scrollback for a task's tmux session as base64-encoded text.
pub fn capture_scrollback(task_id: &str) -> String {
    base64_encode(capture_scrollback_text(task_id).as_bytes())
}

/// Send a literal line of user input to the task's tmux pane.
pub fn send_text_line(task_id: &str, text: &str) -> Result<(), String> {
    let name = target_session_name(task_id);
    let output = Command::new("tmux")
        .args(["send-keys", "-t", &name, "-l", text])
        .output()
        .map_err(|e| format!("Failed to send text to tmux: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "tmux send-keys failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let output = Command::new("tmux")
        .args(["send-keys", "-t", &name, "Enter"])
        .output()
        .map_err(|e| format!("Failed to send Enter to tmux: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "tmux send-keys Enter failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(())
}

/// tmux transport — wraps a tmux session with an attached PTY client.
pub struct TmuxTransport {
    /// Task ID used for tmux session naming
    task_id: String,
    /// Blocking PTY handle for writing to the attached tmux client
    pty: Option<pty_process::blocking::Pty>,
    /// Broadcast sender for events (supports multiple receivers)
    event_broadcast: Option<broadcast::Sender<TransportEvent>>,
    /// Shutdown signal for the reader/buffer tasks
    shutdown_tx: Option<mpsc::Sender<()>>,
    /// PID of the `tmux attach` process (not the shell inside tmux)
    attach_pid: Option<u32>,
    /// Whether the tmux attach process is alive (fast check, no subprocess)
    alive: Arc<AtomicBool>,
    /// Whether we own the tmux session (created it) vs reconnecting to existing
    owns_session: bool,
    /// Cached PID of the shell inside tmux (queried once, then cached)
    cached_pane_pid: Option<u32>,
}

impl TmuxTransport {
    pub fn new(task_id: &str) -> Self {
        Self {
            task_id: task_id.to_string(),
            pty: None,
            event_broadcast: None,
            shutdown_tx: None,
            attach_pid: None,
            alive: Arc::new(AtomicBool::new(false)),
            owns_session: false,
            cached_pane_pid: None,
        }
    }

    /// Create a transport for an existing tmux session (reconnect mode).
    pub fn reconnect(task_id: &str) -> Result<Self, String> {
        if !has_session(task_id) {
            return Err(format!("No tmux session found for task {}", task_id));
        }
        let mut transport = Self::new(task_id);
        transport.alive.store(true, Ordering::SeqCst);
        transport.owns_session = false;
        Ok(transport)
    }

    /// Get scrollback from tmux via capture-pane (preserves escape sequences).
    fn capture_scrollback(&self) -> String {
        capture_scrollback(&self.task_id)
    }

    /// Create the tmux session (detached).
    fn create_session(&self, config: &SpawnConfig) -> Result<(), String> {
        let name = session_name(&self.task_id);
        let mut args = vec![
            "new-session".to_string(),
            "-d".to_string(),
            "-s".to_string(),
            name.clone(),
            "-x".to_string(),
            config.cols.to_string(),
            "-y".to_string(),
            config.rows.to_string(),
        ];

        // Set working directory
        if let Some(ref dir) = config.working_dir {
            if std::path::Path::new(dir).exists() {
                args.push("-c".to_string());
                args.push(dir.clone());
            }
        }

        // Spawn the shell command inside tmux
        // If command is a shell ($SHELL), tmux uses its default shell
        // If it's something else, pass it as the tmux command
        let shell = default_user_shell();
        if config.command != shell {
            args.push(config.command.clone());
            for arg in &config.args {
                args.push(arg.clone());
            }
        }

        let output = Command::new("tmux")
            .args(&args)
            .envs(config.env_vars.as_ref().cloned().unwrap_or_default())
            .output()
            .map_err(|e| format!("Failed to create tmux session: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("tmux new-session failed: {}", stderr.trim()));
        }

        Ok(())
    }

    /// Attach to the tmux session in a PTY (for xterm.js output).
    fn attach_in_pty(&mut self) -> Result<mpsc::Receiver<TransportEvent>, String> {
        let name = target_session_name(&self.task_id);

        // Open blocking PTY
        let (pty, pts) =
            pty_process::blocking::open().map_err(|e| format!("Failed to open PTY: {}", e))?;

        // Build tmux attach command
        let mut cmd = pty_process::blocking::Command::new("tmux");
        cmd = cmd.arg("attach-session").arg("-t").arg(&name);

        let child = cmd
            .spawn(pts)
            .map_err(|e| format!("Failed to spawn tmux attach: {}", e))?;

        let pid = child.id();

        // Dup the PTY fd for the reader thread
        let pty_fd = pty.as_raw_fd();
        let dup_fd = unsafe { libc::dup(pty_fd) };
        if dup_fd < 0 {
            return Err("Failed to dup PTY fd".to_string());
        }
        let reader_file = unsafe { std::fs::File::from_raw_fd(dup_fd) };

        self.attach_pid = Some(pid);
        self.alive.store(true, Ordering::SeqCst);

        // Cache the pane PID (shell inside tmux) to avoid subprocess per pid() call
        self.cached_pane_pid = Command::new("tmux")
            .args(["display-message", "-t", &name, "-p", "#{pane_pid}"])
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    String::from_utf8_lossy(&o.stdout)
                        .trim()
                        .parse::<u32>()
                        .ok()
                } else {
                    None
                }
            });

        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        let (data_tx, mut data_rx) = mpsc::channel::<Vec<u8>>(256);
        let (exit_tx, mut exit_rx) = mpsc::channel::<()>(1);

        // Broadcast channel for events
        let (broadcast_tx, _) = broadcast::channel::<TransportEvent>(256);
        self.event_broadcast = Some(broadcast_tx.clone());

        // mpsc for trait compat (returned to caller)
        let (event_tx, event_rx) = mpsc::channel::<TransportEvent>(256);

        self.pty = Some(pty);
        self.shutdown_tx = Some(shutdown_tx);

        // Blocking reader thread — reads output from tmux attach PTY
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

        // Child exit watcher thread (for tmux attach process)
        let child_pid = pid as libc::pid_t;
        let alive_flag = Arc::clone(&self.alive);
        let task_id_for_watcher = self.task_id.clone();
        std::thread::spawn(move || {
            std::mem::forget(child);

            loop {
                let mut status: libc::c_int = 0;
                let result = unsafe { libc::waitpid(child_pid, &mut status, libc::WNOHANG) };
                if result == child_pid || result == -1 {
                    // tmux attach exited — check if session is still alive
                    let session_alive = has_session(&task_id_for_watcher);
                    if !session_alive {
                        alive_flag.store(false, Ordering::SeqCst);
                    }
                    let _ = exit_tx.blocking_send(());
                    break;
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        });

        // Async buffer task: batch output and emit events
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
                            }
                            None => {
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
}

impl ChatTransport for TmuxTransport {
    fn spawn(&mut self, config: SpawnConfig) -> Result<mpsc::Receiver<TransportEvent>, String> {
        if has_session(&self.task_id) {
            // Session already exists — reattach instead of killing.
            // This preserves running agents across app restarts.
            eprintln!(
                "[tmux] Reattaching to existing session: {}",
                target_session_name(&self.task_id)
            );
            self.owns_session = true; // Take ownership since we're managing it now
            return self.attach_in_pty();
        }

        // Create detached tmux session
        self.create_session(&config)?;
        self.owns_session = true;

        // Attach to it in a PTY for output streaming
        self.attach_in_pty()
    }

    fn write(&mut self, data: &[u8]) -> Result<(), String> {
        // Write directly to the attached tmux client's PTY stdin.
        // This is the same as typing in the terminal — tmux forwards to the active pane.
        let pty = self.pty.as_mut().ok_or("Not attached to tmux session")?;
        pty.write_all(data)
            .map_err(|e| format!("Failed to write to tmux PTY: {}", e))?;
        pty.flush()
            .map_err(|e| format!("Failed to flush tmux PTY: {}", e))?;
        Ok(())
    }

    fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String> {
        // Resize the tmux window — propagates SIGWINCH to all panes
        let output = Command::new("tmux")
            .args([
                "resize-window",
                "-t",
                &target_session_name(&self.task_id),
                "-x",
                &cols.to_string(),
                "-y",
                &rows.to_string(),
            ])
            .output()
            .map_err(|e| format!("Failed to resize tmux: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // "no server running" or session gone — not critical
            if !stderr.contains("no server") && !stderr.contains("not found") {
                return Err(format!("tmux resize-window failed: {}", stderr.trim()));
            }
        }

        // Also resize the local PTY so xterm.js dimensions match
        if let Some(ref pty) = self.pty {
            let _ = pty.resize(pty_process::Size::new(rows, cols));
        }

        Ok(())
    }

    fn kill(&mut self) -> Result<(), String> {
        eprintln!(
            "[tmux-transport] kill() called for task {} (owns_session={})",
            self.task_id, self.owns_session
        );
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.try_send(());
        }
        // Kill the attach process
        if let Some(pid) = self.attach_pid {
            eprintln!(
                "[tmux-transport] Killing attach PID {} for task {}",
                pid, self.task_id
            );
            unsafe {
                libc::kill(pid as libc::pid_t, libc::SIGTERM);
            }
        }
        // Kill the tmux session if we own it
        if self.owns_session {
            eprintln!(
                "[tmux-transport] Killing owned session for task {}",
                self.task_id
            );
            let _ = kill_session(&self.task_id);
        }
        self.pty = None;
        self.alive.store(false, Ordering::SeqCst);
        Ok(())
    }

    fn is_alive(&self) -> bool {
        // Fast path: if the attach process is running, session is alive
        self.alive.load(Ordering::SeqCst)
        // Note: we don't shell out to `tmux has-session` here for performance.
        // If the attach process dies but tmux session survives (rare edge case),
        // the session will be detected as dead. On next ensure_pty_session,
        // spawn() will find the existing tmux session and reattach.
    }

    fn pid(&self) -> Option<u32> {
        // Return cached PID if available (avoids subprocess per call)
        if let Some(pid) = self.cached_pane_pid {
            return Some(pid);
        }
        self.attach_pid
    }

    fn scrollback(&self) -> String {
        self.capture_scrollback()
    }

    fn resubscribe(&self) -> Option<broadcast::Receiver<TransportEvent>> {
        self.event_broadcast.as_ref().map(|tx| tx.subscribe())
    }
}

impl Default for TmuxTransport {
    fn default() -> Self {
        Self::new("default")
    }
}

/// Send Ctrl+C to the agent process in a tmux session (cancel without killing session).
pub fn cancel_agent(task_id: &str) {
    let name = target_session_name(task_id);
    let _ = Command::new("tmux")
        .args(["send-keys", "-t", &name, "C-c"])
        .output();
}

/// Cancel a running agent and update DB status.
/// Sends Ctrl+C to tmux, sets agent_status=cancelled, updates agent_session.
pub fn cancel_task_agent(
    conn: &rusqlite::Connection,
    task_id: &str,
    agent_session_id: Option<&str>,
) {
    cancel_agent(task_id);
    let _ = crate::db::update_task_agent_status(conn, task_id, Some("cancelled"), None);
    if let Some(sid) = agent_session_id {
        let _ = crate::db::update_agent_session(
            conn,
            sid,
            None,
            Some("cancelled"),
            None,
            None,
            None,
            None,
        );
    }
}

/// Kill all KaitenCode tmux sessions, including legacy names.
pub fn kill_all_sessions() {
    for session in list_sessions() {
        let _ = Command::new("tmux")
            .args(["kill-session", "-t", &session])
            .output();
    }
}

/// Clean up orphaned sessions not present in the given set of active task IDs.
pub fn cleanup_orphaned_sessions(active_task_ids: &[&str]) {
    for session_name in list_sessions() {
        if let Some(task_id) = session_name_to_task_id(&session_name) {
            if !active_task_ids.contains(&task_id) {
                eprintln!("[tmux] Cleaning up orphaned session: {}", session_name);
                let _ = Command::new("tmux")
                    .args(["kill-session", "-t", &session_name])
                    .output();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    fn tmux_available() -> bool {
        Command::new("tmux")
            .arg("-V")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn create_shell_session(task_id: &str) {
        ensure_tmux_server().expect("tmux server");
        let _ = kill_session(task_id);
        let output = Command::new("tmux")
            .args(["new-session", "-d", "-s", &session_name(task_id), "/bin/sh"])
            .output()
            .expect("create tmux session");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn test_session_name() {
        assert_eq!(session_name("task-123"), "kaitencode_task-123");
    }

    #[test]
    fn test_session_name_to_task_id() {
        assert_eq!(
            session_name_to_task_id("kaitencode_task-123"),
            Some("task-123")
        );
        assert_eq!(
            session_name_to_task_id("bentoya_task-123"),
            Some("task-123")
        );
        assert_eq!(session_name_to_task_id("other_session"), None);
    }

    #[test]
    fn test_check_tmux() {
        // Should succeed if tmux is installed
        let result = check_tmux();
        assert!(result.is_ok(), "tmux not found: {:?}", result);
        assert!(result.unwrap().contains("tmux"));
    }

    #[test]
    fn test_has_session_nonexistent() {
        assert!(!has_session("nonexistent-task-id-12345"));
    }

    #[test]
    fn send_text_line_writes_to_existing_tmux_session() {
        if !tmux_available() {
            eprintln!("tmux not available, skipping");
            return;
        }
        let _tmux_guard = tmux_test_lock_blocking();

        let task_id = format!("test-send-line-{}", uuid::Uuid::new_v4());
        create_shell_session(&task_id);

        send_text_line(&task_id, "echo KAITENCODE_SEND_TEXT_LINE_MARK").expect("send text line");
        thread::sleep(Duration::from_millis(250));

        let output = Command::new("tmux")
            .args([
                "capture-pane",
                "-t",
                &session_name(&task_id),
                "-p",
                "-S",
                "-",
            ])
            .output()
            .expect("capture pane");
        let decoded = String::from_utf8_lossy(&output.stdout);
        assert!(
            decoded.contains("KAITENCODE_SEND_TEXT_LINE_MARK"),
            "{}",
            decoded
        );

        let _ = kill_session(&task_id);
    }

    #[test]
    fn cancel_agent_interrupts_without_killing_session() {
        if !tmux_available() {
            eprintln!("tmux not available, skipping");
            return;
        }
        let _tmux_guard = tmux_test_lock_blocking();

        let task_id = format!("test-cancel-preserve-{}", uuid::Uuid::new_v4());
        create_shell_session(&task_id);

        send_text_line(&task_id, "sleep 30").expect("start sleep");
        thread::sleep(Duration::from_millis(250));
        cancel_agent(&task_id);
        thread::sleep(Duration::from_millis(250));

        assert!(has_session(&task_id));
        let _ = kill_session(&task_id);
    }

    #[test]
    fn kill_session_removes_task_tmux_session() {
        if !tmux_available() {
            eprintln!("tmux not available, skipping");
            return;
        }
        let _tmux_guard = tmux_test_lock_blocking();

        let task_id = format!("test-kill-cleanup-{}", uuid::Uuid::new_v4());
        create_shell_session(&task_id);
        assert!(has_session(&task_id));

        kill_session(&task_id).expect("kill session");

        assert!(!has_session(&task_id));
    }

    #[test]
    fn test_transport_new() {
        let transport = TmuxTransport::new("test-task");
        assert!(!transport.is_alive());
        assert!(transport.pid().is_none());
        assert_eq!(transport.task_id, "test-task");
    }
}
