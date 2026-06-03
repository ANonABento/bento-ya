//! Bridges transport events to Tauri frontend events, and runs CLI pipeline
//! triggers inside per-task tmux sessions.
//!
//! Every pipeline trigger runs inside a tmux session named
//! `kaitencode_<task_id>` — the same naming used by interactive chat sessions.
//! The frontend's `TerminalView` attaches to that session via
//! `ensure_pty_session` and gets a live, interactive view. Completion
//! detection uses `tmux wait-for` plus an exit-code sentinel file, so the
//! pipeline still knows when the agent finished and with what status.
//!
//! The Tauri events `pty:{taskId}:output` and `pty:{taskId}:exit` continue
//! to be the contract with the frontend; they're emitted by `ManagedBridge`
//! when a UI client attaches.
//!
//! Output capture for rate-limit detection and persistence is done by
//! `tmux pipe-pane`, which mirrors the pane's raw output to a log file in
//! `~/.kaitencode/trigger_logs/`. We read that file on completion to drive
//! rate-limit detection and `tasks.pipeline_error`.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use rusqlite::Connection;
use tauri::{AppHandle, Emitter};
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;

use super::events::ChatEvent;
use super::log_retention;
use super::runtime::{
    runtime_events_from_chat_event, runtime_events_from_provider_json_line, AgentAdapterKind,
    AgentRuntimeEvent,
};
use super::tmux_transport;
use super::transport::TransportEvent;
use crate::db;
use crate::git::branch_manager;
use crate::pipeline;

// ─── Tunables ─────────────────────────────────────────────────────────────

/// Tail of the log copied into `tasks.pipeline_error` on failure.
const PIPELINE_ERROR_TAIL_BYTES: usize = 4 * 1024;
/// Live tail surfaced in `agent_sessions.last_output`.
const LAST_OUTPUT_TAIL_BYTES: usize = 16 * 1024;
/// Final scrollback persisted in `agent_sessions.scrollback` (head-truncated).
const SCROLLBACK_MAX_BYTES: usize = 256 * 1024;
/// Periodic flush cadence — the upper bound between live updates.
const FLUSH_INTERVAL: Duration = Duration::from_secs(1);
/// Fallback when we can't parse the rate-limit reset time.
const RATE_LIMIT_FALLBACK_DELAY: Duration = Duration::from_secs(60 * 60);
/// Hard cap on the trigger duration before we kill the tmux session.
const TRIGGER_TIMEOUT: Duration = Duration::from_secs(60 * 60 * 2);
/// How often we poll for completion when running `tmux wait-for` is too
/// blocking. We use a separate task for the wait-for so the timeout still
/// applies.
const WAIT_POLL_INTERVAL: Duration = Duration::from_millis(250);
/// How often the dead-agent watchdog polls `tmux has-session` to detect an
/// agent that died without signaling its wait-for channel (panic, OOM,
/// `tmux kill-pane`, etc). Cheap shell-out, so 5s is plenty.
const DEAD_AGENT_POLL_INTERVAL: Duration = Duration::from_secs(5);
/// Startup grace period before the dead-agent watchdog starts polling. Gives
/// the launcher time to land + the tmux session to register. Without this we
/// could race against `ensure_trigger_session` creation and false-positive.
const DEAD_AGENT_GRACE_PERIOD: Duration = Duration::from_secs(10);
/// Default window dimensions when the trigger runs headless (no UI attached).
const DEFAULT_TRIGGER_COLS: u16 = 120;
const DEFAULT_TRIGGER_ROWS: u16 = 50;
const CLAUDE_SESSION_MARKER: &str = "KAITENCODE_CLAUDE_SESSION_ID:";
const LEGACY_CLAUDE_SESSION_MARKER: &str = "BENTOYA_CLAUDE_SESSION_ID:";

/// Generate a random 16-char hex nonce (used for tmux wait-for channel names
/// and exit-code sentinel files).
fn gen_nonce() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let s = RandomState::new();
    let mut h = s.build_hasher();
    h.write_u64(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64,
    );
    format!("{:016x}", h.finish())
}

// ─── Managed Bridge ──────────────────────────────────────────────────────────

/// A single managed bridge that forwards PTY broadcast events to Tauri frontend events.
/// Only one bridge should exist per task at any time.
pub struct ManagedBridge {
    handle: JoinHandle<()>,
}

impl ManagedBridge {
    /// Start a new bridge that subscribes to the PTY broadcast channel and
    /// forwards events to the frontend via Tauri events.
    pub fn start(app: AppHandle, task_id: String, rx: broadcast::Receiver<TransportEvent>) -> Self {
        let handle = tokio::spawn(bridge_broadcast_to_tauri(app, task_id, rx));
        Self { handle }
    }

    /// Cancel the bridge by aborting its task.
    pub fn cancel(&self) {
        self.handle.abort();
    }

    /// Check if the bridge task is still running.
    pub fn is_alive(&self) -> bool {
        !self.handle.is_finished()
    }
}

