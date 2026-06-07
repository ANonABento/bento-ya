//! Best-effort Discord notifications for the MVP: task → thread + output.
//!
//! Everything here is fire-and-forget and heavily guarded — a no-op unless
//! Discord is enabled, the managed bridge is running, and a thread channel is
//! configured. It must never block or fail agent execution, so call sites
//! should `tauri::async_runtime::spawn` these and ignore the result.

use rusqlite::Connection;
use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::config::AppSettings;
use crate::db;
use crate::discord::SharedDiscord;

/// Stay comfortably under Discord's 2000-char message limit (leaving room for a
/// code-fence wrapper). Mirrors choomfie's `MAX_REPLY_CHARS`.
const MAX_DISCORD_CHARS: usize = 1900;

/// Split text into <=MAX_DISCORD_CHARS pieces, preferring to break on line
/// boundaries (and hard-splitting any single over-long line on a char
/// boundary). Mirrors choomfie's `chunkMessage`.
pub fn chunk_message(text: &str) -> Vec<String> {
    let text = text.trim_end();
    if text.is_empty() {
        return Vec::new();
    }
    let mut chunks: Vec<String> = Vec::new();
    let mut cur = String::new();
    for line in text.split_inclusive('\n') {
        if line.len() > MAX_DISCORD_CHARS {
            if !cur.is_empty() {
                chunks.push(std::mem::take(&mut cur));
            }
            let mut rest = line;
            while rest.len() > MAX_DISCORD_CHARS {
                let cut = floor_char_boundary(rest, MAX_DISCORD_CHARS);
                chunks.push(rest[..cut].to_string());
                rest = &rest[cut..];
            }
            cur.push_str(rest);
        } else if cur.len() + line.len() > MAX_DISCORD_CHARS {
            chunks.push(std::mem::take(&mut cur));
            cur.push_str(line);
        } else {
            cur.push_str(line);
        }
    }
    if !cur.is_empty() {
        chunks.push(cur);
    }
    chunks
}

fn floor_char_boundary(s: &str, n: usize) -> usize {
    if n >= s.len() {
        return s.len();
    }
    let mut i = n;
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}

/// Open a short-lived DB connection and run `f`, swallowing errors.
fn with_conn<T>(f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Option<T> {
    let conn = Connection::open(db::db_path()).ok()?;
    let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
    f(&conn).ok()
}

fn channel_if_enabled() -> Option<String> {
    let s = AppSettings::load();
    if !s.discord_enabled {
        return None;
    }
    let ch = s.discord_thread_channel_id.trim().to_string();
    if ch.is_empty() {
        None
    } else {
        Some(ch)
    }
}

fn task_title(task_id: &str) -> String {
    with_conn(|c| db::get_task(c, task_id))
        .map(|t| t.title)
        .unwrap_or_else(|| task_id.to_string())
}

/// Create the thread for a task (idempotent) and announce that the agent
/// started. No-op when Discord isn't configured/running.
pub async fn on_task_started(app: &AppHandle, task_id: &str) {
    let Some(channel) = channel_if_enabled() else {
        return;
    };
    if let Some(Some(_)) = with_conn(|c| db::get_discord_thread(c, task_id)) {
        return; // already mirrored
    }
    let title = task_title(task_id);
    let title = title.as_str();
    let state = app.state::<SharedDiscord>();
    let guard = state.lock().await;
    let Some(bridge) = guard.as_ref() else {
        return;
    };
    match bridge
        .send_command(
            "create_thread",
            json!({ "channelId": channel, "name": format!("▸ {}", truncate(title, 90)) }),
        )
        .await
    {
        Ok(data) => {
            if let Some(thread_id) = data.get("threadId").and_then(|v| v.as_str()) {
                let _ = with_conn(|c| db::upsert_discord_thread(c, task_id, thread_id, &channel));
                let _ = bridge
                    .send_command(
                        "post_message",
                        json!({ "threadId": thread_id, "content": format!("**{title}** — agent started.") }),
                    )
                    .await;
            }
        }
        Err(e) => log::warn!("[discord] create_thread failed for {task_id}: {e}"),
    }
}

/// Post the agent's output tail (chunked) + a completion status into the task's
/// thread. Creates the thread first if the start hook didn't run.
pub async fn on_task_finished(app: &AppHandle, task_id: &str, success: bool, output_tail: &str) {
    let Some(channel) = channel_if_enabled() else {
        return;
    };
    let title = task_title(task_id);
    let title = title.as_str();
    let state = app.state::<SharedDiscord>();
    let guard = state.lock().await;
    let Some(bridge) = guard.as_ref() else {
        return;
    };

    // Ensure a thread exists.
    let thread_id = match with_conn(|c| db::get_discord_thread(c, task_id)) {
        Some(Some(t)) => t.thread_id,
        _ => match bridge
            .send_command(
                "create_thread",
                json!({ "channelId": channel, "name": format!("▸ {}", truncate(title, 90)) }),
            )
            .await
        {
            Ok(data) => match data.get("threadId").and_then(|v| v.as_str()) {
                Some(tid) if !tid.is_empty() => {
                    let _ = with_conn(|c| db::upsert_discord_thread(c, task_id, tid, &channel));
                    tid.to_string()
                }
                _ => return,
            },
            Err(e) => {
                log::warn!("[discord] create_thread (finish) failed for {task_id}: {e}");
                return;
            }
        },
    };

    // Output tail (ANSI-stripped) inside code fences, chunked.
    let tail = crate::chat::bridge::strip_ansi(output_tail);
    let tail = tail.trim();
    if !tail.is_empty() {
        for chunk in chunk_message(tail) {
            let _ = bridge
                .send_command(
                    "post_message",
                    json!({ "threadId": thread_id, "content": format!("```\n{chunk}\n```") }),
                )
                .await;
        }
    }

    let status = if success { "✅ completed" } else { "❌ failed" };
    let _ = bridge
        .send_command(
            "post_message",
            json!({ "threadId": thread_id, "content": format!("**{title}** — {status}") }),
        )
        .await;
}

#[cfg(test)]
mod tests {
    use super::{chunk_message, MAX_DISCORD_CHARS};

    #[test]
    fn short_text_is_a_single_chunk() {
        assert_eq!(chunk_message("hello world"), vec!["hello world"]);
    }

    #[test]
    fn whitespace_only_is_no_chunks() {
        assert!(chunk_message("   \n  ").is_empty());
    }

    #[test]
    fn long_multiline_splits_and_each_chunk_is_under_the_limit() {
        let line = "x".repeat(100);
        let text = vec![line; 60].join("\n"); // ~6k chars across many lines
        let chunks = chunk_message(&text);
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|c| c.len() <= MAX_DISCORD_CHARS));
    }

    #[test]
    fn an_over_long_single_line_is_hard_split_losslessly() {
        let text = "y".repeat(5000);
        let chunks = chunk_message(&text);
        assert!(chunks.iter().all(|c| c.len() <= MAX_DISCORD_CHARS));
        assert_eq!(chunks.concat(), text);
    }
}
