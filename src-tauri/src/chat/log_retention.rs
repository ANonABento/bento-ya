//! Trigger log retention and cleanup.
//!
//! Pipeline triggers spawn CLI agents whose stdout/stderr are captured to log
//! files in `~/.bentoya/trigger_logs/`. We retain the most recent N logs and
//! delete the older ones on startup. We also clean up the historical pile of
//! 58-byte rate-limit stub logs that accumulated in `~/.bentoya/` directly
//! (before this module existed).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::db;

/// Maximum number of trigger logs to keep in `~/.bentoya/trigger_logs/`.
pub const MAX_TRIGGER_LOGS: usize = 100;

/// Exact byte size of the historical rate-limit stub logs (one-line message).
const STALE_RATE_LIMIT_LOG_SIZE: u64 = 58;

/// Content prefix used to confirm a 58-byte file is a rate-limit stub before
/// deleting. We only touch logs that match BOTH size and prefix.
const STALE_RATE_LIMIT_PREFIX: &str = "You've hit your limit";

/// Directory inside `~/.bentoya/` where current trigger logs are retained.
pub fn trigger_logs_dir() -> PathBuf {
    db::data_dir().join("trigger_logs")
}

/// Ensure the trigger logs directory exists.
pub fn ensure_trigger_logs_dir() -> std::io::Result<PathBuf> {
    let dir = trigger_logs_dir();
    if !dir.exists() {
        fs::create_dir_all(&dir)?;
    }
    Ok(dir)
}

/// Allocate a new log path under `~/.bentoya/trigger_logs/`.
pub fn new_trigger_log_path(nonce: &str) -> PathBuf {
    let dir = trigger_logs_dir();
    let _ = fs::create_dir_all(&dir);
    dir.join(format!("trigger_{}.log", nonce))
}

/// Delete the oldest trigger logs in `dir` so at most `max_keep` remain.
/// Returns the number of files deleted.
pub fn gc_trigger_logs(dir: &Path, max_keep: usize) -> usize {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return 0,
    };

    let mut logs: Vec<(PathBuf, SystemTime)> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_string_lossy().to_string();
            if !name.starts_with("trigger_") || !name.ends_with(".log") {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((path, modified))
        })
        .collect();

    if logs.len() <= max_keep {
        return 0;
    }

    // Newest first, drop the tail past max_keep
    logs.sort_by_key(|entry| std::cmp::Reverse(entry.1));
    let mut deleted = 0;
    for (path, _) in logs.into_iter().skip(max_keep) {
        if fs::remove_file(&path).is_ok() {
            deleted += 1;
        }
    }
    deleted
}

/// Delete the legacy 58-byte rate-limit stub logs that accumulated directly in
/// `~/.bentoya/` (the old log path before triggers moved to `trigger_logs/`).
///
/// Match conditions are conservative: file name like `trigger_*.log`, exact
/// size 58 bytes, AND content prefix matches the rate-limit message. Any log
/// that does not match all three conditions is left alone.
pub fn cleanup_stale_rate_limit_logs(dir: &Path) -> usize {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return 0,
    };

    let mut deleted = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name() {
            Some(n) => n.to_string_lossy().to_string(),
            None => continue,
        };
        if !name.starts_with("trigger_") || !name.ends_with(".log") {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if metadata.len() != STALE_RATE_LIMIT_LOG_SIZE {
            continue;
        }
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if !content.starts_with(STALE_RATE_LIMIT_PREFIX) {
            continue;
        }
        if fs::remove_file(&path).is_ok() {
            deleted += 1;
        }
    }
    deleted
}

/// Run startup cleanup: delete legacy rate-limit stubs, then GC the retained
/// `trigger_logs/` dir down to `MAX_TRIGGER_LOGS` files. Best-effort — errors
/// are logged but never propagated.
pub fn run_startup_cleanup() {
    let data = db::data_dir();
    let stale = cleanup_stale_rate_limit_logs(&data);
    if stale > 0 {
        eprintln!(
            "[trigger-logs] Removed {} legacy rate-limit stub log(s) from {}",
            stale,
            data.display()
        );
    }
    if let Ok(dir) = ensure_trigger_logs_dir() {
        let gc_count = gc_trigger_logs(&dir, MAX_TRIGGER_LOGS);
        if gc_count > 0 {
            eprintln!("[trigger-logs] GC removed {} old trigger log(s)", gc_count);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::Duration;

    fn write_file(path: &Path, content: &str) {
        let mut f = fs::File::create(path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
    }

    #[test]
    fn cleanup_removes_only_matching_stubs() {
        let dir = tempdir_named("rate_limit_cleanup");

        // Three 58-byte rate-limit stubs (matches what live codex writes,
        // including the trailing newline). Should be deleted.
        let stub = "You've hit your limit · resets 12pm (America/Montevideo)\n";
        assert_eq!(stub.len() as u64, STALE_RATE_LIMIT_LOG_SIZE);
        for i in 0..3 {
            let p = dir.join(format!("trigger_stub_{}.log", i));
            write_file(&p, stub);
            assert_eq!(fs::metadata(&p).unwrap().len(), STALE_RATE_LIMIT_LOG_SIZE);
        }

        // Same size, different content (kept).
        let other_same_size = dir.join("trigger_other.log");
        write_file(
            &other_same_size,
            "X".repeat(STALE_RATE_LIMIT_LOG_SIZE as usize).as_str(),
        );

        // Prefix matches but file is larger — could be a real log (kept).
        let longer_match = dir.join("trigger_longer.log");
        write_file(
            &longer_match,
            "You've hit your limit · resets 12pm (America/Montevideo) and more bytes here",
        );

        // Unrelated file (kept).
        let unrelated = dir.join("not_a_trigger.txt");
        write_file(&unrelated, "leave me alone");

        let deleted = cleanup_stale_rate_limit_logs(&dir);
        assert_eq!(deleted, 3);
        assert!(other_same_size.exists());
        assert!(longer_match.exists());
        assert!(unrelated.exists());
    }

    #[test]
    fn gc_keeps_newest_n() {
        let dir = tempdir_named("gc_logs");

        // Create 5 logs sequentially with a small sleep so mtimes are
        // strictly increasing in creation order.
        for i in 0..5 {
            let p = dir.join(format!("trigger_{}.log", i));
            write_file(&p, "log");
            std::thread::sleep(Duration::from_millis(15));
        }

        let deleted = gc_trigger_logs(&dir, 2);
        assert_eq!(deleted, 3);
        // The newest two (created last) survive.
        assert!(dir.join("trigger_3.log").exists());
        assert!(dir.join("trigger_4.log").exists());
        assert_eq!(
            fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).count(),
            2
        );
    }

    #[test]
    fn gc_no_op_when_under_limit() {
        let dir = tempdir_named("gc_under_limit");
        for i in 0..3 {
            write_file(&dir.join(format!("trigger_{}.log", i)), "log");
        }
        let deleted = gc_trigger_logs(&dir, 100);
        assert_eq!(deleted, 0);
    }

    /// Create a unique tempdir without pulling in `tempfile`. Cleanup is
    /// best-effort and acceptable for test isolation.
    fn tempdir_named(suffix: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "bentoya_log_retention_{}_{}",
            suffix,
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&base).unwrap();
        base
    }
}