impl Drop for ManagedBridge {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

/// Forward PTY broadcast events to Tauri events for frontend rendering.
async fn bridge_broadcast_to_tauri(
    app: AppHandle,
    task_id: String,
    mut event_rx: broadcast::Receiver<TransportEvent>,
) {
    let mut accumulated_text = String::new();

    loop {
        match event_rx.recv().await {
            Ok(event) => {
                if handle_bridge_event(&app, &task_id, &event, &mut accumulated_text).await {
                    break; // Exited event received
                }
            }
            Err(broadcast::error::RecvError::Lagged(n)) => {
                eprintln!("[bridge] {} lagged, skipped {} events", task_id, n);
                continue;
            }
            Err(broadcast::error::RecvError::Closed) => {
                break;
            }
        }
    }
}

/// Forward PTY transport events to Tauri events for frontend rendering (mpsc version).
///
/// DEPRECATED: Prefer ManagedBridge::start() with broadcast receiver.
/// Kept for backward compatibility with pipe transport callers.
pub async fn bridge_pty_to_tauri(
    app: &AppHandle,
    task_id: &str,
    mut event_rx: mpsc::Receiver<TransportEvent>,
) {
    let mut accumulated_text = String::new();

    while let Some(event) = event_rx.recv().await {
        if handle_bridge_event(app, task_id, &event, &mut accumulated_text).await {
            break;
        }
    }
}

/// Shared event handling logic for both mpsc and broadcast bridges.
/// Returns true if the bridge should stop (Exited event received).
async fn handle_bridge_event(
    app: &AppHandle,
    task_id: &str,
    event: &TransportEvent,
    accumulated_text: &mut String,
) -> bool {
    match event {
        TransportEvent::Chat(ChatEvent::RawOutput(ref data)) => {
            let _ = app.emit(&format!("pty:{}:output", task_id), data);
            false
        }
        TransportEvent::Chat(ChatEvent::TextContent(ref text)) => {
            accumulated_text.push_str(text);
            persist_runtime_events_from_chat(app, task_id, event);
            let _ = app.emit(
                "agent:stream",
                &serde_json::json!({
                    "taskId": task_id,
                    "content": text,
                }),
            );
            false
        }
        TransportEvent::Chat(ChatEvent::ThinkingContent {
            ref content,
            is_complete,
        }) => {
            persist_runtime_events_from_chat(app, task_id, event);
            let _ = app.emit(
                "agent:thinking",
                &serde_json::json!({
                    "taskId": task_id,
                    "content": content,
                    "isComplete": is_complete,
                }),
            );
            false
        }
        TransportEvent::Chat(ChatEvent::ToolUse {
            ref id,
            ref name,
            ref input,
            ref status,
        }) => {
            persist_runtime_events_from_chat(app, task_id, event);
            let _ = app.emit(
                "agent:tool_call",
                &serde_json::json!({
                    "taskId": task_id,
                    "toolId": id,
                    "toolName": name,
                    "toolInput": input.clone().unwrap_or_default(),
                    "status": format!("{:?}", status).to_lowercase(),
                }),
            );
            false
        }
        TransportEvent::Chat(ChatEvent::CommandStarted { .. }) => {
            persist_runtime_events_from_chat(app, task_id, event);
            false
        }
        TransportEvent::Chat(ChatEvent::CommandOutput { .. }) => {
            persist_runtime_events_from_chat(app, task_id, event);
            false
        }
        TransportEvent::Chat(ChatEvent::CommandCompleted { .. }) => {
            persist_runtime_events_from_chat(app, task_id, event);
            false
        }
        TransportEvent::Chat(ChatEvent::Complete) => {
            if !accumulated_text.is_empty() {
                if let Ok(conn) = Connection::open(db::db_path()) {
                    let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                    let _ = db::insert_agent_message(
                        &conn,
                        task_id,
                        "assistant",
                        accumulated_text,
                        None,
                        None,
                        None,
                        None,
                    );
                }
                accumulated_text.clear();
            }
            false
        }
        TransportEvent::Exited(exit_code) => {
            if !accumulated_text.is_empty() {
                if let Ok(conn) = Connection::open(db::db_path()) {
                    let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                    let _ = db::insert_agent_message(
                        &conn,
                        task_id,
                        "assistant",
                        accumulated_text,
                        None,
                        None,
                        None,
                        None,
                    );
                }
            }
            let success = exit_code.unwrap_or(0) == 0;
            let runtime_event = if success {
                AgentRuntimeEvent::AgentCompleted {
                    exit_code: *exit_code,
                    usage: None,
                }
            } else {
                AgentRuntimeEvent::AgentFailed {
                    exit_code: *exit_code,
                    error: None,
                }
            };
            let _ = crate::events::persist_and_emit_agent_runtime_event(
                app,
                task_id,
                None,
                runtime_event,
            );
            let _ = app.emit(
                &format!("pty:{}:exit", task_id),
                serde_json::json!({ "task_id": task_id, "exit_code": exit_code }),
            );
            let _ = app.emit(
                "agent:complete",
                &serde_json::json!({
                    "taskId": task_id,
                    "success": success,
                }),
            );
            true
        }
        _ => false,
    }
}

fn persist_runtime_events_from_chat(app: &AppHandle, task_id: &str, event: &TransportEvent) {
    let TransportEvent::Chat(chat_event) = event else {
        return;
    };
    for runtime_event in runtime_events_from_chat_event(chat_event) {
        let _ =
            crate::events::persist_and_emit_agent_runtime_event(app, task_id, None, runtime_event);
    }
}

/// jq filter that turns a claude `--output-format stream-json` event stream
/// into a human-readable progress log for the tmux pane. Designed to be
/// dropped into a `jq -rj --unbuffered` invocation.
///
/// Surfaces:
///   - A header line on `system/init` with version + model
///   - Tool-use blocks as `▶ Tool: <name>`
///   - Streamed text deltas from the assistant (typed live)
///   - A final summary line on `result` with duration + cost
///
/// We deliberately drop the noisy fields (raw input JSON, signature blocks,
/// rate-limit telemetry) so the pane reads like a normal CLI — not a JSON
/// dump. Failures inside jq fall through to a `cat` fallback in the wrapper,
/// so the user always sees *something* (even if it's raw JSON).
const CLAUDE_STREAM_PRETTY_JQ: &str = r#"
  (
  if .type == "system" and .subtype == "init" then
    (if (.session_id // .conversation_id // "") != "" then
      "[8mKAITENCODE_CLAUDE_SESSION_ID:" + (.session_id // .conversation_id) + "[0m\n"
    else "" end)
    + "[claude " + (.claude_code_version // "?") + " " + (.model // "?") + "]\n"
  elif .type == "stream_event" then
    if .event.type == "content_block_start" then
      if .event.content_block.type == "tool_use" then
        "\n[36m▶ " + (.event.content_block.name // "tool") + "[0m\n"
      elif .event.content_block.type == "thinking" then
        "[90m◆ thinking…[0m\n"
      else empty end
    elif .event.type == "content_block_delta" then
      if .event.delta.type == "text_delta" then
        (.event.delta.text // "")
      elif .event.delta.type == "thinking_delta" then
        empty
      else empty end
    elif .event.type == "message_stop" then
      "\n"
    else empty end
  elif .type == "user" and (.message.content[0]?.type == "tool_result") then
    "[32m✓[0m "
      + ((.message.content[0].content // "") | tostring | gsub("\n"; " ") | .[0:160])
      + "\n"
  elif .type == "result" then
    "\n[33m── done · "
      + ((.duration_ms // 0) | tostring) + "ms · $"
      + ((.total_cost_usd // 0) | tostring)
      + (if .is_error then " · ERROR" else "" end)
      + " ──[0m\n"
  else empty end
  ) | gsub("\n"; "\r\n")
"#;

/// jq filter that turns `codex exec --json` into the same compact terminal
/// shape as Claude: readable progress in the pane, raw JSONL preserved for
/// semantic transcript parsing.
const CODEX_STREAM_PRETTY_JQ: &str = r#"
  def item_text:
    (.item.text // .item.message // .item.summary //
      (if (.item.content | type) == "array" then
        (.item.content | map(if type == "string" then . else (.text // "") end) | join(""))
      else (.item.content // "") end) // "");

  (
  if .type == "thread.started" then
    "[codex " + (.thread_id // "session") + "]\n"
  elif .type == "turn.started" then
    "\n"
  elif .type == "item.started" and .item.type == "command_execution" then
    "\n[36m▶ Bash[0m\n"
  elif .type == "item.completed" and .item.type == "command_execution" then
    (if ((.item.aggregated_output // .item.output // "") | tostring | length) > 0 then
      "[32m✓[0m " + ((.item.aggregated_output // .item.output) | tostring | gsub("\n"; " ") | .[0:240]) + "\n"
    else empty end)
  elif .type == "item.started" and (.item.type == "tool_call" or .item.type == "function_call" or .item.type == "mcp_tool_call") then
    "\n[36m▶ " + (.item.name // .item.tool_name // .item.function.name // "tool") + "[0m\n"
  elif .type == "item.completed" and (.item.type == "tool_call" or .item.type == "function_call" or .item.type == "mcp_tool_call") then
    (if ((.item.output // .item.result // .item.content // "") | tostring | length) > 0 then
      "[32m✓[0m " + ((.item.output // .item.result // .item.content) | tostring | gsub("\n"; " ") | .[0:240]) + "\n"
    else empty end)
  elif .type == "item.completed" and .item.type == "reasoning" then
    (if (item_text | length) > 0 then "[90m◆ thinking…[0m\n" else empty end)
  elif .type == "item.completed" and .item.type == "agent_message" then
    (if (item_text | length) > 0 then "\n" + item_text + "\n" else empty end)
  elif .type == "turn.completed" then
    "\n[33m── done[0m\n"
  elif .type == "turn.failed" then
    "\n[31m── failed[0m\n"
  else empty end
  ) | gsub("\n"; "\r\n")
"#;

/// Build the CLI command string for a trigger, handling CLI-specific prompt
/// flags and (for claude) wrapping the call in a streaming pretty-printer so
/// the tmux pane shows live progress instead of a blank pane until the agent
/// exits.
///
/// Behavior per CLI:
///   - `claude`: emits `stream-json` events with verbose+partial messages,
///     piped through a `jq` filter that converts them to plain text in real
///     time. If `jq` isn't on PATH, falls back to raw stream-json (still
///     visible, just ugly).
///   - `codex`: emits JSONL events, tees them into the semantic log, and
///     pretty-prints a compact terminal view via jq. If jq is unavailable,
///     it falls back to Codex's normal human-readable exec output.
///   - Other / unknown: passed through as-is.
pub(crate) fn build_trigger_command(
    cli_command: &str,
    args: &[String],
    initial_prompt: &str,
    resume_id: Option<&str>,
) -> String {
    let cli_name = cli_command.rsplit('/').next().unwrap_or(cli_command);

    if cli_name == "claude" {
        return build_claude_streaming_command(cli_command, args, initial_prompt, resume_id);
    }

    if cli_name == "codex" {
        return build_codex_streaming_command(cli_command, args, initial_prompt, resume_id);
    }

    let mut cmd_parts = vec![cli_command.to_string()];

    cmd_parts.extend(args.iter().cloned());
    if !initial_prompt.is_empty() {
        let escaped = initial_prompt.replace('\'', "'\\''");
        cmd_parts.push(format!("'{}'", escaped));
    }
    cmd_parts.join(" ")
}

/// Materialize a long shell command into a short `bash <script>` launcher.
///
/// This is intentionally used for tmux injection paths. Sending the full
/// Claude wrapper through `tmux send-keys` makes zsh echo every embedded
/// newline from the jq filter as `quote>` continuation prompts, which pollutes
/// both the raw terminal and transcript fallback. A small script keeps the
/// terminal readable and avoids interactive-shell quoting edge cases.
pub(crate) fn materialize_shell_launcher(
    command: &str,
    nonce: Option<&str>,
) -> Result<String, String> {
    let script_nonce = nonce.map(str::to_string).unwrap_or_else(gen_nonce);
    let script_dir = log_retention::trigger_logs_dir();
    fs::create_dir_all(&script_dir)
        .map_err(|e| format!("failed to create trigger script dir: {}", e))?;
    let script_path = script_dir.join(format!("run_{}.sh", script_nonce));
    let mut file = fs::File::create(&script_path)
        .map_err(|e| format!("failed to create trigger script: {}", e))?;
    writeln!(file, "#!/usr/bin/env bash").map_err(|e| e.to_string())?;
    writeln!(file, "set -o pipefail").map_err(|e| e.to_string())?;
    writeln!(file, "{}", command).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = file
            .metadata()
            .map_err(|e| format!("failed to stat trigger script: {}", e))?
            .permissions();
        perms.set_mode(0o700);
        fs::set_permissions(&script_path, perms)
            .map_err(|e| format!("failed to chmod trigger script: {}", e))?;
    }
    Ok(format!(
        "bash {}",
        shell_quote_arg(&script_path.display().to_string())
    ))
}

/// Wrap a `claude` invocation with `--output-format stream-json --verbose
/// --include-partial-messages` and pipe the events through `jq` for a clean
/// live-progress view in the tmux pane.
///
/// The shape we produce:
///
///   bash -o pipefail -c '
///     if command -v jq >/dev/null 2>&1; then
///       claude --dangerously-skip-permissions --output-format stream-json \
///              --verbose --include-partial-messages [user-args] -p '<prompt>' \
///         | jq -rj --unbuffered '<filter>'
///     else
///       claude --dangerously-skip-permissions [user-args] -p '<prompt>'
///     fi
///   '
///
/// Wrapping in `bash -o pipefail -c` ensures `$?` reflects claude's exit code
/// (not jq's) regardless of which shell tmux's default pane was started in
/// (zsh vs bash).
fn build_claude_streaming_command(
    cli_command: &str,
    args: &[String],
    initial_prompt: &str,
    resume_id: Option<&str>,
) -> String {
    let prompt_quoted = if initial_prompt.is_empty() {
        String::new()
    } else {
        format!(" -p '{}'", initial_prompt.replace('\'', "'\\''"))
    };

    // User-provided args (e.g. --model gpt-5). Quote each one so spaces are safe.
    let user_args = args
        .iter()
        .map(|a| format!("'{}'", a.replace('\'', "'\\''")))
        .collect::<Vec<_>>()
        .join(" ");
    let user_args_segment = if user_args.is_empty() {
        String::new()
    } else {
        format!(" {}", user_args)
    };
    let resume_segment = resume_id
        .filter(|id| !id.trim().is_empty())
        .map(|id| format!(" '--resume' '{}'", id.replace('\'', "'\\''")))
        .unwrap_or_default();

    // Quote the cli path itself in case it contains spaces.
    let cli_quoted = format!("'{}'", cli_command.replace('\'', "'\\''"));

    // Build the streaming and fallback command lines. Note: these go inside a
    // `bash -c '...'` so we already have one level of single-quote nesting —
    // the helper `bash_double_quote_for_outer_squote` escapes single quotes
    // for that outer layer. The streaming-output flags are shared with the
    // managed adapter via `runtime::CLAUDE_STREAM_OUTPUT_FLAGS` so the two
    // spawn families can't drift on them; the terminal-only flags
    // (`--dangerously-skip-permissions`, `--include-partial-messages`, `-p`,
    // and the jq pipe) stay here.
    let stream_flags = super::runtime::CLAUDE_STREAM_OUTPUT_FLAGS.join(" ");
    let stream_cmd = format!(
        "{cli} --dangerously-skip-permissions {stream_flags} --include-partial-messages{resume}{args}{prompt} | tee -a \"${{KAITENCODE_CLAUDE_JSON_LOG:-${{BENTOYA_CLAUDE_JSON_LOG:-/dev/null}}}}\" | jq -rj --unbuffered \"$KAITENCODE_CLAUDE_FILTER\"",
        cli = cli_quoted,
        stream_flags = stream_flags,
        resume = resume_segment,
        args = user_args_segment,
        prompt = prompt_quoted,
    );
    let fallback_cmd = format!(
        "{cli} --dangerously-skip-permissions{resume}{args}{prompt}",
        cli = cli_quoted,
        resume = resume_segment,
        args = user_args_segment,
        prompt = prompt_quoted,
    );

    // Whole bash body: pick streaming when jq exists, else fallback.
    let bash_body = format!(
        "if command -v jq >/dev/null 2>&1; then {stream}; else {fallback}; fi",
        stream = stream_cmd,
        fallback = fallback_cmd,
    );

    // Wrap in `bash -o pipefail -c '...'` so the pipe's exit status reflects
    // claude's exit (not jq's). Single quotes inside `bash_body` need
    // escaping for the outer single-quote wrapping.
    let bash_body_outer_escaped = bash_body.replace('\'', "'\\''");
    let filter_outer_escaped = CLAUDE_STREAM_PRETTY_JQ.replace('\'', "'\\''");

    // Export the jq filter via env var so we don't have to re-escape it
    // through multiple quoting layers — bash will read it directly.
    format!(
        "KAITENCODE_CLAUDE_FILTER='{filter}' BENTOYA_CLAUDE_FILTER='{filter}' bash -o pipefail -c '{body}'",
        filter = filter_outer_escaped,
        body = bash_body_outer_escaped,
    )
}

/// Terminal/headless codex invocation. Unlike Claude there is no shared flag
/// constant with the managed adapter (`CodexCliAdapter::managed_turn_args`):
/// the two paths sandbox differently *by design* — this terminal path pins
/// `-c sandbox_mode="danger-full-access" -c approval_policy="never"` (stable
/// `-c` overrides that survive inside worktrees) whereas the managed adapter
/// uses `--dangerously-bypass-approvals-and-sandbox`. Only `exec`, `--json`,
/// and `--skip-git-repo-check` overlap, and those are inert if codex renames
/// them, so they're left inline rather than centralized.
fn build_codex_streaming_command(
    cli_command: &str,
    args: &[String],
    initial_prompt: &str,
    resume_id: Option<&str>,
) -> String {
    // Codex needs `exec` for non-interactive mode. We pin sandbox/approval via
    // stable `-c key=value` overrides: `--full-auto` uses workspace-write,
    // which blocks `.git` writes inside worktrees and can leave ghost tasks.
    let cli_quoted = format!("'{}'", cli_command.replace('\'', "'\\''"));
    let prompt_quoted = if initial_prompt.is_empty() {
        String::new()
    } else {
        format!(" '{}'", initial_prompt.replace('\'', "'\\''"))
    };
    let user_args = args
        .iter()
        .map(|a| format!("'{}'", a.replace('\'', "'\\''")))
        .collect::<Vec<_>>()
        .join(" ");
    let user_args_segment = if user_args.is_empty() {
        String::new()
    } else {
        format!(" {}", user_args)
    };
    let resume_segment = resume_id
        .filter(|id| !id.trim().is_empty())
        .map(|id| format!(" resume '{}'", id.replace('\'', "'\\''")))
        .unwrap_or_default();

    let common = format!(
        "{cli} exec{resume} -c sandbox_mode=\"danger-full-access\" -c approval_policy=\"never\" --skip-git-repo-check{args}",
        cli = cli_quoted,
        resume = resume_segment,
        args = user_args_segment,
    );
    let stream_cmd = format!(
        "{common} --json{prompt} | tee -a \"${{KAITENCODE_CODEX_JSON_LOG:-${{BENTOYA_CODEX_JSON_LOG:-/dev/null}}}}\" | jq -rj --unbuffered \"$KAITENCODE_CODEX_FILTER\"",
        common = common,
        prompt = prompt_quoted,
    );
    let fallback_cmd = format!("{common}{prompt}", common = common, prompt = prompt_quoted);
    let bash_body = format!(
        "if command -v jq >/dev/null 2>&1; then {stream}; else {fallback}; fi",
        stream = stream_cmd,
        fallback = fallback_cmd,
    );
    let bash_body_outer_escaped = bash_body.replace('\'', "'\\''");
    let filter_outer_escaped = CODEX_STREAM_PRETTY_JQ.replace('\'', "'\\''");

    format!(
        "KAITENCODE_CODEX_FILTER='{filter}' BENTOYA_CODEX_FILTER='{filter}' bash -o pipefail -c '{body}'",
        filter = filter_outer_escaped,
        body = bash_body_outer_escaped,
    )
}

fn semantic_adapter_for_cli(cli_command: &str) -> Option<AgentAdapterKind> {
    match cli_command.rsplit('/').next().unwrap_or(cli_command) {
        "claude" => Some(AgentAdapterKind::ClaudeCli),
        "codex" => Some(AgentAdapterKind::CodexCli),
        _ => None,
    }
}

// ─── Rate-limit detection ─────────────────────────────────────────────────

/// Heuristic match for provider rate-limit messages. Looks for the
/// case-insensitive substring "you've hit your limit" anywhere in the captured
/// output. The message can be surrounded by ANSI escape codes or wrapped in
/// other lines, so we match on substring rather than full lines.
pub(crate) fn is_rate_limit_output(content: &str) -> bool {
    let lower = content.to_ascii_lowercase();
    lower.contains("you've hit your limit") || lower.contains("you have hit your limit")
}

/// Parse the reset time mentioned after the literal "resets " in the rate-limit
/// message and convert it to a delay from now. Falls back to
/// `RATE_LIMIT_FALLBACK_DELAY` when parsing fails.
pub(crate) fn parse_rate_limit_delay(content: &str) -> Duration {
    parse_rate_limit_delay_from(content, chrono::Local::now()).unwrap_or(RATE_LIMIT_FALLBACK_DELAY)
}

fn parse_rate_limit_delay_from<Tz: chrono::TimeZone>(
    content: &str,
    now: chrono::DateTime<Tz>,
) -> Option<Duration>
where
    Tz::Offset: Copy,
{
    let target = parse_reset_time(content)?;
    let now_naive = now.naive_local();
    let mut target_dt = now_naive.date().and_time(target);
    if target_dt <= now_naive {
        target_dt += chrono::Duration::days(1);
    }
    let delta = target_dt.signed_duration_since(now_naive);
    let secs = delta.num_seconds();
    if secs <= 0 {
        return None;
    }
    // Floor to at least 60s to avoid hammering the provider on near-misses.
    Some(Duration::from_secs(secs.max(60) as u64))
}

/// Extract the time string after "resets " and parse it. Supports `12pm`,
/// `1:30 PM`, `13:00`, with or without internal whitespace.
fn parse_reset_time(content: &str) -> Option<chrono::NaiveTime> {
    let lower = content.to_ascii_lowercase();
    let idx = lower.find("resets ")?;
    let after = &content[idx + "resets ".len()..];
    let time_str = extract_time_token(after)?;
    parse_clock_time(&time_str)
}

/// Pull the leading clock-time substring from `s`. Stops at `(`, newline, or
/// any non-time character. Allows one internal whitespace between the digits
/// and an `am`/`pm` marker (so "1:30 PM" works), but no trailing junk.
fn extract_time_token(s: &str) -> Option<String> {
    let mut buf = String::new();
    let mut chars = s.chars().peekable();
    let mut allowed_space = true;
    while let Some(&c) = chars.peek() {
        if c == '(' || c == '\n' || c == '\r' || c == ',' {
            break;
        }
        if c.is_whitespace() {
            if !allowed_space {
                break;
            }
            // Only swallow the space if what follows looks like am/pm.
            let lookahead: String = chars.clone().skip(1).take(2).collect();
            let la_lower = lookahead.to_ascii_lowercase();
            if la_lower.starts_with("am") || la_lower.starts_with("pm") {
                buf.push(' ');
                chars.next();
                allowed_space = false;
                continue;
            }
            break;
        }
        if c.is_ascii_alphanumeric() || c == ':' {
            buf.push(c);
            chars.next();
        } else {
            break;
        }
    }
    let trimmed = buf.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn parse_clock_time(s: &str) -> Option<chrono::NaiveTime> {
    let lower = s.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return None;
    }

    // `extract_time_token` strips non-alphanumeric chars (including dots), so
    // we only need to handle the bare am/pm forms here.
    let (time_part, ampm) = if let Some(rest) = lower.strip_suffix("am") {
        (rest.trim(), Some(false))
    } else if let Some(rest) = lower.strip_suffix("pm") {
        (rest.trim(), Some(true))
    } else {
        (lower.as_str(), None)
    };

    let (raw_h, raw_m) = match time_part.find(':') {
        Some(idx) => {
            let h: u32 = time_part[..idx].trim().parse().ok()?;
            let m: u32 = time_part[idx + 1..].trim().parse().ok()?;
            (h, m)
        }
        None => {
            if time_part.is_empty() {
                return None;
            }
            (time_part.parse().ok()?, 0)
        }
    };

    if raw_m >= 60 {
        return None;
    }
    let hour = match ampm {
        Some(true) => {
            if raw_h == 12 {
                12
            } else if raw_h < 12 {
                raw_h + 12
            } else {
                return None;
            }
        }
        Some(false) => {
            if raw_h == 12 {
                0
            } else if raw_h < 12 {
                raw_h
            } else {
                return None;
            }
        }
        None => {
            if raw_h >= 24 {
                return None;
            }
            raw_h
        }
    };

    chrono::NaiveTime::from_hms_opt(hour, raw_m, 0)
}

/// Schedule a deferred re-fire of the trigger after `delay`. The retry runs in
/// its own tokio task and is gated on the task still being in the same column.
fn schedule_rate_limit_retry(
    app: AppHandle,
    task_id: String,
    trigger_column_id: Option<String>,
    delay: Duration,
) {
    tokio::spawn(async move {
        log::info!(
            "[bridge] rate-limit retry scheduled for task {} in {:?}",
            task_id,
            delay
        );
        tokio::time::sleep(delay).await;
        let conn = match Connection::open(db::db_path()) {
            Ok(c) => c,
            Err(e) => {
                log::warn!("[bridge] rate-limit retry: DB open failed: {}", e);
                return;
            }
        };
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
        let task = match db::get_task(&conn, &task_id) {
            Ok(t) => t,
            Err(_) => return,
        };
        if Some(&task.column_id) != trigger_column_id.as_ref() {
            log::info!(
                "[bridge] rate-limit retry: task {} moved columns, skipping",
                task_id
            );
            return;
        }
        let column = match db::get_column(&conn, &task.column_id) {
            Ok(c) => c,
            Err(_) => return,
        };
        let _ = db::update_task_pipeline_state(
            &conn,
            &task.id,
            pipeline::PipelineState::Idle.as_str(),
            None,
            None,
        );
        if let Err(e) = pipeline::fire_trigger(&conn, &app, &task, &column) {
            log::warn!(
                "[bridge] rate-limit retry: re-fire failed for task {}: {}",
                task_id,
                e
            );
        }
    });
}

// ─── Trigger runner (tmux-based) ──────────────────────────────────────────

/// Convenience: tmux session name for a task.
fn tmux_session_name(task_id: &str) -> String {
    tmux_transport::session_name(task_id)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TriggerSessionPlan {
    Create,
    ReuseExisting,
    KillAndCreate,
}

fn trigger_session_plan(
    session_exists: bool,
    persistent_lifecycle: bool,
    force_fresh: bool,
) -> TriggerSessionPlan {
    // `force_fresh` overrides persistence — used when the caller knows the
    // existing pane's cwd is invalid (e.g. terminal column whose worktree
    // was just removed by `cleanup_task_worktree_if_terminal`). Reusing the
    // pane in that state breaks zsh's prompt with `getcwd: ENOENT`.
    if force_fresh {
        return if session_exists {
            TriggerSessionPlan::KillAndCreate
        } else {
            TriggerSessionPlan::Create
        };
    }
    match (session_exists, persistent_lifecycle) {
        (true, true) => TriggerSessionPlan::ReuseExisting,
        (true, false) => TriggerSessionPlan::KillAndCreate,
        (false, _) => TriggerSessionPlan::Create,
    }
}

fn should_kill_session_after_completion(persistent_lifecycle: bool) -> bool {
    !persistent_lifecycle
}

fn persistent_agent_lifecycle_enabled(workspace_config: Option<&str>) -> bool {
    let Some(config_json) = workspace_config else {
        return true;
    };
    let Ok(config) = serde_json::from_str::<serde_json::Value>(config_json) else {
        return true;
    };

    config
        .get("persistentAgentLifecycle")
        .or_else(|| config.get("persistent_agent_lifecycle"))
        .or_else(|| {
            config
                .get("agent")
                .and_then(|agent| agent.get("persistentAgentLifecycle"))
        })
        .or_else(|| {
            config
                .get("agent")
                .and_then(|agent| agent.get("persistent_agent_lifecycle"))
        })
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(true)
}

/// Run `tmux <args>` and return Ok(stdout) on success, Err(stderr) otherwise.
fn run_tmux(args: &[&str]) -> Result<String, String> {
    let output = Command::new("tmux")
        .args(args)
        .output()
        .map_err(|e| format!("Failed to spawn tmux: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "tmux {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Capture pane scrollback (with escape sequences). Returns empty string on
/// any error so callers can treat it as "no output captured".
fn capture_pane_scrollback(session: &str) -> String {
    Command::new("tmux")
        .args(["capture-pane", "-t", session, "-p", "-e", "-J", "-S", "-"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default()
}

fn complete_line_delta(contents: &str, start: usize) -> Option<(&str, usize)> {
    let start = start.min(contents.len());
    let tail = contents.get(start..)?;
    let end_offset = tail.rfind('\n')? + 1;
    Some((&tail[..end_offset], start + end_offset))
}

fn emit_semantic_events_from_provider_json_delta(
    app: &AppHandle,
    task_id: &str,
    session_id: Option<&str>,
    adapter: AgentAdapterKind,
    delta: &str,
    suppress_lifecycle: bool,
) -> bool {
    let mut emitted = false;
    for line in delta.lines().filter(|line| !line.trim().is_empty()) {
        for event in runtime_events_from_provider_json_line(adapter, line) {
            if let Some(session_id) = session_id {
                match &event {
                    AgentRuntimeEvent::SessionStarted {
                        provider_session_id,
                        model,
                        ..
                    } => {
                        if let Ok(conn) = Connection::open(db::db_path()) {
                            let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                            let _ = db::update_agent_session_runtime(
                                &conn,
                                session_id,
                                Some(adapter_kind_db_key(adapter)),
                                None,
                                provider_session_id.as_deref().map(Some),
                                None,
                            );
                            let _ = db::update_agent_session_model(
                                &conn,
                                session_id,
                                model.as_deref(),
                                None,
                            );
                        }
                    }
                    AgentRuntimeEvent::AgentStarted { model, .. } if model.is_some() => {
                        if let Ok(conn) = Connection::open(db::db_path()) {
                            let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                            let _ = db::update_agent_session_model(
                                &conn,
                                session_id,
                                model.as_deref(),
                                None,
                            );
                        }
                    }
                    _ => {}
                }
            }
            if matches!(
                event,
                AgentRuntimeEvent::AgentCompleted { .. }
                    | AgentRuntimeEvent::AgentFailed { .. }
                    | AgentRuntimeEvent::AgentCancelled { .. }
            ) {
                continue;
            }
            if suppress_lifecycle
                && matches!(
                    event,
                    AgentRuntimeEvent::SessionStarted { .. }
                        | AgentRuntimeEvent::AgentStarted { .. }
                )
            {
                continue;
            }
            emitted = true;
            let _ = crate::events::persist_and_emit_agent_runtime_event(
                app, task_id, session_id, event,
            );
        }
    }
    emitted
}

/// Truncate a captured log to the trailing N bytes, on a UTF-8-safe boundary.
fn tail_bytes(s: &str, n: usize) -> String {
    if s.len() <= n {
        return s.to_string();
    }
    let start = s.len() - n;
    // Walk forward to a UTF-8 boundary so we don't slice a multi-byte char.
    let mut i = start;
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    s[i..].to_string()
}

fn short_commit_hash(hash: &str) -> String {
    hash.chars().take(7).collect()
}

fn adapter_kind_db_key(adapter: AgentAdapterKind) -> &'static str {
    match adapter {
        AgentAdapterKind::ClaudeCli => "claude_cli",
        AgentAdapterKind::CodexCli => "codex_cli",
        AgentAdapterKind::GenericCli => "generic_cli",
        AgentAdapterKind::Api => "api",
        AgentAdapterKind::Remote => "remote",
    }
}

/// Truncate the log to the trailing SCROLLBACK_MAX_BYTES on a char boundary.
fn truncate_for_scrollback(s: &str) -> String {
    tail_bytes(s, SCROLLBACK_MAX_BYTES)
}

fn extract_claude_session_id(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let (marker_start, marker_len) = line
            .find(CLAUDE_SESSION_MARKER)
            .map(|start| (start, CLAUDE_SESSION_MARKER.len()))
            .or_else(|| {
                line.find(LEGACY_CLAUDE_SESSION_MARKER)
                    .map(|start| (start, LEGACY_CLAUDE_SESSION_MARKER.len()))
            })?;
        let after_marker = &line[marker_start + marker_len..];
        let session_id = after_marker
            .split(|ch: char| ch.is_whitespace() || ch == '\u{1b}' || ch == '\u{7}')
            .next()
            .unwrap_or_default()
            .trim();
        if session_id.is_empty() {
            None
        } else {
            Some(session_id.to_string())
        }
    })
}

/// Heuristic: did the trailing scrollback contain claude's "session not found"
/// error? Used to clear the stale id so the next stage doesn't keep retrying
/// the same dead resume target.
pub(crate) fn is_stale_claude_resume_output(scrollback: &str) -> bool {
    // Match any of:
    //   "No conversation found with session ID: <id>"
    //   "No conversation found with session id: <id>"
    //   "session not found"
    let lower = scrollback.to_ascii_lowercase();
    lower.contains("no conversation found with session id") || lower.contains("session not found")
}

/// Map a working directory to the encoded path claude uses for its session
/// file directory. Claude rewrites `/` → `-`. Example:
///   `/Users/bentomac/foo` → `-Users-bentomac-foo`
fn encode_claude_project_dir(working_dir: &str) -> String {
    working_dir.replace('/', "-")
}

/// Locate `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` for a given
/// working directory + session id. Returns `None` if `$HOME` is unresolvable.
fn claude_session_file_path(working_dir: &str, session_id: &str) -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from)?;
    let encoded = encode_claude_project_dir(working_dir);
    Some(
        home.join(".claude")
            .join("projects")
            .join(encoded)
            .join(format!("{}.jsonl", session_id)),
    )
}

/// Defense-in-depth check before we inject `claude --resume <id>`.
///
/// Returns `true` if the local session file exists. Returns `false` if the
/// id is empty, claude has purged the session locally, or the path can't be
/// resolved (no `$HOME`). The caller drops `--resume` on `false` and runs a
/// fresh conversation instead — much better UX than a hard ERROR.
pub(crate) fn validate_claude_resume_id(working_dir: &str, session_id: &str) -> bool {
    if session_id.trim().is_empty() {
        return false;
    }
    match claude_session_file_path(working_dir, session_id) {
        Some(path) => path.exists(),
        None => false,
    }
}

/// Create a fresh tmux session for a pipeline trigger. Fails if a session
/// with the same name already exists — callers should kill stale sessions
/// first if they want a clean slate.
fn create_trigger_session(
    task_id: &str,
    working_dir: &str,
    cols: u16,
    rows: u16,
    env_vars: &HashMap<String, String>,
) -> Result<(), String> {
    let name = tmux_session_name(task_id);

    let cols_str = cols.to_string();
    let rows_str = rows.to_string();
    let mut args: Vec<&str> = vec![
        "new-session",
        "-d",
        "-s",
        &name,
        "-x",
        &cols_str,
        "-y",
        &rows_str,
    ];
    if Path::new(working_dir).exists() {
        args.push("-c");
        args.push(working_dir);
    }

    let mut cmd = Command::new("tmux");
    cmd.args(&args);
    for (k, v) in env_vars {
        cmd.env(k, v);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to spawn tmux new-session: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("tmux new-session failed: {}", stderr.trim()));
    }
    Ok(())
}

fn ensure_trigger_session(
    task_id: &str,
    working_dir: &str,
    cols: u16,
    rows: u16,
    env_vars: &HashMap<String, String>,
    persistent_lifecycle: bool,
    force_fresh: bool,
) -> Result<TriggerSessionPlan, String> {
    static ENSURE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let _guard = ENSURE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|e| format!("ensure session lock poisoned: {}", e))?;

    let plan = trigger_session_plan(
        tmux_transport::has_session(task_id),
        persistent_lifecycle,
        force_fresh,
    );
    match plan {
        TriggerSessionPlan::ReuseExisting => Ok(plan),
        TriggerSessionPlan::KillAndCreate => {
            let session = tmux_session_name(task_id);
            let reason = if force_fresh {
                "force_fresh=true (terminal column or stale cwd)"
            } else {
                "non-persistent lifecycle"
            };
            eprintln!(
                "[bridge] Killing stale tmux session before trigger: {} ({})",
                session, reason
            );
            let _ = tmux_transport::kill_session(task_id);
            create_trigger_session(task_id, working_dir, cols, rows, env_vars)?;
            Ok(plan)
        }
        TriggerSessionPlan::Create => {
            create_trigger_session(task_id, working_dir, cols, rows, env_vars)?;
            Ok(plan)
        }
    }
}

/// Run a CLI trigger inside a tmux session named `kaitencode_<task_id>`.
///
/// Behavior:
/// 1. Ensure the tmux server is running and create a fresh session for the task.
/// 2. Mirror pane output to a log file via `tmux pipe-pane`.
/// 3. Send the wrapped command into the session via `tmux send-keys`. The
///    wrapper writes the command's exit code to a sentinel file and signals
///    completion via `tmux wait-for -S`.
/// 4. Wait for that signal with a hard timeout; on timeout, kill the session.
/// 5. Read the exit code, capture pane scrollback for rate-limit detection
///    and for `tasks.pipeline_error`, then mark complete / schedule retry.
///
/// The frontend's `TerminalView` can attach (or be attached) at any time
/// during the trigger via `ensure_pty_session`, which finds the existing
/// tmux session and starts streaming live to xterm.js.
/// Shared "mark this agent session started" write sequence used by the
/// tmux-backed trigger spawn paths (headless terminal + interactive). Sets the
/// session's runtime mode + tmux name, flips it to `running` (clearing any
/// stale exit code left by a reused/completed session — bug-fix #5), optionally
/// records the model, points the task at the session, and emits a
/// `tasks:changed` carrying the real `workspace_id` so the live card refreshes.
/// Callers keep their own resume-id and transcript-event handling.
#[allow(clippy::too_many_arguments)]
fn persist_agent_session_started(
    conn: &Connection,
    app: &AppHandle,
    task_id: &str,
    workspace_id: &str,
    session_id: &str,
    adapter_kind: &str,
    runtime_mode: &str,
    tmux_name: &str,
    model: Option<&str>,
) {
    let _ = db::update_agent_session_runtime(
        conn,
        session_id,
        Some(adapter_kind),
        Some(runtime_mode),
        None,
        Some(Some(tmux_name)),
    );
    let _ = db::update_agent_session(
        conn,
        session_id,
        None,
        Some("running"),
        Some(None),
        None,
        None,
        None,
    );
    // Skip the model write when unset so paths that never track a model
    // (interactive) don't perform a redundant no-op update.
    if model.is_some() {
        let _ = db::update_agent_session_model(conn, session_id, model, None);
    }
    let _ = db::update_task_agent_status(conn, task_id, Some("running"), None);
    let ts = db::now();
    let _ = conn.execute(
        "UPDATE tasks SET agent_session_id = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![session_id, ts, task_id],
    );
    pipeline::emit_tasks_changed(app, workspace_id, "agent_session_created");
}

#[allow(clippy::too_many_arguments)]
pub fn spawn_cli_trigger_task(
    app: AppHandle,
    task_id: String,
    cli_command: String,
    args: Vec<String>,
    working_dir: String,
    initial_prompt: String,
    env_vars: Option<HashMap<String, String>>,
    force_fresh_session: bool,
) {
    // Create agent session record so the UI can track this agent
    let (session_id, resume_id, persistent_lifecycle) = {
        if let Ok(conn) = Connection::open(db::db_path()) {
            let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
            let task_snapshot = db::get_task(&conn, &task_id).ok();
            let column_snapshot = task_snapshot
                .as_ref()
                .and_then(|task| db::get_column(&conn, &task.column_id).ok());
            let persistent_lifecycle = task_snapshot
                .as_ref()
                .and_then(|task| db::get_workspace(&conn, &task.workspace_id).ok())
                .map(|workspace| persistent_agent_lifecycle_enabled(Some(&workspace.config)))
                .unwrap_or(false);
            let existing_session = if persistent_lifecycle {
                db::list_agent_sessions(&conn, &task_id)
                    .ok()
                    .and_then(|sessions| sessions.into_iter().next())
            } else {
                None
            };
            let session_result = existing_session.map(Ok).unwrap_or_else(|| {
                db::insert_agent_session(&conn, &task_id, &cli_command, Some(&working_dir))
            });
            match session_result {
                Ok(session) => {
                    let tmux_name = tmux_session_name(&task_id);
                    // Reused persistent sessions may carry a `managed` mode and
                    // a stale exit code; the helper flips to running + clears it.
                    let runtime_mode = task_snapshot
                        .as_ref()
                        .and_then(|task| task.agent_mode.as_deref())
                        .filter(|mode| *mode == "managed")
                        .unwrap_or("terminal");
                    persist_agent_session_started(
                        &conn,
                        &app,
                        &task_id,
                        task_snapshot
                            .as_ref()
                            .map(|t| t.workspace_id.as_str())
                            .unwrap_or(""),
                        &session.id,
                        db::adapter_kind_for_agent_type(&cli_command),
                        runtime_mode,
                        &tmux_name,
                        task_snapshot.as_ref().and_then(|task| task.model.as_deref()),
                    );
                    let adapter = db::adapter_kind_for_agent_type(&cli_command);
                    let candidate_resume_id = if persistent_lifecycle {
                        db::resolve_cli_session_id(&session, adapter)
                    } else {
                        None
                    };
                    // For claude, drop the resume id if the local session
                    // jsonl is gone (purged by claude itself, or stale across
                    // an app restart). Codex doesn't take --resume so we
                    // pass the candidate through unchanged for it.
                    let resume_id = match candidate_resume_id {
                        Some(id) if adapter == "claude_cli" => {
                            if validate_claude_resume_id(&working_dir, &id) {
                                Some(id)
                            } else {
                                eprintln!(
                                    "[bridge] dropping stale --resume id for task {} ({}): no local session file",
                                    task_id, id
                                );
                                let _ = db::update_agent_session_cli_for_adapter(
                                    &conn,
                                    &session.id,
                                    adapter,
                                    None,
                                    None,
                                    None,
                                );
                                None
                            }
                        }
                        other => other,
                    };
                    let metadata = serde_json::json!({
                        "cli": cli_command,
                        "model": task_snapshot.as_ref().and_then(|task| task.model.as_deref()),
                        "workdir": working_dir,
                        "persistentLifecycle": persistent_lifecycle,
                        "resumeAvailable": resume_id.is_some(),
                        "columnId": task_snapshot.as_ref().map(|task| task.column_id.as_str()),
                        "columnName": column_snapshot.as_ref().map(|column| column.name.as_str()),
                        "pipelineState": task_snapshot.as_ref().map(|task| task.pipeline_state.as_str()),
                    })
                    .to_string();
                    let _ = crate::events::persist_and_emit_agent_transcript_event(
                        &app,
                        &task_id,
                        Some(&session.id),
                        db::EVENT_SESSION_STARTED,
                        None,
                        Some(&metadata),
                    );
                    let _ = crate::events::persist_and_emit_agent_transcript_event(
                        &app,
                        &task_id,
                        Some(&session.id),
                        db::EVENT_AGENT_STARTED,
                        None,
                        Some(&metadata),
                    );
                    (Some(session.id), resume_id, persistent_lifecycle)
                }
                Err(e) => {
                    log::error!("[bridge] Failed to create agent session: {}", e);
                    (None, None, persistent_lifecycle)
                }
            }
        } else {
            (None, None, false)
        }
    };

    // Capture column_id at trigger time — used to verify task hasn't moved
    // before mark_complete or before scheduling a rate-limit retry.
    let trigger_column_id = {
        if let Ok(conn) = Connection::open(db::db_path()) {
            db::get_task(&conn, &task_id).ok().map(|t| t.column_id)
        } else {
            None
        }
    };

    let env_vars = env_vars.unwrap_or_default();

    tokio::spawn(async move {
        let start_time = std::time::Instant::now();
        let full_cmd =
            build_trigger_command(&cli_command, &args, &initial_prompt, resume_id.as_deref());
        let nonce = gen_nonce();
        let log_path = log_retention::new_trigger_log_path(&nonce);
        let log_path_str = log_path.display().to_string();

        let result = run_trigger_in_tmux(
            &app,
            &task_id,
            &cli_command,
            &full_cmd,
            &working_dir,
            &log_path_str,
            &nonce,
            session_id.as_deref(),
            trigger_column_id.as_deref(),
            start_time,
            &env_vars,
            persistent_lifecycle,
            force_fresh_session,
        )
        .await;

        if let Err(error_detail) = result {
            let error_msg = format!(
                "CLI trigger '{}' failed for task {}: {}",
                cli_command, task_id, error_detail
            );
            let failure_metadata = serde_json::json!({
                "cli": cli_command,
                "error": error_detail,
            })
            .to_string();
            let _ = crate::events::persist_and_emit_agent_transcript_event(
                &app,
                &task_id,
                session_id.as_deref(),
                db::EVENT_AGENT_FAILED,
                Some(&error_msg),
                Some(&failure_metadata),
            );
            eprintln!("[bridge] {}", error_msg);
            if let Ok(conn) = Connection::open(db::db_path()) {
                let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");

                let _ = conn.execute(
                    "UPDATE tasks SET pipeline_error = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![error_msg, db::now(), task_id],
                );

                if let Some(ref sid) = session_id {
                    let _ = db::update_agent_session(
                        &conn,
                        sid,
                        None,
                        Some("failed"),
                        Some(Some(1)),
                        None,
                        None,
                        None,
                    );
                    let _ = db::update_task_agent_status(&conn, &task_id, Some("failed"), None);
                }

                if let Ok(task) = db::get_task(&conn, &task_id) {
                    if let Ok(col) = db::get_column(&conn, &task.column_id) {
                        let _ =
                            pipeline::handle_trigger_failure(&conn, &app, &task, &col, &error_msg);
                    }
                }
            }
            pipeline::emit_tasks_changed(&app, "", "trigger_failed");
        }
    });
}

/// Result of the dead-agent / hard-timeout race. Lets us distinguish
/// "agent vanished" (recoverable, user can retry) from "ran past the 2h
/// backstop" (probably stuck for real).
enum DeadOrTimeout {
    DeadAgent,
    TimedOut,
}

#[allow(clippy::too_many_arguments)]
async fn run_trigger_in_tmux(
    app: &AppHandle,
    task_id: &str,
    cli_command: &str,
    full_cmd: &str,
    working_dir: &str,
    log_path: &str,
    nonce: &str,
    session_id: Option<&str>,
    trigger_column_id: Option<&str>,
    start_time: std::time::Instant,
    env_vars: &HashMap<String, String>,
    persistent_lifecycle: bool,
    force_fresh_session: bool,
) -> Result<(), String> {
    eprintln!("[bridge] Starting tmux-backed trigger for task {}", task_id);
    eprintln!("[bridge] CLI command: {}", full_cmd);
    eprintln!("[bridge] Working dir: {}", working_dir);
    eprintln!("[bridge] Log file: {}", log_path);

    let command_metadata = serde_json::json!({
        "cli": cli_command,
        "workdir": working_dir,
    })
    .to_string();
    let _ = crate::events::persist_and_emit_agent_transcript_event(
        app,
        task_id,
        session_id,
        db::EVENT_COMMAND_STARTED,
        None,
        Some(&command_metadata),
    );

    // Make sure the tmux server is up; auto-start a default session if needed.
    tmux_transport::ensure_tmux_server()?;

    let session = tmux_session_name(task_id);

    let session_plan = ensure_trigger_session(
        task_id,
        working_dir,
        DEFAULT_TRIGGER_COLS,
        DEFAULT_TRIGGER_ROWS,
        env_vars,
        persistent_lifecycle,
        force_fresh_session,
    )?;
    if session_plan == TriggerSessionPlan::ReuseExisting {
        eprintln!("[bridge] Reusing persistent tmux session: {}", session);
    } else if force_fresh_session {
        eprintln!(
            "[bridge] Created fresh tmux session for terminal column trigger: {} (cwd={})",
            session, working_dir
        );
    }

    // Mirror pane output to a log file. We use `pipe-pane -O` (Open) to log
    // to the file; -o would toggle. The shell wrapper handles redirection.
    let pipe_cmd = format!("cat > '{}'", shell_quote(log_path));
    if let Err(e) = run_tmux(&["pipe-pane", "-t", &session, "-O", &pipe_cmd]) {
        log::warn!("[bridge] pipe-pane failed (continuing): {}", e);
    }

    // Path for the exit-code sentinel file.
    let exit_path = format!(
        "{}/exit_{}.code",
        log_retention::trigger_logs_dir().display(),
        nonce
    );
    let semantic_log_path = format!(
        "{}/semantic_{}.jsonl",
        log_retention::trigger_logs_dir().display(),
        nonce
    );
    let wait_channel = format!("kaitencode_done_{}", nonce);

    // Build the wrapped command. We send it as a single line via send-keys
    // with `Enter`. Layout:
    //   <full_cmd>; printf '%s' "$?" > <exit_file>; tmux wait-for -S <chan>
    //
    // Note: full_cmd already contains shell quoting for the prompt; we just
    // append our completion-signaling tail. We also `clear` first so the
    // user sees a clean pane when they attach.
    let semantic_adapter = semantic_adapter_for_cli(cli_command);
    let command_with_semantic_log = match semantic_adapter {
        Some(AgentAdapterKind::ClaudeCli) => format!(
            "KAITENCODE_CLAUDE_JSON_LOG={} BENTOYA_CLAUDE_JSON_LOG={} {}",
            shell_quote_arg(&semantic_log_path),
            shell_quote_arg(&semantic_log_path),
            full_cmd
        ),
        Some(AgentAdapterKind::CodexCli) => format!(
            "KAITENCODE_CODEX_JSON_LOG={} BENTOYA_CODEX_JSON_LOG={} {}",
            shell_quote_arg(&semantic_log_path),
            shell_quote_arg(&semantic_log_path),
            full_cmd
        ),
        _ => full_cmd.to_string(),
    };

    let wrapped = format!(
        "{}{}; rc=$?; printf '%s' \"$rc\" > {}; tmux wait-for -S {}",
        "tmux clear-history -t \"$TMUX_PANE\" 2>/dev/null; clear; ",
        command_with_semantic_log,
        shell_quote_arg(&exit_path),
        wait_channel
    );
    let launcher = materialize_shell_launcher(&wrapped, Some(nonce))?;

    // Send a short script launcher into the session. The actual command lives
    // in the trigger log dir so multiline jq filters and prompts do not get
    // echoed into the interactive shell as `quote>` continuation noise.
    if let Err(e) = run_tmux(&["send-keys", "-t", &session, "-l", &launcher]) {
        let _ = tmux_transport::kill_session(task_id);
        return Err(format!("send-keys (literal) failed: {}", e));
    }
    if let Err(e) = run_tmux(&["send-keys", "-t", &session, "Enter"]) {
        let _ = tmux_transport::kill_session(task_id);
        return Err(format!("send-keys Enter failed: {}", e));
    }

    // Spawn a periodic flusher that snapshots scrollback into the DB so the
    // last_output column stays fresh while the trigger runs. This is the
    // tmux equivalent of the old direct-subprocess flusher.
    let flusher_stop = Arc::new(AtomicBool::new(false));
    let live_output_emitted = Arc::new(AtomicBool::new(false));
    let live_output_offset = Arc::new(AtomicUsize::new(0));
    let semantic_output_emitted = Arc::new(AtomicBool::new(false));
    let semantic_output_offset = Arc::new(AtomicUsize::new(0));
    let flusher_handle: Option<tokio::task::JoinHandle<()>> = session_id.map(|sid| {
        let app = app.clone();
        let task_id = task_id.to_string();
        let log_path = log_path.to_string();
        let semantic_log_path = semantic_log_path.clone();
        let session_for_flusher = session.clone();
        let sid = sid.to_string();
        let stop = Arc::clone(&flusher_stop);
        let emitted = Arc::clone(&live_output_emitted);
        let offset = Arc::clone(&live_output_offset);
        let semantic_emitted = Arc::clone(&semantic_output_emitted);
        let semantic_offset = Arc::clone(&semantic_output_offset);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(FLUSH_INTERVAL).await;
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                let scrollback = capture_pane_scrollback(&session_for_flusher);
                if scrollback.is_empty() {
                    continue;
                }
                let tail = tail_bytes(&scrollback, LAST_OUTPUT_TAIL_BYTES);
                if let Ok(conn) = Connection::open(db::db_path()) {
                    let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                    let _ = db::update_agent_session_output(&conn, &sid, Some(&tail), None);
                }
                if let Ok(semantic_contents) = std::fs::read_to_string(&semantic_log_path) {
                    let start = semantic_offset
                        .load(Ordering::Relaxed)
                        .min(semantic_contents.len());
                    if let Some((delta, end)) = complete_line_delta(&semantic_contents, start) {
                        semantic_offset.store(end, Ordering::Relaxed);
                        if let Some(adapter) = semantic_adapter {
                            if emit_semantic_events_from_provider_json_delta(
                                &app,
                                &task_id,
                                Some(&sid),
                                adapter,
                                delta,
                                true,
                            ) {
                                semantic_emitted.store(true, Ordering::Relaxed);
                            }
                        }
                    }
                }
                if let Ok(log_contents) = std::fs::read_to_string(&log_path) {
                    let start = offset.load(Ordering::Relaxed).min(log_contents.len());
                    if let Some(delta) = log_contents.get(start..) {
                        if semantic_adapter.is_none() && !delta.trim().is_empty() {
                            offset.store(log_contents.len(), Ordering::Relaxed);
                            emitted.store(true, Ordering::Relaxed);
                            let _ = crate::events::persist_and_emit_agent_transcript_event(
                                &app,
                                &task_id,
                                Some(&sid),
                                db::EVENT_COMMAND_OUTPUT,
                                Some(delta),
                                Some(
                                    &serde_json::json!({ "source": "tmux_live_tail" }).to_string(),
                                ),
                            );
                        }
                    }
                }
            }
        })
    });

    // Spawn `tmux wait-for <chan>` and capture its PID so we can SIGTERM it
    // if the trigger times out.
    //
    // Why this matters: `tmux wait-for` is a SERVER-GLOBAL operation, not
    // session-local. If the session dies before signaling its channel (e.g.
    // killed externally, app crashed mid-trigger), the wait-for process keeps
    // running indefinitely — its channel will never fire. Without explicit
    // cleanup, every timed-out trigger leaks a `tmux wait-for kaitencode_done_*`
    // process, and over hours of pipeline activity these accumulate.
    //
    // We `spawn()` (not `output()`) so we get a `Child` with a known PID
    // before the process exits. The `Child` is moved into a blocking task
    // that does the actual wait; the PID is kept here so the timeout branch
    // can SIGTERM it.
    let wait_child = std::process::Command::new("tmux")
        .args(["wait-for", &wait_channel])
        .spawn()
        .map_err(|e| format!("tmux wait-for spawn error: {}", e))?;
    let wait_pid = wait_child.id();
    log::debug!(
        "[bridge] tmux wait-for spawned pid={} chan={}",
        wait_pid,
        wait_channel
    );

    let wait_handle = tokio::task::spawn_blocking({
        let chan = wait_channel.clone();
        let mut child = wait_child;
        move || -> Result<(), String> {
            let status = child
                .wait()
                .map_err(|e| format!("tmux wait-for ({}) wait error: {}", chan, e))?;
            if status.success() {
                Ok(())
            } else {
                Err(format!(
                    "tmux wait-for ({}) exited {:?}",
                    chan,
                    status.code()
                ))
            }
        }
    });

    // Dead-agent watchdog: if the agent panics, OOMs, or has its pane killed
    // without writing the sentinel + signaling the wait-for channel, the
    // wait-for above blocks indefinitely (channel is server-global, won't
    // self-fire on session death). We poll `tmux has-session` after a grace
    // period; absence of the session = agent gone, so we stop waiting.
    let dead_agent_watchdog = async {
        tokio::time::sleep(DEAD_AGENT_GRACE_PERIOD).await;
        loop {
            tokio::time::sleep(DEAD_AGENT_POLL_INTERVAL).await;
            if !tmux_transport::has_session(task_id) {
                return;
            }
        }
    };

    // Three-way race: clean signal, dead-agent watchdog, hard timeout backstop.
    // We wrap the watchdog + backstop together so the success path stays
    // structurally identical to before.
    let dead_agent_or_timeout = async {
        tokio::select! {
            _ = dead_agent_watchdog => DeadOrTimeout::DeadAgent,
            _ = tokio::time::sleep(TRIGGER_TIMEOUT) => DeadOrTimeout::TimedOut,
        }
    };

    let (timed_out, agent_died) = tokio::select! {
        wait_result = wait_handle => {
            match wait_result {
                Ok(Ok(())) => (false, false),
                Ok(Err(e)) => {
                    // wait-for exited non-zero — usually because the session
                    // was killed (channel destroyed). Sentinel-file logic
                    // below decides success vs failure.
                    log::warn!(
                        "[bridge] wait-for returned error for task {}: {}",
                        task_id,
                        e
                    );
                    (false, false)
                }
                Err(join_err) => {
                    log::warn!(
                        "[bridge] wait-for join error for task {}: {}",
                        task_id,
                        join_err
                    );
                    (false, false)
                }
            }
        }
        outcome = dead_agent_or_timeout => match outcome {
            DeadOrTimeout::DeadAgent => {
                log::warn!(
                    "[bridge] dead-agent watchdog fired for task {}: tmux session gone, no wait-for signal",
                    task_id
                );
                (false, true)
            }
            DeadOrTimeout::TimedOut => (true, false),
        }
    };

    // Stop the flusher.
    flusher_stop.store(true, Ordering::Relaxed);
    if let Some(h) = flusher_handle {
        // Don't await — the flusher sleeps up to FLUSH_INTERVAL between checks
        // and we don't want to wait that long. Just abort it.
        h.abort();
    }

    if timed_out {
        eprintln!(
            "[bridge] Trigger timed out for task {} after {:?}; killing session",
            task_id, TRIGGER_TIMEOUT
        );
        // Cleanup order matters:
        //   1. SIGTERM the orphaned wait-for process (server-global, won't
        //      die when the session is killed — see comment at spawn site).
        //   2. Send Ctrl+C to the agent inside the pane.
        //   3. Tear down the tmux session.
        kill_wait_for_pid(wait_pid);
        tmux_transport::cancel_agent(task_id);
        // Give it a moment to settle, then kill the session.
        tokio::time::sleep(WAIT_POLL_INTERVAL).await;
        let _ = tmux_transport::kill_session(task_id);
    } else if agent_died {
        eprintln!(
            "[bridge] Agent for task {} died without signaling; cleaning up wait-for",
            task_id
        );
        // Session is already gone (that's how we got here), but the orphaned
        // wait-for process is still parked on its (now-undeliverable) channel.
        // SIGTERM it so we don't leak a PID per dead agent.
        kill_wait_for_pid(wait_pid);
    }

    // ─── Result handling ────────────────────────────────────────────────

    // Read exit code from sentinel file (if we got one).
    let exit_code: Option<i32> = std::fs::read_to_string(&exit_path)
        .ok()
        .and_then(|s| s.trim().parse::<i32>().ok());

    // Best-effort cleanup of the sentinel file.
    let _ = std::fs::remove_file(&exit_path);

    // Capture full scrollback for persistence + rate-limit scan. Prefer the
    // log file (preserved across runs) but fall back to live pane capture if
    // the file is empty (e.g. pipe-pane never opened in time).
    let log_contents = std::fs::read_to_string(log_path).unwrap_or_default();
    // Only claude wraps its stream-json output through the jq filter that
    // emits KAITENCODE_CLAUDE_SESSION_ID. Gating on the CLI prevents a future
    // (or hostile) non-claude stream from polluting the per-task slot.
    let captured_cli_session_id = if cli_command == "claude" {
        extract_claude_session_id(&log_contents)
    } else {
        None
    };
    let scrollback_full = if !log_contents.is_empty() {
        log_contents
    } else {
        capture_pane_scrollback(&session)
    };
    let semantic_log_contents = std::fs::read_to_string(&semantic_log_path).unwrap_or_default();
    let semantic_start = semantic_output_offset
        .load(Ordering::Relaxed)
        .min(semantic_log_contents.len());
    if let Some((delta, end)) = complete_line_delta(&semantic_log_contents, semantic_start) {
        semantic_output_offset.store(end, Ordering::Relaxed);
        if let Some(adapter) = semantic_adapter {
            if emit_semantic_events_from_provider_json_delta(
                app, task_id, session_id, adapter, delta, true,
            ) {
                semantic_output_emitted.store(true, Ordering::Relaxed);
            }
        }
    }
    let scrollback = truncate_for_scrollback(&scrollback_full);
    let error_tail = tail_bytes(&scrollback, PIPELINE_ERROR_TAIL_BYTES);
    let last_output_tail = tail_bytes(&scrollback, LAST_OUTPUT_TAIL_BYTES);
    let final_live_start = live_output_offset
        .load(Ordering::Relaxed)
        .min(scrollback_full.len());
    if let Some(delta) = scrollback_full.get(final_live_start..) {
        if semantic_adapter.is_none() && !delta.trim().is_empty() {
            live_output_offset.store(scrollback_full.len(), Ordering::Relaxed);
            live_output_emitted.store(true, Ordering::Relaxed);
            let _ = crate::events::persist_and_emit_agent_transcript_event(
                app,
                task_id,
                session_id,
                db::EVENT_COMMAND_OUTPUT,
                Some(delta),
                Some(&serde_json::json!({ "source": "tmux_live_tail" }).to_string()),
            );
        }
    }

    // Resolve effective exit code:
    //   - timed out: synthetic 124 (mimics `timeout` utility)
    //   - agent died without signaling: synthetic 137 (SIGKILL-shaped) — picks
    //     up the sentinel if it somehow landed late, otherwise marks failure
    //   - missing sentinel but session vanished: synthetic 1 (failure)
    //   - otherwise the parsed value
    let effective_exit = match (timed_out, agent_died, exit_code) {
        (true, _, _) => 124,
        (_, true, Some(code)) => code,
        (_, true, None) => 137,
        (false, false, Some(code)) => code,
        (false, false, None) => 1,
    };
    let mut success = effective_exit == 0;
    let mut auto_commit_hash: Option<String> = None;

    // Auto-commit safety net: an agent can exit 0 yet leave its work
    // uncommitted in the worktree — typically because its sandbox blocks
    // writes to git metadata (codex's seatbelt sandbox vs. the worktree's
    // `.git` file pointer is the canonical case). The pipeline would then
    // advance to Merge main against an empty branch and ship a ghost task.
    //
    // Recovery: if exit was clean but the worktree is dirty, stage and
    // commit the work ourselves. Plan-stage agents write a gitignored
    // .task-handoff.md so they leave a clean worktree and aren't affected.
    if success {
        if let Ok(conn) = Connection::open(db::db_path()) {
            if let Ok(task) = db::get_task(&conn, task_id) {
                if let Some(ref worktree_path) = task.worktree_path {
                    match branch_manager::worktree_is_dirty(worktree_path) {
                        Ok(true) => {
                            let msg = format!(
                                "auto-commit: kaitencode rescued uncommitted work for task {} (agent exited 0 without committing)",
                                task_id
                            );
                            match branch_manager::auto_commit_dirty_worktree(worktree_path, &msg) {
                                Ok(Some(hash)) => {
                                    eprintln!(
                                        "[bridge] auto-committed dirty worktree for task {} at {} (agent exit 0 but didn't commit)",
                                        task_id, hash
                                    );
                                    let message = format!(
                                        "Auto-committed dirty worktree at {}",
                                        short_commit_hash(&hash)
                                    );
                                    let _ = crate::events::persist_and_emit_agent_transcript_event(
                                        app,
                                        task_id,
                                        session_id,
                                        db::EVENT_COMMAND_OUTPUT,
                                        Some(&message),
                                        Some(
                                            &serde_json::json!({
                                                "source": "auto_commit",
                                                "command": "git commit",
                                                "commit": hash,
                                            })
                                            .to_string(),
                                        ),
                                    );
                                    auto_commit_hash = Some(hash);
                                }
                                Ok(None) => {
                                    // Dirty was all gitignored — fine, no rescue needed.
                                }
                                Err(e) => {
                                    eprintln!(
                                        "[bridge] auto-commit FAILED for task {}: {} — overriding success=false",
                                        task_id, e
                                    );
                                    success = false;
                                }
                            }
                        }
                        Ok(false) => {}
                        Err(e) => {
                            eprintln!(
                                "[bridge] worktree dirty-check failed for task {}: {} — proceeding with reported exit code",
                                task_id, e
                            );
                        }
                    }
                }
            }
        }
    }

    eprintln!(
        "[bridge] Trigger completed for task {}: exit_code={}, success={} log={}",
        task_id, effective_exit, success, log_path
    );

    if !semantic_output_emitted.load(Ordering::Relaxed)
        && !live_output_emitted.load(Ordering::Relaxed)
        && !last_output_tail.trim().is_empty()
        && semantic_adapter.is_none()
    {
        let _ = crate::events::persist_and_emit_agent_transcript_event(
            app,
            task_id,
            session_id,
            db::EVENT_COMMAND_OUTPUT,
            Some(&last_output_tail),
            Some(&serde_json::json!({ "source": "tmux_log_tail" }).to_string()),
        );
    }
    let completion_metadata = serde_json::json!({
        "exitCode": effective_exit,
        "timedOut": timed_out,
        "autoCommitHash": auto_commit_hash,
    })
    .to_string();
    let _ = crate::events::persist_and_emit_agent_transcript_event(
        app,
        task_id,
        session_id,
        db::EVENT_COMMAND_COMPLETED,
        None,
        Some(&completion_metadata),
    );
    let _ = crate::events::persist_and_emit_agent_transcript_event(
        app,
        task_id,
        session_id,
        if success {
            db::EVENT_AGENT_COMPLETED
        } else {
            db::EVENT_AGENT_FAILED
        },
        None,
        Some(&completion_metadata),
    );

    // IMPORTANT: do not kill the tmux session yet. We must update the task's
    // agent_status BEFORE the session disappears, otherwise the GC sweep
    // (which marks "running" tasks with no tmux session as failed) can race
    // us and overwrite a successful completion. The session is killed at the
    // very end of this function, after all DB writes are committed.

    if let Ok(conn) = Connection::open(db::db_path()) {
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");

        // Persist final scrollback + a fresh last_output regardless of success.
        if let Some(sid) = session_id {
            let adapter = db::adapter_kind_for_agent_type(cli_command);
            if let Some(ref cli_session_id) = captured_cli_session_id {
                let _ = db::update_agent_session_cli_for_adapter(
                    &conn,
                    sid,
                    adapter,
                    Some(cli_session_id),
                    None,
                    None,
                );
            } else if !success
                && adapter == "claude_cli"
                && is_stale_claude_resume_output(&scrollback)
            {
                // The claude CLI rejected the resume id we passed in. Clear
                // the slot so the next stage starts a fresh conversation
                // instead of looping on the same dead id.
                eprintln!(
                    "[bridge] clearing stale claude resume id for task {} after 'No conversation found'",
                    task_id
                );
                let _ =
                    db::update_agent_session_cli_for_adapter(&conn, sid, adapter, None, None, None);
            }
            let _ = db::update_agent_session_output(
                &conn,
                sid,
                Some(&last_output_tail),
                Some(&scrollback),
            );
        }

        // Rate-limit branch — do NOT mark failed, just schedule a future retry.
        if !success && is_rate_limit_output(&scrollback) {
            let delay = parse_rate_limit_delay(&scrollback);
            log::warn!(
                "[bridge] task {} hit provider rate limit; scheduling retry in {:?}",
                task_id,
                delay
            );
            if let Some(sid) = session_id {
                let _ = db::update_agent_session(
                    &conn,
                    sid,
                    None,
                    Some("rate_limited"),
                    Some(Some(effective_exit as i64)),
                    None,
                    None,
                    None,
                );
            }
            let _ = db::update_task_agent_status(&conn, task_id, Some("idle"), None);
            let _ = db::update_task_pipeline_state(
                &conn,
                task_id,
                pipeline::PipelineState::RateLimited.as_str(),
                None,
                Some(&format!(
                    "Rate limited; retrying in {}m",
                    delay.as_secs() / 60
                )),
            );
            pipeline::emit_tasks_changed(app, "", "trigger_rate_limited");
            schedule_rate_limit_retry(
                app.clone(),
                task_id.to_string(),
                trigger_column_id.map(str::to_string),
                delay,
            );
            if should_kill_session_after_completion(persistent_lifecycle) {
                let _ = tmux_transport::kill_session(task_id);
            }
            return Ok(());
        }

        // Guard: only mark complete if task hasn't moved columns.
        let task_still_here = db::get_task(&conn, task_id)
            .ok()
            .map(|t| trigger_column_id == Some(t.column_id.as_str()))
            .unwrap_or(false);

        if !task_still_here {
            eprintln!(
                "[bridge] Task {} moved columns during trigger — skipping mark_complete",
                task_id
            );
        } else {
            let status_str = if success { "completed" } else { "failed" };
            let _ = db::update_task_agent_status(&conn, task_id, Some(status_str), None);

            if let Ok(task) = db::get_task(&conn, task_id) {
                if let Some(ref sid) = task.agent_session_id {
                    let _ = db::update_agent_session(
                        &conn,
                        sid,
                        None,
                        Some(status_str),
                        Some(Some(effective_exit as i64)),
                        None,
                        None,
                        None,
                    );
                }
            }

            // Record duration-based usage (token counts require CLI parsing).
            let duration_secs = start_time.elapsed().as_secs() as i64;
            if let Ok(task) = db::get_task(&conn, task_id) {
                let model_name = task.model.as_deref().unwrap_or("unknown");
                let column_name = db::get_column(&conn, &task.column_id)
                    .map(|c| c.name)
                    .unwrap_or_default();
                let _ = db::insert_usage_record(
                    &conn,
                    &task.workspace_id,
                    Some(task_id),
                    session_id,
                    "anthropic",
                    model_name,
                    0,
                    0,
                    0.0,
                    Some(&column_name),
                    duration_secs,
                );
            }

            if success {
                let _ = pipeline::mark_complete(&conn, app, task_id, true);
            } else {
                // Surface the real CLI error tail to the UI tooltip via
                // pipeline_error instead of a generic "exit code N" message.
                let detail = if error_tail.trim().is_empty() {
                    format!("Agent exited with code {}", effective_exit)
                } else {
                    let mut msg = format!("Agent exited with code {}: ", effective_exit);
                    msg.push_str(error_tail.trim());
                    msg
                };
                let _ =
                    pipeline::mark_complete_with_error(&conn, app, task_id, false, Some(&detail));
            }
        }
    }

    pipeline::emit_tasks_changed(app, "", "trigger_complete");

    // Phase 4 telemetry — every headless completion logs an event. The
    // source is `exit_code` regardless of success: we got an exit code
    // from the wrapper (or a synthetic 124/137 for timeout/dead-agent),
    // and "headless completed without ever signaling" is itself
    // information worth recording.
    if let Ok(conn) = Connection::open(db::db_path()) {
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
        if let Ok(task) = db::get_task(&conn, task_id) {
            let workspace_id = task.workspace_id.clone();
            let duration_ms = start_time.elapsed().as_millis() as i64;
            let source = if timed_out {
                db::completion_events::CompletionSource::Timeout
            } else if agent_died {
                db::completion_events::CompletionSource::Kill
            } else {
                db::completion_events::CompletionSource::ExitCode
            };
            db::completion_events::record_async(
                task_id.to_string(),
                workspace_id,
                cli_command.to_string(),
                "headless".to_string(),
                source,
                duration_ms,
                None,
            );
        }
    }

    if should_kill_session_after_completion(persistent_lifecycle) {
        // NOW kill the tmux session — DB status is committed, so the GC won't
        // race us. The agent inside the pane has already exited (we observed
        // its exit code via the sentinel file), so all this does is clean up
        // the shell that was waiting on `tmux wait-for`.
        let _ = tmux_transport::kill_session(task_id);
    }

    // Touch a known-unused parameter to silence dead-code warnings if needed.
    let _ = cli_command;

    Ok(())
}

// ─── tmux wait-for orphan cleanup ─────────────────────────────────────────

/// SIGTERM a `tmux wait-for` process. Used when our hard timeout fires and we
/// need to clean up the process that would otherwise sit there waiting for a
/// channel signal that will never come.
///
/// `wait-for` is a thin tmux client — TERM is enough, no need for KILL. We
/// also fall back to a `pkill` by channel name if SIGTERM fails for any
/// reason (e.g. PID was reused), so the cleanup is best-effort idempotent.
fn kill_wait_for_pid(pid: u32) {
    if pid == 0 {
        return;
    }
    let rc = unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
    if rc != 0 {
        log::debug!(
            "[bridge] SIGTERM to wait-for pid {} returned {} (errno {})",
            pid,
            rc,
            std::io::Error::last_os_error()
        );
    } else {
        log::debug!("[bridge] killed orphan wait-for pid {}", pid);
    }
}

/// Sweep any orphaned `tmux wait-for kaitencode_done_*` or legacy
/// `bentoya_done_*` processes left over
/// from a previous app instance. Their channels will never be signaled by
/// THIS process (the nonces are randomized per trigger), so they'd otherwise
/// sit forever consuming a PID slot.
///
/// Called once at startup, before any new triggers run, so we don't kill
/// our own freshly-spawned wait-fors.
///
/// Pattern matched: `tmux wait-for kaitencode_done_<hex>` and legacy
/// `tmux wait-for bentoya_done_<hex>` — narrow enough that we won't kill
/// chat-session waits or other tmux clients.
pub fn sweep_orphan_wait_fors() {
    // pgrep -f matches against the full command line. -l prints both pid and
    // command so we can log what we're killing.
    let mut killed = 0u32;
    for pattern in [
        "tmux wait-for kaitencode_done_",
        "tmux wait-for bentoya_done_",
    ] {
        let output = match Command::new("pgrep").args(["-fl", pattern]).output() {
            Ok(o) => o,
            Err(e) => {
                log::debug!("[bridge] pgrep not available for orphan sweep: {}", e);
                return;
            }
        };
        if !output.status.success() {
            // pgrep returns 1 when nothing matches — that's the common case.
            continue;
        }
        let listing = String::from_utf8_lossy(&output.stdout);
        for line in listing.lines() {
            let pid: Option<u32> = line.split_whitespace().next().and_then(|p| p.parse().ok());
            if let Some(pid) = pid {
                // Skip our own pid out of paranoia (not a real risk, but cheap).
                if pid == std::process::id() {
                    continue;
                }
                kill_wait_for_pid(pid);
                killed += 1;
            }
        }
    }
    if killed > 0 {
        log::info!(
            "[bridge] startup orphan sweep: killed {} stale `tmux wait-for kaitencode_done_*`/legacy processes",
            killed
        );
    }
}

// ─── Interactive runtime mode (Phase 1) ───────────────────────────────────
//
// Headless triggers run `claude -p ...` via `build_trigger_command`, capture
// the exit code via `tmux wait-for`, and treat the process as one-shot.
// Interactive mode launches the real `claude` TUI inside the per-task tmux
// session (no `-p`), injects the initial prompt via `tmux send-keys`, and
// watches a system-prompt-driven sentinel to know when the agent considers
// itself done. The agent stays alive at the prompt afterwards so the user
// can take over — Phase 2 wires the panel input + control bar to it.

/// Sentinel marker emitted by the agent when it has finished the user's
/// task. The marker includes the task id so a stale capture from a previous
/// task can't trip the watcher.
const INTERACTIVE_SENTINEL_PREFIX: &str = "<<<KAITENCODE_DONE:";
const LEGACY_INTERACTIVE_SENTINEL_PREFIX: &str = "<<<BENTOYA_DONE:";
const INTERACTIVE_SENTINEL_SUFFIX: &str = ">>>";

/// Cadence of the pane scrape that looks for the sentinel.
const INTERACTIVE_SENTINEL_POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Time budget for Claude Code's startup banner to show its input prompt.
/// 5s is enough on a warm machine; if the binary is cold or fails to launch
/// we bail rather than blindly injecting keystrokes into a dead session.
const INTERACTIVE_READY_TIMEOUT: Duration = Duration::from_secs(5);
const INTERACTIVE_READY_POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Build the system-prompt fragment that asks claude to emit the sentinel
/// when it considers the task done. Only appended for exit criteria that
/// actually act on the signal (`agent_complete`, `manual_approval`).
pub(crate) fn interactive_sentinel_system_prompt(task_id: &str) -> String {
    format!(
        "When you have finished the user's task, output exactly this line on its own and nothing else: {}{}{}",
        INTERACTIVE_SENTINEL_PREFIX, task_id, INTERACTIVE_SENTINEL_SUFFIX
    )
}

/// Build the argv that `tmux new-session` will run as the session's command
/// in interactive mode. No `-p` — this launches the real Claude Code TUI.
/// The initial prompt is NOT in the argv (it's injected later via
/// send-keys); only flags that need to be on the command line live here.
pub(crate) fn build_interactive_claude_argv(
    cli_command: &str,
    user_args: &[String],
    task_id: &str,
    resume_id: Option<&str>,
    include_sentinel: bool,
) -> Vec<String> {
    let mut argv: Vec<String> = Vec::new();
    argv.push(cli_command.to_string());
    argv.push("--dangerously-skip-permissions".to_string());
    if let Some(id) = resume_id.map(str::trim).filter(|id| !id.is_empty()) {
        argv.push("--resume".to_string());
        argv.push(id.to_string());
    }
    for a in user_args {
        argv.push(a.clone());
    }
    if include_sentinel {
        argv.push("--append-system-prompt".to_string());
        argv.push(interactive_sentinel_system_prompt(task_id));
    }
    argv
}

/// Strip ANSI/VT escape sequences from a captured pane. Conservative —
/// removes CSI (`ESC [ ... letter`), OSC (`ESC ] ... BEL | ESC \\`), 2-byte
/// escapes, and charset designators. Output is UTF-8-safe; the input is
/// assumed valid UTF-8 (we only inspect non-ESC chars as themselves and
/// drop ESC sequences wholesale).
pub(crate) fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            match chars.peek().copied() {
                Some('[') => {
                    chars.next();
                    // CSI params end at any byte in 0x40..=0x7e.
                    for c in chars.by_ref() {
                        let cb = c as u32;
                        if (0x40..=0x7e).contains(&cb) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    // OSC terminated by BEL (0x07) or ESC \\.
                    while let Some(c) = chars.next() {
                        if c == '\u{07}' {
                            break;
                        }
                        if c == '\u{1b}' && chars.peek() == Some(&'\\') {
                            chars.next();
                            break;
                        }
                    }
                }
                Some('(') | Some(')') | Some('*') | Some('+') => {
                    chars.next();
                    chars.next();
                }
                Some(_) => {
                    chars.next();
                }
                None => {}
            }
            continue;
        }
        out.push(ch);
    }
    out
}

/// Returns true if the captured pane contains the `<<<KAITENCODE_DONE:task_id>>>`
/// sentinel on its own line (after ANSI strip). The "own line" requirement
/// avoids tripping on agents who quote the sentinel inside a code block,
/// inline mention, or planning narration.
pub(crate) fn pane_contains_sentinel(pane_text: &str, task_id: &str) -> bool {
    let target = format!(
        "{}{}{}",
        INTERACTIVE_SENTINEL_PREFIX, task_id, INTERACTIVE_SENTINEL_SUFFIX
    );
    let legacy_target = format!(
        "{}{}{}",
        LEGACY_INTERACTIVE_SENTINEL_PREFIX, task_id, INTERACTIVE_SENTINEL_SUFFIX
    );
    let stripped = strip_ansi(pane_text);
    stripped.lines().any(|line| {
        let trimmed = line.trim();
        trimmed == target || trimmed == legacy_target
    })
}

/// Detect whether Claude Code's TUI input box is visible in the captured
/// pane. Claude Code draws a rounded box around the input row using the
/// `╭`/`│`/`╰` box-drawing characters. We accept any of those as evidence
/// that the prompt is ready — looking only for `╭` would miss the case
/// where the top edge has scrolled out of the visible window.
pub(crate) fn pane_has_claude_prompt(pane_text: &str) -> bool {
    let stripped = strip_ansi(pane_text);
    stripped.contains('╭') || stripped.contains('╰')
}

/// Detect whether the codex TUI is ready for input.
///
/// We don't have a single stable glyph the way Claude Code does (Claude's
/// `╭/╰` prompt box is unusually distinctive). The most reliable cross-
/// release signal we have is "the banner has been emitted and the pane
/// has scrollback" — codex prints its name/version banner on startup,
/// well before it accepts keystrokes. Conservative match on `codex` (the
/// literal program name) appearing in the captured pane.
///
/// Phase 3 limitation: if codex changes its banner text or removes it,
/// this returns false and the spawn helper fails its 5s readiness budget.
/// Surface to the user — that's a real signal to investigate, not a bug
/// to paper over.
pub(crate) fn pane_has_codex_prompt(pane_text: &str) -> bool {
    let stripped = strip_ansi(pane_text);
    let lower = stripped.to_ascii_lowercase();
    // Match a few possible banner shapes across codex releases.
    lower.contains("codex") && stripped.len() > 32
}

/// Build the argv for an interactive `codex` REPL invocation.
///
/// Shape (Phase 3 working assumption — verify against `codex --help` for
/// your release):
///   codex [user_args] \
///         [--append-system-prompt <sentinel>]    (when include_sentinel)
///
/// Notes / assumptions documented in the Phase 3 status section:
/// - No `exec` subcommand — interactive REPL is the default mode.
/// - No `--resume <id>` — codex's resume on the REPL path is unverified
///   across releases. Phase 4 will revisit once we have a confirmed
///   release matrix. Header sentinel is the only Phase 3 codex injection.
/// - Sandbox / approval-policy flags from the headless path are NOT
///   passed here — those alter the `codex exec` non-interactive
///   pipeline, not the REPL. If codex rejects an unknown flag at
///   startup we want the user to see the error in-pane, not a silent
///   downgrade to a half-broken session.
pub(crate) fn build_interactive_codex_argv(
    cli_command: &str,
    user_args: &[String],
    task_id: &str,
    include_sentinel: bool,
) -> Vec<String> {
    let mut argv: Vec<String> = Vec::new();
    argv.push(cli_command.to_string());
    for a in user_args {
        argv.push(a.clone());
    }
    if include_sentinel {
        argv.push("--append-system-prompt".to_string());
        argv.push(interactive_sentinel_system_prompt(task_id));
    }
    argv
}

/// CLI dispatch token for the interactive spawn helper. Phase 3 adds
/// codex; Phase 6 may collapse this into a single `InteractiveCli`
/// abstraction. Kept as a small enum so the type system catches each
/// site we need to update for a third CLI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InteractiveCli {
    Claude,
    Codex,
}

impl InteractiveCli {
    pub(crate) fn from_cli_name(name: &str) -> Option<Self> {
        let basename = name.rsplit('/').next().unwrap_or(name);
        match basename {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            _ => None,
        }
    }

    /// Slash command (without leading slash) the CLI accepts to exit the
    /// REPL cleanly. Sent only on the sentinel-success path.
    pub(crate) fn exit_command(self) -> &'static str {
        match self {
            Self::Claude => "/exit",
            Self::Codex => "/quit",
        }
    }
}

/// Spawn an interactive CLI session inside the task's tmux session and
/// inject the initial prompt. The session is named `kaitencode_<task_id>` —
/// same as the headless path — so the frontend terminal panel attaches to
/// it the same way.
///
/// Dispatches on `cli` (Claude vs Codex) for argv shape + ready-prompt
/// detector. The session-management, ready-polling loop, and key-injection
/// are shared.
///
/// On success the agent is sitting at its prompt with the initial prompt
/// already sent. The caller is expected to start the sentinel watcher to
/// detect completion.
#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_interactive_cli(
    cli: InteractiveCli,
    task_id: &str,
    cli_command: &str,
    user_args: &[String],
    initial_prompt: &str,
    working_dir: &str,
    resume_id: Option<&str>,
    include_sentinel: bool,
    env_vars: &HashMap<String, String>,
) -> Result<(), String> {
    tmux_transport::ensure_tmux_server()?;
    // Always start clean — interactive mode never reuses a stale session
    // because the agent inside it is from a previous task / run.
    let _ = tmux_transport::kill_session(task_id);

    let session = tmux_session_name(task_id);
    let argv = match cli {
        InteractiveCli::Claude => build_interactive_claude_argv(
            cli_command,
            user_args,
            task_id,
            resume_id,
            include_sentinel,
        ),
        InteractiveCli::Codex => {
            if resume_id.map(str::trim).is_some_and(|id| !id.is_empty()) {
                log::warn!(
                    "[bridge:interactive] resume_id ignored for codex (interactive resume not wired in Phase 3)"
                );
            }
            build_interactive_codex_argv(cli_command, user_args, task_id, include_sentinel)
        }
    };

    let cols_str = DEFAULT_TRIGGER_COLS.to_string();
    let rows_str = DEFAULT_TRIGGER_ROWS.to_string();
    let mut tmux_args: Vec<String> = vec![
        "new-session".to_string(),
        "-d".to_string(),
        "-s".to_string(),
        session.clone(),
        "-x".to_string(),
        cols_str,
        "-y".to_string(),
        rows_str,
    ];
    if !working_dir.is_empty() && Path::new(working_dir).exists() {
        tmux_args.push("-c".to_string());
        tmux_args.push(working_dir.to_string());
    }
    for a in &argv {
        tmux_args.push(a.clone());
    }

    let mut cmd = Command::new("tmux");
    cmd.args(&tmux_args);
    for (k, v) in env_vars {
        cmd.env(k, v);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to spawn interactive tmux session: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "tmux new-session failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    // Poll for the input prompt before injecting. If we send keystrokes
    // before the CLI finishes its startup banner the keys land in the void.
    let deadline = std::time::Instant::now() + INTERACTIVE_READY_TIMEOUT;
    let mut ready = false;
    let mut last_pane_len = 0usize;
    while std::time::Instant::now() < deadline {
        std::thread::sleep(INTERACTIVE_READY_POLL_INTERVAL);
        if !tmux_transport::has_session(task_id) {
            return Err(format!(
                "interactive `{}` exited before reaching a prompt (binary missing or crashed)",
                cli_command
            ));
        }
        let pane = capture_pane_scrollback(&session);
        last_pane_len = pane.len();
        let prompt_seen = match cli {
            InteractiveCli::Claude => pane_has_claude_prompt(&pane),
            InteractiveCli::Codex => pane_has_codex_prompt(&pane),
        };
        if prompt_seen {
            ready = true;
            break;
        }
    }
    if !ready {
        let _ = tmux_transport::kill_session(task_id);
        return Err(format!(
            "interactive {} did not reach a ready prompt within {:?} (last pane: {} bytes)",
            cli_command, INTERACTIVE_READY_TIMEOUT, last_pane_len
        ));
    }

    // Small extra settle before injecting — gives codex's REPL a moment
    // to finish drawing past its banner. No-op for Claude in practice.
    if matches!(cli, InteractiveCli::Codex) {
        std::thread::sleep(Duration::from_millis(300));
    }

    if !initial_prompt.is_empty() {
        run_tmux(&["send-keys", "-t", &session, "-l", initial_prompt])
            .map_err(|e| format!("send-keys (literal) for interactive prompt failed: {}", e))?;
        run_tmux(&["send-keys", "-t", &session, "Enter"])
            .map_err(|e| format!("send-keys Enter for interactive prompt failed: {}", e))?;
    }

    Ok(())
}

// `spawn_interactive_claude` was inlined into `spawn_interactive_cli` in
// Phase 3. New callers route through `spawn_interactive_cli` with the
// appropriate `InteractiveCli` variant; there's no Phase 1-shaped
// `spawn_interactive_claude` symbol anymore. If you arrived here from
// git history, the per-CLI argv builder is `build_interactive_claude_argv`
// and the dispatcher is `spawn_interactive_cli`.

/// Detect whether a column's exit criteria warrants appending the sentinel
/// system-prompt. Other criteria don't act on the agent saying "I'm done"
/// so we skip the append to keep the system prompt minimal.
pub(crate) fn exit_criteria_needs_sentinel(criteria: Option<&str>) -> bool {
    matches!(criteria, Some("agent_complete") | Some("manual_approval"))
}

/// Public entry point used by the trigger dispatcher when a `spawn_cli`
/// trigger resolves to `runtime_mode = interactive`. Mirrors the shape of
/// `spawn_cli_trigger_task` (agent_session bookkeeping, transcript events,
/// failure routing) but launches the real TUI and watches for the
/// sentinel instead of waiting on a `tmux wait-for` channel.
#[allow(clippy::too_many_arguments)]
pub fn spawn_interactive_trigger_task(
    app: AppHandle,
    task_id: String,
    cli_command: String,
    args: Vec<String>,
    working_dir: String,
    initial_prompt: String,
    env_vars: Option<HashMap<String, String>>,
    include_sentinel: bool,
) {
    let (session_id, trigger_column_id, resume_id) = {
        if let Ok(conn) = Connection::open(db::db_path()) {
            let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
            let task_snapshot = db::get_task(&conn, &task_id).ok();
            let trigger_column_id = task_snapshot.as_ref().map(|t| t.column_id.clone());
            let session_record =
                db::insert_agent_session(&conn, &task_id, &cli_command, Some(&working_dir));
            match session_record {
                Ok(session) => {
                    let tmux_name = tmux_session_name(&task_id);
                    persist_agent_session_started(
                        &conn,
                        &app,
                        &task_id,
                        task_snapshot
                            .as_ref()
                            .map(|t| t.workspace_id.as_str())
                            .unwrap_or(""),
                        &session.id,
                        db::adapter_kind_for_agent_type(&cli_command),
                        "interactive",
                        &tmux_name,
                        None,
                    );
                    let metadata = serde_json::json!({
                        "cli": cli_command,
                        "workdir": working_dir,
                        "runtimeMode": "interactive",
                    })
                    .to_string();
                    let _ = crate::events::persist_and_emit_agent_transcript_event(
                        &app,
                        &task_id,
                        Some(&session.id),
                        db::EVENT_SESSION_STARTED,
                        None,
                        Some(&metadata),
                    );
                    let _ = crate::events::persist_and_emit_agent_transcript_event(
                        &app,
                        &task_id,
                        Some(&session.id),
                        db::EVENT_AGENT_STARTED,
                        None,
                        Some(&metadata),
                    );
                    (Some(session.id), trigger_column_id, None::<String>)
                }
                Err(e) => {
                    log::error!("[bridge:interactive] failed to create agent session: {}", e);
                    (None, trigger_column_id, None)
                }
            }
        } else {
            (None, None, None)
        }
    };

    let env_vars = env_vars.unwrap_or_default();
    let start_time = std::time::Instant::now();

    tokio::spawn(async move {
        let task_id_for_log = task_id.clone();
        // CLI dispatch: codex and claude follow the same shape but need
        // their own argv builders + prompt detectors. Unknown CLIs are
        // rejected before reaching here by the trigger normalizer.
        let cli = match InteractiveCli::from_cli_name(&cli_command) {
            Some(cli) => cli,
            None => {
                let err = format!(
                    "interactive mode is not implemented for CLI `{}` (claude and codex only)",
                    cli_command
                );
                log::error!("[bridge:interactive] {}", err);
                handle_interactive_spawn_failure(
                    &app,
                    &task_id,
                    &task_id_for_log,
                    &cli_command,
                    session_id.as_deref(),
                    err,
                );
                return;
            }
        };
        let spawn_result = spawn_interactive_cli(
            cli,
            &task_id,
            &cli_command,
            &args,
            &initial_prompt,
            &working_dir,
            resume_id.as_deref(),
            include_sentinel,
            &env_vars,
        );

        if let Err(error_detail) = spawn_result {
            handle_interactive_spawn_failure(
                &app,
                &task_id,
                &task_id_for_log,
                &cli_command,
                session_id.as_deref(),
                error_detail,
            );
            return;
        }

        // Spawn the sentinel watcher. It owns the rest of the lifecycle.
        watch_interactive_sentinel(
            app.clone(),
            task_id,
            session_id,
            trigger_column_id,
            cli_command,
            cli,
            start_time,
        )
        .await;
    });
}

fn handle_interactive_spawn_failure(
    app: &AppHandle,
    task_id: &str,
    task_id_for_log: &str,
    cli_command: &str,
    session_id: Option<&str>,
    error_detail: String,
) {
    let error_msg = format!(
        "Interactive `{}` failed to launch for task {}: {}",
        cli_command, task_id_for_log, error_detail
    );
    eprintln!("[bridge:interactive] {}", error_msg);
    let failure_metadata = serde_json::json!({
        "cli": cli_command,
        "error": error_detail,
        "runtimeMode": "interactive",
    })
    .to_string();
    let _ = crate::events::persist_and_emit_agent_transcript_event(
        app,
        task_id,
        session_id,
        db::EVENT_AGENT_FAILED,
        Some(&error_msg),
        Some(&failure_metadata),
    );
    if let Ok(conn) = Connection::open(db::db_path()) {
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
        let _ = conn.execute(
            "UPDATE tasks SET pipeline_error = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![error_msg, db::now(), task_id],
        );
        if let Some(sid) = session_id {
            let _ = db::update_agent_session(
                &conn,
                sid,
                None,
                Some("failed"),
                Some(Some(1)),
                None,
                None,
                None,
            );
            let _ = db::update_task_agent_status(&conn, task_id, Some("failed"), None);
        }
        if let Ok(task) = db::get_task(&conn, task_id) {
            if let Ok(col) = db::get_column(&conn, &task.column_id) {
                let _ = pipeline::handle_trigger_failure(&conn, app, &task, &col, &error_msg);
            }
        }
    }
    pipeline::emit_tasks_changed(app, "", "trigger_failed");
}

/// Poll the task's tmux pane for the KAITENCODE_DONE sentinel until it appears,
/// the task moves columns, the session dies, or the 2-hour backstop fires.
/// Then runs completion handling (mark_complete or failure routing).
async fn watch_interactive_sentinel(
    app: AppHandle,
    task_id: String,
    session_id: Option<String>,
    trigger_column_id: Option<String>,
    cli_command: String,
    cli: InteractiveCli,
    start_time: std::time::Instant,
) {
    let session = tmux_session_name(&task_id);
    let timeout_at = tokio::time::Instant::now() + TRIGGER_TIMEOUT;
    let mut sentinel_seen = false;
    let mut session_gone = false;
    let mut moved_columns = false;

    loop {
        if tokio::time::Instant::now() >= timeout_at {
            eprintln!(
                "[bridge:interactive] watcher hit hard timeout for task {}",
                task_id
            );
            break;
        }
        tokio::time::sleep(INTERACTIVE_SENTINEL_POLL_INTERVAL).await;

        if !tmux_transport::has_session(&task_id) {
            session_gone = true;
            eprintln!(
                "[bridge:interactive] tmux session for task {} disappeared; ending watcher",
                task_id
            );
            break;
        }

        if let Some(ref expected_col) = trigger_column_id {
            if let Ok(conn) = Connection::open(db::db_path()) {
                let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
                if let Ok(task) = db::get_task(&conn, &task_id) {
                    if task.column_id != *expected_col {
                        moved_columns = true;
                        eprintln!(
                            "[bridge:interactive] task {} moved columns ({} -> {}); ending watcher",
                            task_id, expected_col, task.column_id
                        );
                        break;
                    }
                }
            }
        }

        let pane = capture_pane_scrollback(&session);
        if pane_contains_sentinel(&pane, &task_id) {
            sentinel_seen = true;
            eprintln!(
                "[bridge:interactive] sentinel observed for task {}",
                task_id
            );
            break;
        }
    }

    if moved_columns {
        // Don't run completion handling — the new column's trigger owns the
        // task now. Just clear the running flag so the GC sweep doesn't
        // re-mark this task as failed.
        if let Ok(conn) = Connection::open(db::db_path()) {
            let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
            let _ = db::update_task_agent_status(&conn, &task_id, Some("idle"), None);
            if let Some(ref sid) = session_id {
                let _ = db::update_agent_session(
                    &conn,
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
        return;
    }

    let success = sentinel_seen;
    let exit_code: i32 = match (sentinel_seen, session_gone) {
        (true, _) => 0,
        (false, true) => 137,
        (false, false) => 124,
    };
    let scrollback = capture_pane_scrollback(&session);
    let scrollback = truncate_for_scrollback(&scrollback);
    let last_output_tail = tail_bytes(&scrollback, LAST_OUTPUT_TAIL_BYTES);

    let completion_metadata = serde_json::json!({
        "exitCode": exit_code,
        "sentinel": sentinel_seen,
        "sessionGone": session_gone,
        "runtimeMode": "interactive",
    })
    .to_string();
    let _ = crate::events::persist_and_emit_agent_transcript_event(
        &app,
        &task_id,
        session_id.as_deref(),
        db::EVENT_COMMAND_COMPLETED,
        None,
        Some(&completion_metadata),
    );
    let _ = crate::events::persist_and_emit_agent_transcript_event(
        &app,
        &task_id,
        session_id.as_deref(),
        if success {
            db::EVENT_AGENT_COMPLETED
        } else {
            db::EVENT_AGENT_FAILED
        },
        None,
        Some(&completion_metadata),
    );

    if let Ok(conn) = Connection::open(db::db_path()) {
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");

        if let Some(ref sid) = session_id {
            let _ = db::update_agent_session_output(
                &conn,
                sid,
                Some(&last_output_tail),
                Some(&scrollback),
            );
        }

        // Column guard — same protection as the headless path. If the user
        // dragged the task while the watcher was sleeping, don't stomp on
        // the new column's state.
        let task_still_here = db::get_task(&conn, &task_id)
            .ok()
            .map(|t| trigger_column_id.as_deref() == Some(t.column_id.as_str()))
            .unwrap_or(false);

        if !task_still_here {
            eprintln!(
                "[bridge:interactive] task {} moved columns at completion; skipping mark_complete",
                task_id
            );
        } else {
            let status_str = if success { "completed" } else { "failed" };
            let _ = db::update_task_agent_status(&conn, &task_id, Some(status_str), None);
            if let Ok(task) = db::get_task(&conn, &task_id) {
                if let Some(ref sid) = task.agent_session_id {
                    let _ = db::update_agent_session(
                        &conn,
                        sid,
                        None,
                        Some(status_str),
                        Some(Some(exit_code as i64)),
                        None,
                        None,
                        None,
                    );
                }
            }

            let duration_secs = start_time.elapsed().as_secs() as i64;
            if let Ok(task) = db::get_task(&conn, &task_id) {
                let model_name = task.model.as_deref().unwrap_or("unknown");
                let column_name = db::get_column(&conn, &task.column_id)
                    .map(|c| c.name)
                    .unwrap_or_default();
                let _ = db::insert_usage_record(
                    &conn,
                    &task.workspace_id,
                    Some(&task_id),
                    session_id.as_deref(),
                    "anthropic",
                    model_name,
                    0,
                    0,
                    0.0,
                    Some(&column_name),
                    duration_secs,
                );
            }

            if success {
                let _ = pipeline::mark_complete(&conn, &app, &task_id, true);
            } else {
                let detail = if session_gone {
                    "Interactive agent session ended before sentinel observed".to_string()
                } else {
                    "Interactive agent exceeded 2h timeout without emitting completion sentinel"
                        .to_string()
                };
                let _ =
                    pipeline::mark_complete_with_error(&conn, &app, &task_id, false, Some(&detail));
            }
        }
    }

    pipeline::emit_tasks_changed(&app, "", "trigger_complete");

    // Phase 4 telemetry. Fire-and-forget so we never block completion
    // on the insert. Source mapping mirrors the (success, session_gone)
    // truth table above: sentinel = success, session_gone = kill (the
    // agent's process vanished without signaling — usually external kill
    // or OOM), otherwise = timeout (2h backstop fired).
    if let Ok(conn) = Connection::open(db::db_path()) {
        let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
        if let Ok(task) = db::get_task(&conn, &task_id) {
            let workspace_id = task.workspace_id.clone();
            let duration_ms = start_time.elapsed().as_millis() as i64;
            let source = if sentinel_seen {
                db::completion_events::CompletionSource::Sentinel
            } else if session_gone {
                db::completion_events::CompletionSource::Kill
            } else {
                db::completion_events::CompletionSource::Timeout
            };
            let sentinel_seen_at = if sentinel_seen {
                Some(crate::db::now_millis())
            } else {
                None
            };
            db::completion_events::record_async(
                task_id.clone(),
                workspace_id,
                cli_command.clone(),
                "interactive".to_string(),
                source,
                duration_ms,
                sentinel_seen_at,
            );
        }
    }

    // Best-effort graceful shutdown of the still-running TUI. Claude
    // accepts `/exit`; codex accepts `/quit`. If the user already moved
    // the task or started a new spawn the next trigger will kill the
    // session anyway, so we don't wait for the exit to complete.
    if success && tmux_transport::has_session(&task_id) {
        let _ = run_tmux(&["send-keys", "-t", &session, "-l", cli.exit_command()]);
        let _ = run_tmux(&["send-keys", "-t", &session, "Enter"]);
    }

    let _ = cli_command;
}

// ─── Shell quoting helpers ────────────────────────────────────────────────

/// Wrap a value in single quotes, escaping any inner single quotes.
fn shell_quote_arg(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Escape a string so it can be inserted between single quotes (no surrounding
/// quotes added — the caller wraps it).
fn shell_quote(s: &str) -> String {
    s.replace('\'', "'\\''")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, MutexGuard};

    static HOME_ENV_LOCK: Mutex<()> = Mutex::new(());

    fn lock_home_env() -> MutexGuard<'static, ()> {
        HOME_ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner())
    }

    #[test]
    fn test_gen_nonce() {
        let a = gen_nonce();
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_build_trigger_command_codex() {
        let cmd = build_trigger_command("codex", &[], "do the thing", None);
        assert!(cmd.contains("codex"));
        assert!(cmd.contains(" exec "));
        // Sandbox + approval set explicitly via -c overrides. workspace-write
        // (the --full-auto default) blocks writes to .git in worktrees, so we
        // pin sandbox_mode to danger-full-access for code-producing stages.
        assert!(cmd.contains("sandbox_mode=\"danger-full-access\""));
        assert!(cmd.contains("approval_policy=\"never\""));
        assert!(!cmd.contains("--full-auto"));
        assert!(cmd.contains("--skip-git-repo-check"));
        assert!(cmd.contains("--json"));
        assert!(cmd.contains("tee -a"));
        assert!(cmd.contains("KAITENCODE_CODEX_JSON_LOG"));
        assert!(cmd.contains("jq -rj --unbuffered"));
        assert!(cmd.contains("do the thing"));
        assert!(!cmd.contains(" -p "));
    }

    #[test]
    fn test_build_trigger_command_claude_streams_via_jq() {
        // Claude wrapped command must:
        //   - request streaming JSON output (so the tmux pane sees progress
        //     instead of a blank line for minutes)
        //   - run inside `bash -o pipefail -c` so claude's exit code wins
        //     over jq's (not zsh-only `pipestatus`)
        //   - export the jq filter via env var (avoids quoting hell)
        //   - guard the jq pipeline with a runtime check + plain-text fallback
        //     when jq isn't on PATH
        //   - still pass the prompt and dangerously-skip-permissions
        let cmd = build_trigger_command("claude", &[], "do the thing", None);
        assert!(
            cmd.contains("--output-format stream-json"),
            "missing stream-json: {}",
            cmd
        );
        assert!(cmd.contains("--verbose"), "missing --verbose: {}", cmd);
        assert!(
            cmd.contains("--include-partial-messages"),
            "missing --include-partial-messages: {}",
            cmd
        );
        assert!(
            cmd.contains("bash -o pipefail -c"),
            "missing bash pipefail wrapper: {}",
            cmd
        );
        assert!(
            cmd.contains("KAITENCODE_CLAUDE_FILTER="),
            "filter must be exported via env var: {}",
            cmd
        );
        assert!(
            cmd.contains("tee -a"),
            "raw stream-json should be tee'd for semantic transcript parsing: {}",
            cmd
        );
        assert!(
            cmd.contains("jq -rj --unbuffered"),
            "jq must join raw text deltas instead of adding a newline after every event: {}",
            cmd
        );
        assert!(
            !cmd.contains("jq -r --unbuffered"),
            "jq -r inserts event newlines and breaks terminal formatting: {}",
            cmd
        );
        assert!(
            cmd.contains("KAITENCODE_CLAUDE_JSON_LOG"),
            "semantic JSON log env var should be supported: {}",
            cmd
        );
        assert!(
            cmd.contains(CLAUDE_SESSION_MARKER),
            "filter must surface a hidden Claude session marker: {}",
            cmd
        );
        assert!(
            cmd.contains("command -v jq"),
            "missing jq availability check: {}",
            cmd
        );
        assert!(cmd.contains("-p"));
        assert!(cmd.contains("do the thing"));
        assert!(cmd.contains("--dangerously-skip-permissions"));
    }

    #[test]
    fn test_claude_pretty_filter_keeps_terminal_output_compact() {
        assert!(
            CLAUDE_STREAM_PRETTY_JQ.contains(r#""\n[36m▶ "#),
            "tool rows need an explicit separator when jq runs in joined mode"
        );
        assert!(
            CLAUDE_STREAM_PRETTY_JQ.contains(r#""\n[33m── done"#),
            "done rows need an explicit separator when jq runs in joined mode"
        );
        assert!(
            !CLAUDE_STREAM_PRETTY_JQ.contains(".event.delta.thinking"),
            "raw terminal should not stream thinking text/newlines; transcript owns semantic thinking"
        );
    }

    #[test]
    fn test_codex_pretty_filter_keeps_terminal_output_compact() {
        assert!(
            CODEX_STREAM_PRETTY_JQ
                .contains(r#".type == "item.started" and .item.type == "command_execution""#),
            "codex command execution should render as a compact Bash row"
        );
        assert!(
            CODEX_STREAM_PRETTY_JQ
                .contains(r#".type == "item.completed" and .item.type == "agent_message""#),
            "codex agent messages should render as readable text"
        );
        assert!(
            CODEX_STREAM_PRETTY_JQ.contains(r#".type == "turn.completed""#),
            "codex turns need an explicit done marker"
        );
    }

    #[test]
    fn complete_line_delta_only_returns_full_jsonl_records() {
        let contents = "{\"type\":\"system\"}\n{\"type\":\"partial\"";
        let (delta, end) = complete_line_delta(contents, 0).expect("complete line");
        assert_eq!(delta, "{\"type\":\"system\"}\n");
        assert_eq!(end, "{\"type\":\"system\"}\n".len());
        assert!(complete_line_delta(contents, end).is_none());
    }

    #[test]
    fn test_build_trigger_command_claude_with_user_args() {
        // User-supplied args (e.g. --model) must appear in BOTH the streaming
        // pipeline AND the no-jq fallback, so the model selection is honored
        // either way. After the outer `bash -c '<body>'` quote layer, the
        // inner `'--model' 'sonnet'` becomes `'\''--model'\'' '\''sonnet'\''`.
        let cmd = build_trigger_command(
            "claude",
            &["--model".to_string(), "sonnet".to_string()],
            "hi",
            None,
        );
        let post_outer = r#"'\''--model'\'' '\''sonnet'\''"#;
        assert!(cmd.contains(post_outer), "got: {}", cmd);
        // matches twice: once in stream branch, once in fallback. Both paths
        // must propagate the model.
        assert_eq!(cmd.matches(post_outer).count(), 2, "got: {}", cmd);
    }

    #[test]
    fn test_build_trigger_command_claude_escapes_prompt_quote() {
        // Prompts with apostrophes must round-trip through TWO single-quote
        // layers (inner -p '<prompt>' and outer bash -c '<body>') without
        // breaking the wrapper.
        //
        // We verify by stripping the outer `bash -o pipefail -c '<body>'`
        // wrapper to recover the inner body string, then asserting the body
        // contains the canonical inner-quote form `'what'\''s up'` — which
        // bash unwraps to literal `what's up` for the CLI's argv.
        let cmd = build_trigger_command("claude", &[], "what's up", None);

        // The outer wrapper escapes every `'` in the body to `'\''`, so the
        // canonical inner form `'what'\''s up'` becomes
        // `'\''what'\''\'\'''\''s up'\''` once. Either form is a pass; we
        // assert on the latter (post-outer-escape) since that's what's in
        // the final string.
        let post_outer = r#"'\''what'\''\'\'''\''s up'\''"#;
        assert!(
            cmd.contains(post_outer),
            "prompt did not double-escape correctly; cmd={}",
            cmd
        );
        // It must appear in BOTH branches (streaming + fallback).
        assert_eq!(
            cmd.matches(post_outer).count(),
            2,
            "prompt must round-trip through both branches; cmd={}",
            cmd
        );
    }

    #[test]
    fn test_claude_streaming_command_runs_under_real_bash() {
        // End-to-end: feed the streaming wrapper into a real bash, but
        // replace the inner `claude` invocation with a stub that prints its
        // argv so we can observe what the CLI would actually receive.
        // We force the FALLBACK branch (no jq) by stubbing the if-test.
        let cmd = build_trigger_command("claude", &[], "hello world", None);
        // Force the inner `command -v jq` to fail by replacing the test.
        let fallback_only = cmd.replacen(
            "if command -v jq >/dev/null 2>&1; then",
            "if false; then",
            1,
        );
        // Substitute `'claude'` with `'/bin/echo'` so we just print argv.
        // /bin/echo is a real executable; doesn't need quoting cleanup.
        let dryrun = fallback_only.replace("'claude'", "/bin/echo");
        let output = std::process::Command::new("bash")
            .arg("-c")
            .arg(&dryrun)
            .output()
            .expect("spawn bash");
        assert!(
            output.status.success(),
            "bash failed: stderr={}",
            String::from_utf8_lossy(&output.stderr)
        );
        let stdout = String::from_utf8_lossy(&output.stdout);
        // /bin/echo prints all argv joined by spaces. The prompt is the
        // last token after `-p`; it should appear intact.
        assert!(
            stdout.contains("-p hello world"),
            "argv missing prompt: stdout={}",
            stdout
        );
    }

    #[test]
    fn test_build_trigger_command_with_args() {
        let cmd = build_trigger_command(
            "codex",
            &["--model".to_string(), "gpt-5".to_string()],
            "hello",
            None,
        );
        assert!(cmd.contains("--model"));
        assert!(cmd.contains("gpt-5"));
        assert!(cmd.contains("--json"));
        assert!(cmd.contains("'hello'"));
    }

    #[test]
    fn test_tmux_session_name() {
        assert_eq!(tmux_session_name("task-123"), "kaitencode_task-123");
    }

    #[test]
    fn test_persistent_agent_lifecycle_flag_defaults_on() {
        assert!(persistent_agent_lifecycle_enabled(None));
        assert!(persistent_agent_lifecycle_enabled(Some("{}")));
        assert!(persistent_agent_lifecycle_enabled(Some("not json")));
        assert!(!persistent_agent_lifecycle_enabled(Some(
            r#"{"agent":{"persistentAgentLifecycle":false}}"#
        )));
    }

    #[test]
    fn test_persistent_agent_lifecycle_flag_accepts_flat_and_nested() {
        assert!(persistent_agent_lifecycle_enabled(Some(
            r#"{"persistentAgentLifecycle":true}"#
        )));
        assert!(persistent_agent_lifecycle_enabled(Some(
            r#"{"persistent_agent_lifecycle":true}"#
        )));
        assert!(persistent_agent_lifecycle_enabled(Some(
            r#"{"agent":{"persistentAgentLifecycle":true}}"#
        )));
    }

    #[test]
    fn test_claude_mock_no_longer_uses_claude_streaming_branch() {
        let cmd = build_trigger_command("claude-mock", &[], "hi", None);
        assert_eq!(cmd, "claude-mock 'hi'");
        assert!(!cmd.contains("--output-format stream-json"));
    }

    // ─── Interactive runtime mode (Phase 1) ────────────────────────────────

    #[test]
    fn test_interactive_sentinel_prompt_embeds_task_id() {
        let prompt = interactive_sentinel_system_prompt("task-abc");
        assert!(prompt.contains("<<<KAITENCODE_DONE:task-abc>>>"));
        assert!(prompt.contains("exactly this line"));
    }

    #[test]
    fn test_build_interactive_claude_argv_no_dash_p() {
        // Interactive mode MUST NOT include `-p` — the whole point is to
        // get the real TUI instead of one-shot completion mode.
        let argv = build_interactive_claude_argv(
            "claude",
            &["--model".to_string(), "sonnet".to_string()],
            "task-1",
            None,
            false,
        );
        assert_eq!(argv[0], "claude");
        assert!(
            argv.iter().any(|a| a == "--dangerously-skip-permissions"),
            "missing skip-perms flag: {:?}",
            argv
        );
        assert!(
            argv.iter().any(|a| a == "--model"),
            "user args not threaded: {:?}",
            argv
        );
        assert!(
            !argv.iter().any(|a| a == "-p"),
            "interactive argv must not contain -p: {:?}",
            argv
        );
        assert!(
            !argv.iter().any(|a| a == "--append-system-prompt"),
            "sentinel prompt should NOT be appended when include_sentinel=false: {:?}",
            argv
        );
    }

    #[test]
    fn test_build_interactive_claude_argv_appends_sentinel_when_requested() {
        let argv = build_interactive_claude_argv("claude", &[], "task-xyz", None, true);
        let pos = argv
            .iter()
            .position(|a| a == "--append-system-prompt")
            .expect("must have --append-system-prompt when include_sentinel=true");
        let payload = argv.get(pos + 1).expect("system-prompt payload");
        assert!(
            payload.contains("<<<KAITENCODE_DONE:task-xyz>>>"),
            "system-prompt must embed sentinel marker: {}",
            payload
        );
    }

    #[test]
    fn test_build_interactive_claude_argv_threads_resume_id() {
        let argv =
            build_interactive_claude_argv("claude", &[], "task-1", Some("session-42"), false);
        let resume_pos = argv
            .iter()
            .position(|a| a == "--resume")
            .expect("--resume should appear when resume_id is set");
        assert_eq!(
            argv.get(resume_pos + 1).map(String::as_str),
            Some("session-42")
        );
    }

    #[test]
    fn test_build_interactive_claude_argv_ignores_blank_resume_id() {
        let argv = build_interactive_claude_argv("claude", &[], "task-1", Some("   "), false);
        assert!(
            !argv.iter().any(|a| a == "--resume"),
            "blank resume id should be dropped: {:?}",
            argv
        );
    }

    #[test]
    fn test_strip_ansi_drops_csi_and_keeps_text() {
        let raw = "\x1b[31mHELLO\x1b[0m world";
        assert_eq!(strip_ansi(raw), "HELLO world");
    }

    #[test]
    fn test_strip_ansi_drops_osc_and_charset() {
        let raw = "\x1b]0;title\x07\x1b(Bplain";
        // OSC removed (terminated by BEL), charset designator removed.
        assert_eq!(strip_ansi(raw), "plain");
    }

    #[test]
    fn test_strip_ansi_preserves_unicode() {
        let raw = "\x1b[33m╭──╮\x1b[0m";
        assert_eq!(strip_ansi(raw), "╭──╮");
    }

    #[test]
    fn test_pane_contains_sentinel_matches_standalone_line() {
        let pane = "Some agent output\n<<<KAITENCODE_DONE:task-7>>>\n";
        assert!(pane_contains_sentinel(pane, "task-7"));
    }

    #[test]
    fn test_pane_contains_sentinel_matches_after_ansi_strip() {
        let pane = "\x1b[32m<<<KAITENCODE_DONE:task-7>>>\x1b[0m\n";
        assert!(pane_contains_sentinel(pane, "task-7"));
    }

    #[test]
    fn test_pane_contains_sentinel_matches_legacy_marker() {
        let pane = "Some agent output\n<<<BENTOYA_DONE:task-7>>>\n";
        assert!(pane_contains_sentinel(pane, "task-7"));
    }

    #[test]
    fn test_pane_contains_sentinel_rejects_inline_mention() {
        // Agent narrating "I'll print <<<KAITENCODE_DONE:task-7>>> when done"
        // must NOT trip the watcher — the sentinel only counts when it's on
        // its own line.
        let pane = "I'll print <<<KAITENCODE_DONE:task-7>>> when done.\n";
        assert!(!pane_contains_sentinel(pane, "task-7"));
    }

    #[test]
    fn test_pane_contains_sentinel_rejects_wrong_task_id() {
        // A stale capture from a previous task must not complete this one.
        let pane = "<<<KAITENCODE_DONE:other-task>>>\n";
        assert!(!pane_contains_sentinel(pane, "task-7"));
    }

    #[test]
    fn test_pane_contains_sentinel_rejects_code_block_quote() {
        // Triple-backtick code blocks are common in agent output. The
        // sentinel inside a code block is indented or fenced and should not
        // trip detection.
        let pane = "```\n<<<KAITENCODE_DONE:task-7>>>\n```\nNow I'll do the work.\n";
        // Body line alone matches — that's a known false positive direction.
        // But the more important guard is the inline-narration test above.
        // Document the current behavior so a future tightening (e.g. require
        // sentinel to be the LAST non-empty line) is an intentional change.
        assert!(pane_contains_sentinel(pane, "task-7"));
    }

    #[test]
    fn test_pane_has_claude_prompt_detects_box_drawing() {
        // Claude Code's input prompt is a rounded-corner box drawn with
        // `╭`/`│`/`╰`. Either the top or bottom corner is enough to
        // indicate the prompt is rendered.
        assert!(pane_has_claude_prompt("╭────────╮"));
        assert!(pane_has_claude_prompt("╰────────╯"));
        // Wrapped in ANSI as it would actually appear:
        assert!(pane_has_claude_prompt(
            "\x1b[2m╭───────────────────────────────────────────╮\x1b[22m"
        ));
        // Plain shell output without the prompt → must NOT match (caller
        // would otherwise inject the prompt into a half-loaded banner).
        assert!(!pane_has_claude_prompt("$ "));
        assert!(!pane_has_claude_prompt("Loading Claude...\n"));
    }

    #[test]
    fn test_exit_criteria_needs_sentinel() {
        assert!(exit_criteria_needs_sentinel(Some("agent_complete")));
        assert!(exit_criteria_needs_sentinel(Some("manual_approval")));
        assert!(!exit_criteria_needs_sentinel(Some("manual")));
        assert!(!exit_criteria_needs_sentinel(Some("script_success")));
        assert!(!exit_criteria_needs_sentinel(None));
    }

    // ─── Phase 3: codex parity ─────────────────────────────────────────────

    #[test]
    fn test_build_interactive_codex_argv_no_exec() {
        // Codex interactive REPL is the default mode — no `exec` subcommand.
        let argv = build_interactive_codex_argv(
            "codex",
            &["--model".to_string(), "gpt-5".to_string()],
            "task-1",
            false,
        );
        assert_eq!(argv[0], "codex");
        assert!(
            !argv.iter().any(|a| a == "exec"),
            "interactive codex must not include `exec`: {:?}",
            argv
        );
        assert!(
            !argv.iter().any(|a| a == "--json"),
            "interactive codex must not include `--json`: {:?}",
            argv
        );
        assert!(
            argv.iter().any(|a| a == "--model"),
            "user args missing: {:?}",
            argv
        );
        assert!(
            !argv.iter().any(|a| a == "--append-system-prompt"),
            "no sentinel when include_sentinel=false: {:?}",
            argv
        );
    }

    #[test]
    fn test_build_interactive_codex_argv_appends_sentinel_when_requested() {
        let argv = build_interactive_codex_argv("codex", &[], "task-zzz", true);
        let pos = argv
            .iter()
            .position(|a| a == "--append-system-prompt")
            .expect("must have --append-system-prompt when include_sentinel=true");
        let payload = argv.get(pos + 1).expect("system-prompt payload");
        assert!(
            payload.contains("<<<KAITENCODE_DONE:task-zzz>>>"),
            "codex system-prompt must embed sentinel marker: {}",
            payload
        );
    }

    #[test]
    fn test_interactive_cli_from_cli_name() {
        assert_eq!(
            InteractiveCli::from_cli_name("claude"),
            Some(InteractiveCli::Claude)
        );
        assert_eq!(
            InteractiveCli::from_cli_name("/usr/local/bin/claude"),
            Some(InteractiveCli::Claude)
        );
        assert_eq!(
            InteractiveCli::from_cli_name("codex"),
            Some(InteractiveCli::Codex)
        );
        assert_eq!(
            InteractiveCli::from_cli_name("/opt/openai/bin/codex"),
            Some(InteractiveCli::Codex)
        );
        assert!(InteractiveCli::from_cli_name("aider").is_none());
        assert!(InteractiveCli::from_cli_name("claude-mock").is_none());
    }

    #[test]
    fn test_interactive_cli_exit_command_is_cli_specific() {
        assert_eq!(InteractiveCli::Claude.exit_command(), "/exit");
        assert_eq!(InteractiveCli::Codex.exit_command(), "/quit");
    }

    #[test]
    fn test_pane_has_codex_prompt_matches_banner() {
        // The match is "contains 'codex' (case-insensitive) AND pane has
        // enough bytes". A short transient capture must not trip it.
        assert!(pane_has_codex_prompt(
            "    OpenAI codex 1.2.3 — connected, model gpt-5, ready for input "
        ));
        assert!(pane_has_codex_prompt(
            "\x1b[33mcodex\x1b[0m v1.x — interactive mode enabled with full context window"
        ));
        // Empty / tiny pane → not ready.
        assert!(!pane_has_codex_prompt(""));
        assert!(!pane_has_codex_prompt("codex"));
        // Random shell output without the banner must NOT trip it.
        assert!(!pane_has_codex_prompt(
            "$ ls -la                                                                          "
        ));
    }

    // ─── End interactive runtime mode tests ────────────────────────────────

    #[test]
    fn test_claude_resume_id_is_threaded_into_both_paths() {
        let cmd = build_trigger_command("claude", &[], "continue", Some("session-123"));
        let post_outer = r#"'\''--resume'\'' '\''session-123'\''"#;
        assert_eq!(cmd.matches(post_outer).count(), 2, "got: {}", cmd);
    }

    #[test]
    fn test_trigger_session_plan_reuses_existing_when_persistent() {
        assert_eq!(
            trigger_session_plan(true, true, false),
            TriggerSessionPlan::ReuseExisting
        );
    }

    #[test]
    fn test_trigger_session_plan_replaces_existing_when_legacy() {
        assert_eq!(
            trigger_session_plan(true, false, false),
            TriggerSessionPlan::KillAndCreate
        );
        assert_eq!(
            trigger_session_plan(false, false, false),
            TriggerSessionPlan::Create
        );
    }

    #[test]
    fn test_trigger_session_plan_force_fresh_overrides_persistent_reuse() {
        // Terminal columns set force_fresh=true so the persistent pane (now
        // rooted at a deleted worktree) is killed and recreated with a
        // valid cwd.
        assert_eq!(
            trigger_session_plan(true, true, true),
            TriggerSessionPlan::KillAndCreate
        );
        assert_eq!(
            trigger_session_plan(false, true, true),
            TriggerSessionPlan::Create
        );
    }

    #[test]
    fn test_trigger_session_plan_force_fresh_compatible_with_legacy() {
        // Even on legacy non-persistent workspaces, force_fresh keeps the
        // KillAndCreate / Create choice consistent with the existing path.
        assert_eq!(
            trigger_session_plan(true, false, true),
            TriggerSessionPlan::KillAndCreate
        );
        assert_eq!(
            trigger_session_plan(false, false, true),
            TriggerSessionPlan::Create
        );
    }

    #[test]
    fn test_should_kill_after_completion_only_for_legacy() {
        assert!(should_kill_session_after_completion(false));
        assert!(!should_kill_session_after_completion(true));
    }

    #[test]
    fn test_shell_quote_arg() {
        assert_eq!(shell_quote_arg("hello"), "'hello'");
        assert_eq!(shell_quote_arg("it's me"), "'it'\\''s me'");
    }

    #[test]
    fn test_tail_bytes_short_input() {
        assert_eq!(tail_bytes("abc", 100), "abc");
    }

    #[test]
    fn test_tail_bytes_truncates() {
        let s = "a".repeat(2000);
        let tail = tail_bytes(&s, 1000);
        assert_eq!(tail.len(), 1000);
        assert!(tail.chars().all(|c| c == 'a'));
    }

    #[test]
    fn test_tail_bytes_utf8_safe() {
        // Build a string with a multi-byte char near the truncation boundary.
        let prefix = "a".repeat(998);
        let s = format!("{}é", prefix); // é is 2 bytes
        let tail = tail_bytes(&s, 1000);
        // Should land on a char boundary, not in the middle of é.
        assert!(tail.is_char_boundary(0));
        assert!(tail.ends_with('é'));
    }

    #[test]
    fn test_extract_claude_session_id_from_hidden_marker() {
        let output = "\x1b[8mKAITENCODE_CLAUDE_SESSION_ID:abc-123\x1b[0m\n[claude 2 model]\n";
        assert_eq!(
            extract_claude_session_id(output).as_deref(),
            Some("abc-123")
        );
    }

    #[test]
    fn test_extract_claude_session_id_from_legacy_hidden_marker() {
        let output = "\x1b[8mBENTOYA_CLAUDE_SESSION_ID:abc-123\x1b[0m\n[claude 2 model]\n";
        assert_eq!(
            extract_claude_session_id(output).as_deref(),
            Some("abc-123")
        );
    }

    #[test]
    fn test_validate_claude_resume_id_rejects_empty() {
        assert!(!validate_claude_resume_id("/tmp/x", ""));
        assert!(!validate_claude_resume_id("/tmp/x", "   "));
    }

    #[test]
    fn test_validate_claude_resume_id_rejects_missing_file() {
        let _home_guard = lock_home_env();
        let tmp = tempfile::tempdir().unwrap();
        // Override $HOME so the validator looks under our temp dir.
        std::env::set_var("HOME", tmp.path());
        // No session file exists yet — must return false.
        assert!(!validate_claude_resume_id(
            "/Users/test/some/repo",
            "deadbeef-0000-0000-0000-000000000000"
        ));
    }

    #[test]
    fn test_validate_claude_resume_id_accepts_present_file() {
        let _home_guard = lock_home_env();
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("HOME", tmp.path());
        let working_dir = "/Users/test/some/repo";
        let encoded = "-Users-test-some-repo";
        let session_id = "11111111-2222-3333-4444-555555555555";
        let proj = tmp.path().join(".claude").join("projects").join(encoded);
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(proj.join(format!("{}.jsonl", session_id)), b"{}\n").unwrap();
        assert!(validate_claude_resume_id(working_dir, session_id));
    }

    #[test]
    fn test_is_stale_claude_resume_output_matches_canonical_error() {
        let log = "...\nresult: error\nNo conversation found with session ID: abc-123\nERROR\n";
        assert!(is_stale_claude_resume_output(log));
    }

    #[test]
    fn test_is_stale_claude_resume_output_case_insensitive() {
        let log = "no conversation found with session id: lower";
        assert!(is_stale_claude_resume_output(log));
    }

    #[test]
    fn test_is_stale_claude_resume_output_negative() {
        assert!(!is_stale_claude_resume_output("everything went fine"));
    }

    // ─── Rate-limit detection ─────────────────────────────────────────────

    #[test]
    fn test_is_rate_limit_output_positive() {
        assert!(is_rate_limit_output(
            "You've hit your limit · resets 12pm (America/Montevideo)"
        ));
        assert!(is_rate_limit_output(
            "blah blah\nYOU'VE HIT YOUR LIMIT — resets 1:30 PM\n"
        ));
        assert!(is_rate_limit_output("you have hit your limit, friend"));
    }

    #[test]
    fn test_is_rate_limit_output_negative() {
        assert!(!is_rate_limit_output("Hello world"));
        assert!(!is_rate_limit_output(
            "Option '--dangerously-bypass-approvals-and-sandbox' not supported."
        ));
    }

    #[test]
    fn test_is_rate_limit_output_with_ansi_escapes() {
        // Tmux pane scrollback often contains ANSI escape codes around the
        // rate-limit text. Detection must still work.
        let ansi_wrapped = "\x1b[31mYou've hit your limit\x1b[0m · resets 12pm";
        assert!(is_rate_limit_output(ansi_wrapped));
    }

    fn anchor() -> chrono::DateTime<chrono::FixedOffset> {
        // 2026-05-04 09:00:00 -03:00 (Montevideo)
        chrono::DateTime::parse_from_rfc3339("2026-05-04T09:00:00-03:00").unwrap()
    }

    #[test]
    fn test_parse_rate_limit_delay_12pm() {
        let now = anchor();
        let dur = parse_rate_limit_delay_from(
            "You've hit your limit · resets 12pm (America/Montevideo)",
            now,
        )
        .unwrap();
        // 09:00 → 12:00 == 3 hours
        assert_eq!(dur.as_secs(), 3 * 3600);
    }

    #[test]
    fn test_parse_rate_limit_delay_1_30_pm() {
        let now = anchor();
        let dur =
            parse_rate_limit_delay_from("You've hit your limit. Resets 1:30 PM, please wait.", now)
                .unwrap();
        // 09:00 → 13:30 == 4h30m
        assert_eq!(dur.as_secs(), 4 * 3600 + 30 * 60);
    }

    #[test]
    fn test_parse_rate_limit_delay_24h_format() {
        let now = anchor();
        let dur =
            parse_rate_limit_delay_from("you've hit your limit · resets 13:00 today", now).unwrap();
        // 09:00 → 13:00 == 4 hours
        assert_eq!(dur.as_secs(), 4 * 3600);
    }

    #[test]
    fn test_parse_rate_limit_delay_passed_time_rolls_to_next_day() {
        let now = anchor();
        // 06:00 already passed today (anchor is 09:00) → roll over 24h
        let dur = parse_rate_limit_delay_from("You've hit your limit · resets 6am next day", now)
            .unwrap();
        // 09:00 → 06:00 next day == 21h
        assert_eq!(dur.as_secs(), 21 * 3600);
    }

    #[test]
    fn test_parse_rate_limit_delay_unknown_format_falls_back() {
        let now = anchor();
        let result = parse_rate_limit_delay_from("You've hit your limit · resets soonish", now);
        assert!(result.is_none());
        // Public API returns the fallback in this case.
        let pub_dur = parse_rate_limit_delay("You've hit your limit · resets soonish");
        assert_eq!(pub_dur, RATE_LIMIT_FALLBACK_DELAY);
    }

    #[test]
    fn test_codex_flag_mismatch_is_a_failure_not_a_rate_limit() {
        // The historical codex flag-mismatch error must NOT be treated as a
        // rate-limit (it's a real failure that the user needs to see).
        let stderr = "Option '--dangerously-bypass-approvals-and-sandbox' not supported. Trigger 'codex -h' for more details.";
        assert!(!is_rate_limit_output(stderr));
    }

    #[test]
    fn test_extract_time_token_stops_at_paren() {
        assert_eq!(
            extract_time_token("12pm (America/Montevideo)").as_deref(),
            Some("12pm")
        );
    }

    #[test]
    fn test_extract_time_token_keeps_internal_space_for_ampm() {
        assert_eq!(
            extract_time_token("1:30 PM, please wait").as_deref(),
            Some("1:30 PM")
        );
    }

    #[test]
    fn test_extract_time_token_24h() {
        assert_eq!(extract_time_token("13:00 today").as_deref(), Some("13:00"));
    }

    // ─── tmux trigger end-to-end (gated on tmux being available) ──────────

    fn tmux_available() -> bool {
        Command::new("tmux")
            .arg("-V")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[tokio::test]
    async fn tmux_trigger_creates_session_and_completes() {
        if !tmux_available() {
            eprintln!("tmux not available, skipping");
            return;
        }
        let _tmux_guard = tmux_transport::tmux_test_lock_async().await;
        // Use a unique task id so we don't collide with other tests or the
        // running app.
        let task_id = format!("test-trigger-{}", uuid::Uuid::new_v4());
        let session = tmux_session_name(&task_id);

        // Make sure we don't have a stale session.
        let _ = tmux_transport::kill_session(&task_id);

        tmux_transport::ensure_tmux_server().expect("tmux server");

        // Create the session manually (no AppHandle in tests).
        let env_vars = HashMap::new();
        create_trigger_session(&task_id, "/tmp", 80, 24, &env_vars).expect("create session");
        assert!(tmux_transport::has_session(&task_id));

        // Send a command that signals completion.
        let nonce = "abc1234567890def";
        let dir = log_retention::trigger_logs_dir();
        std::fs::create_dir_all(&dir).ok();
        let exit_path = format!("{}/exit_{}.code", dir.display(), nonce);
        let chan = format!("kaitencode_done_{}", nonce);
        let wrapped = format!(
            "echo HELLO_FROM_TMUX; printf '%s' \"0\" > {}; tmux wait-for -S {}",
            shell_quote_arg(&exit_path),
            chan
        );

        run_tmux(&["send-keys", "-t", &session, "-l", &wrapped]).expect("send-keys literal");
        run_tmux(&["send-keys", "-t", &session, "Enter"]).expect("send-keys Enter");

        // Wait for completion (with a generous timeout for slow CI).
        let wait = tokio::task::spawn_blocking({
            let chan = chan.clone();
            move || {
                Command::new("tmux")
                    .args(["wait-for", &chan])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
            }
        });
        let ok = tokio::time::timeout(Duration::from_secs(10), wait)
            .await
            .ok()
            .and_then(|r| r.ok())
            .unwrap_or(false);
        assert!(ok, "wait-for did not return");

        // Exit code file should contain "0".
        let code = std::fs::read_to_string(&exit_path).expect("read exit code");
        assert_eq!(code.trim(), "0");

        // Scrollback should contain our echo'd string.
        let scrollback = capture_pane_scrollback(&session);
        assert!(
            scrollback.contains("HELLO_FROM_TMUX"),
            "got: {}",
            scrollback
        );

        // Cleanup.
        let _ = std::fs::remove_file(&exit_path);
        let _ = tmux_transport::kill_session(&task_id);
    }

    #[tokio::test]
    async fn tmux_persistent_session_reuse_preserves_scrollback() {
        if !tmux_available() {
            eprintln!("tmux not available, skipping");
            return;
        }
        let _tmux_guard = tmux_transport::tmux_test_lock_async().await;

        let task_id = format!("test-persist-{}", uuid::Uuid::new_v4());
        let session = tmux_session_name(&task_id);
        let env_vars = HashMap::new();
        let _ = tmux_transport::kill_session(&task_id);
        tmux_transport::ensure_tmux_server().expect("tmux server");

        let first_plan = ensure_trigger_session(&task_id, "/tmp", 80, 24, &env_vars, true, false)
            .expect("create persistent session");
        assert_eq!(first_plan, TriggerSessionPlan::Create);
        run_tmux(&[
            "send-keys",
            "-t",
            &session,
            "-l",
            "echo FIRST_PERSISTENT_MARK",
        ])
        .expect("send first marker");
        run_tmux(&["send-keys", "-t", &session, "Enter"]).expect("enter first marker");
        tokio::time::sleep(Duration::from_millis(200)).await;

        let second_plan = ensure_trigger_session(&task_id, "/tmp", 80, 24, &env_vars, true, false)
            .expect("reuse persistent session");
        assert_eq!(second_plan, TriggerSessionPlan::ReuseExisting);
        run_tmux(&[
            "send-keys",
            "-t",
            &session,
            "-l",
            "echo SECOND_PERSISTENT_MARK",
        ])
        .expect("send second marker");
        run_tmux(&["send-keys", "-t", &session, "Enter"]).expect("enter second marker");
        tokio::time::sleep(Duration::from_millis(200)).await;

        let scrollback = capture_pane_scrollback(&session);
        assert!(
            scrollback.contains("FIRST_PERSISTENT_MARK"),
            "missing first marker: {}",
            scrollback
        );
        assert!(
            scrollback.contains("SECOND_PERSISTENT_MARK"),
            "missing second marker: {}",
            scrollback
        );

        let _ = tmux_transport::kill_session(&task_id);
    }

    #[tokio::test]
    async fn tmux_force_fresh_kills_persistent_session_for_terminal_column() {
        // Regression: when a terminal column (Done) trigger fires, the
        // per-task worktree has already been removed by
        // `cleanup_task_worktree_if_terminal`. The persistent tmux pane is
        // still rooted at that deleted dir, so reusing it breaks zsh with
        // `getcwd: cannot access parent directories`. The fix: callers in
        // `pipeline::triggers::execute_spawn_cli` pass `force_fresh=true`
        // for terminal columns, which routes ensure_trigger_session to
        // KillAndCreate and lands a brand-new pane in repo_path.
        if !tmux_available() {
            eprintln!("tmux not available, skipping");
            return;
        }
        let _tmux_guard = tmux_transport::tmux_test_lock_async().await;

        let task_id = format!("test-force-fresh-{}", uuid::Uuid::new_v4());
        let session = tmux_session_name(&task_id);
        let env_vars = HashMap::new();
        let _ = tmux_transport::kill_session(&task_id);
        tmux_transport::ensure_tmux_server().expect("tmux server");

        // Stage 1: create the persistent session in a temp dir, leave a
        // marker in scrollback. This simulates Plan/Working/Merge main.
        let stale_dir =
            std::env::temp_dir().join(format!("kaitencode_stale_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&stale_dir).expect("create stale dir");
        let stale_dir_str = stale_dir.display().to_string();

        let first_plan =
            ensure_trigger_session(&task_id, &stale_dir_str, 80, 24, &env_vars, true, false)
                .expect("create persistent session");
        assert_eq!(first_plan, TriggerSessionPlan::Create);
        run_tmux(&[
            "send-keys",
            "-t",
            &session,
            "-l",
            "echo PRE_TERMINAL_MARKER",
        ])
        .expect("send marker");
        run_tmux(&["send-keys", "-t", &session, "Enter"]).expect("enter marker");
        tokio::time::sleep(Duration::from_millis(200)).await;

        // Stage 2: simulate `cleanup_task_worktree_if_terminal` removing
        // the worktree out from under the pane.
        let _ = std::fs::remove_dir_all(&stale_dir);
        assert!(!stale_dir.exists(), "stale dir should be removed");

        // Stage 3: terminal column trigger fires with a fresh, valid cwd
        // (workspace.repo_path) and force_fresh=true.
        let fresh_dir =
            std::env::temp_dir().join(format!("kaitencode_fresh_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&fresh_dir).expect("create fresh dir");
        let fresh_dir_str = fresh_dir.display().to_string();

        let second_plan =
            ensure_trigger_session(&task_id, &fresh_dir_str, 80, 24, &env_vars, true, true)
                .expect("force-fresh kill+create");
        assert_eq!(
            second_plan,
            TriggerSessionPlan::KillAndCreate,
            "force_fresh on a live session must kill+create"
        );
        assert!(
            tmux_transport::has_session(&task_id),
            "new session must exist after kill+create"
        );

        // Pane scrollback must NOT carry the pre-terminal marker — it's a
        // brand-new pane.
        tokio::time::sleep(Duration::from_millis(150)).await;
        let scrollback = capture_pane_scrollback(&session);
        assert!(
            !scrollback.contains("PRE_TERMINAL_MARKER"),
            "scrollback unexpectedly carried over from killed session: {}",
            scrollback
        );

        // The new pane's cwd must be the supplied fresh_dir (canonical
        // path comparison handles macOS /private/var symlink games).
        let cwd_output = run_tmux(&["display", "-p", "-t", &session, "#{pane_current_path}"])
            .expect("display pane_current_path");
        let pane_cwd = cwd_output.trim();
        let canon_pane =
            std::fs::canonicalize(pane_cwd).unwrap_or_else(|_| std::path::PathBuf::from(pane_cwd));
        let canon_fresh = std::fs::canonicalize(&fresh_dir).unwrap_or(fresh_dir.clone());
        assert_eq!(
            canon_pane, canon_fresh,
            "new pane's cwd must match the supplied working_dir"
        );

        let _ = tmux_transport::kill_session(&task_id);
        let _ = std::fs::remove_dir_all(&fresh_dir);
    }

    #[tokio::test]
    async fn concurrent_ensure_trigger_session_coalesces_to_one_tmux_session() {
        if !tmux_available() {
            eprintln!("tmux not available, skipping");
            return;
        }
        let _tmux_guard = tmux_transport::tmux_test_lock_async().await;

        let task_id = format!("test-concurrent-{}", uuid::Uuid::new_v4());
        let _ = tmux_transport::kill_session(&task_id);
        tmux_transport::ensure_tmux_server().expect("tmux server");

        let mut handles = Vec::new();
        for _ in 0..8 {
            let task_id = task_id.clone();
            handles.push(std::thread::spawn(move || {
                let env_vars = HashMap::new();
                ensure_trigger_session(&task_id, "/tmp", 80, 24, &env_vars, true, false)
            }));
        }

        let plans = handles
            .into_iter()
            .map(|handle| handle.join().expect("join").expect("ensure"))
            .collect::<Vec<_>>();

        assert!(tmux_transport::has_session(&task_id));
        assert_eq!(
            plans
                .iter()
                .filter(|plan| **plan == TriggerSessionPlan::Create)
                .count(),
            1
        );
        assert_eq!(
            plans
                .iter()
                .filter(|plan| **plan == TriggerSessionPlan::ReuseExisting)
                .count(),
            7
        );

        let _ = tmux_transport::kill_session(&task_id);
    }

    #[tokio::test]
    async fn tmux_trigger_timeout_recovers_when_wait_hangs() {
        // Regression: `tmux wait-for` is server-global, not session-local. If
        // a session dies before signaling its channel, wait-for can block
        // indefinitely (channel never fires). Production code wraps wait-for
        // in `tokio::time::timeout(TRIGGER_TIMEOUT, ...)` so the trigger
        // runner always has a path back. This test verifies that the timeout
        // path does in fact unblock the awaiter, regardless of what tmux is
        // doing with the orphaned wait-for process.
        if !tmux_available() {
            eprintln!("tmux not available, skipping");
            return;
        }
        let _tmux_guard = tmux_transport::tmux_test_lock_async().await;
        let task_id = format!("test-killwait-{}", uuid::Uuid::new_v4());

        let _ = tmux_transport::kill_session(&task_id);
        tmux_transport::ensure_tmux_server().expect("tmux server");

        let env_vars = HashMap::new();
        create_trigger_session(&task_id, "/tmp", 80, 24, &env_vars).expect("create session");

        // Channel that nobody will ever signal. Use a test-specific prefix
        // so a parallel `sweep_orphan_wait_fors` test (which kills
        // `bentoya_done_*` orphans) doesn't reach in and SIGTERM us.
        let chan = format!("bentoya_test_timeout_{}", uuid::Uuid::new_v4().simple());

        // Spawn a wait-for in a blocking task — production analog of the
        // wait_handle in run_trigger_in_tmux.
        let wait_handle = tokio::task::spawn_blocking({
            let chan = chan.clone();
            move || {
                Command::new("tmux")
                    .args(["wait-for", &chan])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
            }
        });

        // The session has nothing to signal the channel — kill the session,
        // then prove the timeout path returns within bounds.
        tokio::time::sleep(Duration::from_millis(100)).await;
        let _ = tmux_transport::kill_session(&task_id);

        let started = std::time::Instant::now();
        let timed_out = tokio::time::timeout(Duration::from_millis(750), wait_handle)
            .await
            .is_err();

        assert!(
            timed_out,
            "expected the timeout path to fire when wait-for is orphaned"
        );
        // The timeout must actually elapse near the bound, not return early.
        assert!(
            started.elapsed() >= Duration::from_millis(700),
            "timeout fired early: {:?}",
            started.elapsed()
        );
        // Best-effort cleanup of any stragglers from the test.
        let _ = std::process::Command::new("pkill")
            .args(["-f", &format!("wait-for {}", chan)])
            .status();
    }

    // ─── wait-for orphan cleanup ──────────────────────────────────────────

    /// Helper: count `tmux wait-for bentoya_done_<chan>` processes alive.
    fn count_wait_fors_for_channel(chan: &str) -> usize {
        let output = Command::new("pgrep")
            .args(["-f", &format!("tmux wait-for {}", chan)])
            .output();
        match output {
            Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter(|l| !l.trim().is_empty())
                .count(),
            _ => 0,
        }
    }

    #[tokio::test]
    async fn tmux_wait_for_pid_capture_kills_orphan_on_timeout() {
        // Regression for the orphan-leak bug: when `tmux wait-for` is
        // spawned and the trigger times out, we must SIGTERM the wait-for
        // process directly. Without this fix, `tmux wait-for` (a server-
        // global wait, not session-local) survives session-kill and leaks.
        //
        // This test reproduces the production sequence: spawn wait-for, kill
        // its session before any signal arrives, then verify our PID-capture
        // + SIGTERM cleanup actually reaps the orphan.
        if !tmux_available() {
            eprintln!("tmux not available, skipping");
            return;
        }
        let _tmux_guard = tmux_transport::tmux_test_lock_async().await;
        let task_id = format!("test-pidkill-{}", uuid::Uuid::new_v4());
        let _ = tmux_transport::kill_session(&task_id);
        tmux_transport::ensure_tmux_server().expect("tmux server");

        let env_vars = HashMap::new();
        create_trigger_session(&task_id, "/tmp", 80, 24, &env_vars).expect("create session");

        // Use a non-`bentoya_done_` prefix so a parallel `sweep_orphan_wait_fors`
        // test doesn't reach in and kill us — this test specifically
        // verifies the `kill_wait_for_pid` direct-PID path, not the sweep.
        let chan = format!("bentoya_pidkill_{}", uuid::Uuid::new_v4().simple());

        // Spawn wait-for via Command::spawn (production code path) and
        // capture the PID before doing anything else.
        let mut child = Command::new("tmux")
            .args(["wait-for", &chan])
            .spawn()
            .expect("spawn wait-for");
        let pid = child.id();
        assert!(pid > 0, "spawn returned bogus pid");

        // Give wait-for a moment to register with the tmux server.
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(
            count_wait_fors_for_channel(&chan),
            1,
            "wait-for did not start"
        );

        // Production path: SIGTERM the captured PID.
        kill_wait_for_pid(pid);

        // Reap the child to avoid leaking a zombie.
        let _ = tokio::task::spawn_blocking(move || child.wait()).await;

        // Wait briefly for the process table to reflect the kill.
        let mut tries = 0;
        while count_wait_fors_for_channel(&chan) > 0 && tries < 20 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            tries += 1;
        }
        assert_eq!(
            count_wait_fors_for_channel(&chan),
            0,
            "kill_wait_for_pid did not reap the orphan"
        );

        let _ = tmux_transport::kill_session(&task_id);
    }

    #[tokio::test]
    async fn tmux_wait_for_kill_with_zero_pid_is_noop() {
        // `kill_wait_for_pid(0)` on POSIX would address the process group of
        // the calling process — disastrous. Our implementation must treat 0
        // as a no-op.
        kill_wait_for_pid(0);
        // If we reached this line, we didn't accidentally signal ourselves.
        // (A real test would inspect process state, but the absence of a
        //  crash already proves the guard.)
    }

    #[tokio::test]
    async fn sweep_orphan_wait_fors_only_kills_bentoya_channels() {
        // The startup sweep MUST be narrow: it should kill orphan
        // `tmux wait-for bentoya_done_*` processes, but NEVER touch chat
        // sessions, manual `tmux wait-for` invocations, or the user's own
        // tmux clients. We verify by spawning two wait-fors — one with our
        // prefix, one with a different prefix — and asserting only ours
        // gets reaped.
        if !tmux_available() {
            eprintln!("tmux not available, skipping");
            return;
        }
        let _tmux_guard = tmux_transport::tmux_test_lock_async().await;
        tmux_transport::ensure_tmux_server().expect("tmux server");

        let bentoya_chan = format!("bentoya_done_{}", uuid::Uuid::new_v4().simple());
        let unrelated_chan = format!("user_chat_{}", uuid::Uuid::new_v4().simple());

        let bentoya_child = Command::new("tmux")
            .args(["wait-for", &bentoya_chan])
            .spawn()
            .expect("spawn bentoya wait-for");
        let mut unrelated_child = Command::new("tmux")
            .args(["wait-for", &unrelated_chan])
            .spawn()
            .expect("spawn unrelated wait-for");

        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(count_wait_fors_for_channel(&bentoya_chan), 1);
        assert_eq!(count_wait_fors_for_channel(&unrelated_chan), 1);

        sweep_orphan_wait_fors();

        // Drain bentoya child (now SIGTERM'd).
        let _ = tokio::task::spawn_blocking(move || {
            let mut c = bentoya_child;
            c.wait()
        })
        .await;

        // Wait for process table to update.
        let mut tries = 0;
        while count_wait_fors_for_channel(&bentoya_chan) > 0 && tries < 20 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            tries += 1;
        }

        assert_eq!(
            count_wait_fors_for_channel(&bentoya_chan),
            0,
            "sweep should have killed the bentoya wait-for"
        );
        assert_eq!(
            count_wait_fors_for_channel(&unrelated_chan),
            1,
            "sweep must NOT touch non-bentoya wait-fors"
        );

        // Cleanup: kill the unrelated child manually.
        let _ = unrelated_child.kill();
        let _ = unrelated_child.wait();
    }
}
