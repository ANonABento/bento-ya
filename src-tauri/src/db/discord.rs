//! Discord MVP — task ↔ thread mapping (table `discord_task_threads`).

use rusqlite::{params, Connection, OptionalExtension, Result as SqlResult};

/// The Discord thread mirroring a task.
#[derive(Debug, Clone)]
pub struct DiscordTaskThread {
    pub thread_id: String,
    pub channel_id: String,
}

/// Record (or replace) the thread a task is mirrored to.
pub fn upsert_discord_thread(
    conn: &Connection,
    task_id: &str,
    thread_id: &str,
    channel_id: &str,
) -> SqlResult<()> {
    conn.execute(
        "INSERT INTO discord_task_threads (task_id, thread_id, channel_id) \
         VALUES (?1, ?2, ?3) \
         ON CONFLICT(task_id) DO UPDATE SET thread_id = excluded.thread_id, \
             channel_id = excluded.channel_id",
        params![task_id, thread_id, channel_id],
    )?;
    Ok(())
}

/// Look up the thread mapped to a task, if any.
pub fn get_discord_thread(conn: &Connection, task_id: &str) -> SqlResult<Option<DiscordTaskThread>> {
    conn.query_row(
        "SELECT thread_id, channel_id FROM discord_task_threads WHERE task_id = ?1",
        params![task_id],
        |row| {
            Ok(DiscordTaskThread {
                thread_id: row.get(0)?,
                channel_id: row.get(1)?,
            })
        },
    )
    .optional()
}
