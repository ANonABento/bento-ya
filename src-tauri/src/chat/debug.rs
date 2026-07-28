//! In-memory recorder for CLI chat turns — a debugging aid that captures exactly
//! what we send to the CLI (command, args incl. system prompt, the stdin prompt)
//! and what comes back (raw stream-json lines). Bounded ring buffer; surfaced in
//! the Settings → Debug tab. Covers the pipe transport (chef + managed agents).

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

/// Keep the last N turns. A turn = one CLI spawn + its output.
const MAX_TURNS: usize = 20;
/// Cap output lines per turn so a chatty run can't grow unbounded.
const MAX_LINES_PER_TURN: usize = 1000;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugTurn {
    pub id: u64,
    /// Millis since the Unix epoch (stamped at spawn).
    pub started_at_ms: u64,
    pub command: String,
    pub args: Vec<String>,
    /// The prompt delivered on stdin (claude `-p`), if any.
    pub stdin: Option<String>,
    /// Raw stdout lines (the stream-json the CLI emits).
    pub output: Vec<String>,
    /// Set when output exceeded `MAX_LINES_PER_TURN`.
    pub output_truncated: bool,
}

static LOG: OnceLock<Mutex<VecDeque<DebugTurn>>> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn log() -> &'static Mutex<VecDeque<DebugTurn>> {
    LOG.get_or_init(|| Mutex::new(VecDeque::new()))
}

/// Record a spawn; returns the turn id to thread into `record_line`.
pub fn record_spawn(command: &str, args: &[String], stdin: Option<&str>) -> u64 {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let started_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let turn = DebugTurn {
        id,
        started_at_ms,
        command: command.to_string(),
        args: args.to_vec(),
        stdin: stdin.map(str::to_string),
        output: Vec::new(),
        output_truncated: false,
    };
    if let Ok(mut log) = log().lock() {
        log.push_back(turn);
        while log.len() > MAX_TURNS {
            log.pop_front();
        }
    }
    id
}

/// Append a raw stdout line to a turn.
pub fn record_line(turn_id: u64, line: &str) {
    let line = line.trim_end_matches(['\n', '\r']);
    if line.is_empty() {
        return;
    }
    if let Ok(mut log) = log().lock() {
        if let Some(turn) = log.iter_mut().find(|t| t.id == turn_id) {
            if turn.output.len() < MAX_LINES_PER_TURN {
                turn.output.push(line.to_string());
            } else {
                turn.output_truncated = true;
            }
        }
    }
}

/// Newest-first snapshot for the UI.
pub fn snapshot() -> Vec<DebugTurn> {
    log()
        .lock()
        .map(|log| log.iter().rev().cloned().collect())
        .unwrap_or_default()
}

pub fn clear() {
    if let Ok(mut log) = log().lock() {
        log.clear();
    }
}
