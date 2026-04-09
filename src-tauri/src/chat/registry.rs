//! Session registry — manages multiple UnifiedChatSessions with concurrency limits.
//!
//! Sessions are keyed by a string ID:
//! - Task agents: keyed by `task_id`
//! - Orchestrator/chef: keyed by `"chef:{workspace_id}"`
//!
//! The registry enforces `max_concurrent_sessions` with LRU eviction
//! and provides get-or-create semantics for trigger integration.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;

use super::session::{SessionConfig, SessionState, TransportType, UnifiedChatSession};

const DEFAULT_MAX_SESSIONS: usize = 20;
const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(300); // 5 min

/// Registry of active chat sessions.
pub struct SessionRegistry {
    sessions: HashMap<String, UnifiedChatSession>,
    /// Cached scrollback buffers from killed/suspended sessions (base64-encoded).
    /// Keyed by task_id. Cleared when a new session is created for the same key.
    scrollback_cache: HashMap<String, String>,
    max_sessions: usize,
    idle_timeout: Duration,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            scrollback_cache: HashMap::new(),
            max_sessions: DEFAULT_MAX_SESSIONS,
            idle_timeout: DEFAULT_IDLE_TIMEOUT,
        }
    }

    pub fn with_max_sessions(max_sessions: usize) -> Self {
        Self {
            sessions: HashMap::new(),
            scrollback_cache: HashMap::new(),
            max_sessions,
            idle_timeout: DEFAULT_IDLE_TIMEOUT,
        }
    }

    /// Get an existing session by key.
    pub fn get(&self, key: &str) -> Option<&UnifiedChatSession> {
        self.sessions.get(key)
    }

    /// Get a mutable reference to an existing session.
    pub fn get_mut(&mut self, key: &str) -> Option<&mut UnifiedChatSession> {
        self.sessions.get_mut(key)
    }

    /// Check if a session exists.
    pub fn has(&self, key: &str) -> bool {
        self.sessions.contains_key(key)
    }

    /// Get or create a session. Returns a mutable reference.
    ///
    /// If the session doesn't exist, creates one with the given config.
    /// If at capacity, evicts the oldest idle session (LRU) to make room.
    /// Returns Err only if at capacity and ALL sessions are busy (can't evict).
    pub fn get_or_create(
        &mut self,
        key: &str,
        config: SessionConfig,
        transport_type: TransportType,
    ) -> Result<&mut UnifiedChatSession, String> {
        if !self.sessions.contains_key(key) {
            if self.sessions.len() >= self.max_sessions {
                // LRU eviction: find the oldest idle session and remove it
                // Uses self.remove() to properly kill transport + cache scrollback
                if let Some(evict_key) = self.find_oldest_idle() {
                    // Can't call self.remove() due to borrow, so inline the logic
                    if let Some(mut session) = self.sessions.remove(&evict_key) {
                        let scrollback = session.scrollback();
                        if !scrollback.is_empty() {
                            self.scrollback_cache.insert(evict_key, scrollback);
                        }
                        let _ = session.kill();
                    }
                } else {
                    return Err(format!(
                        "Maximum {} concurrent sessions reached (all busy)",
                        self.max_sessions
                    ));
                }
            }
            self.sessions.insert(
                key.to_string(),
                UnifiedChatSession::new(config, transport_type),
            );
        }
        Ok(self.sessions.get_mut(key).unwrap())
    }

    /// Create or replace a session. Kills the existing session if present.
    pub fn insert(&mut self, key: &str, session: UnifiedChatSession) {
        if let Some(mut old) = self.sessions.remove(key) {
            let _ = old.kill();
        }
        self.sessions.insert(key.to_string(), session);
    }

    /// Remove a session, caching its scrollback before killing.
    pub fn remove(&mut self, key: &str) -> Option<UnifiedChatSession> {
        if let Some(mut session) = self.sessions.remove(key) {
            // Cache scrollback before killing (so panel reopen can restore it)
            let scrollback = session.scrollback();
            if !scrollback.is_empty() {
                self.scrollback_cache.insert(key.to_string(), scrollback);
            }
            let _ = session.kill();
            Some(session)
        } else {
            None
        }
    }

    /// Get cached scrollback for a session (base64-encoded).
    /// Returns empty string if no cache exists.
    pub fn take_scrollback(&mut self, key: &str) -> String {
        self.scrollback_cache.remove(key).unwrap_or_default()
    }

    /// Number of active sessions.
    pub fn len(&self) -> usize {
        self.sessions.len()
    }

    /// Whether the registry is empty.
    pub fn is_empty(&self) -> bool {
        self.sessions.is_empty()
    }

    /// Whether the registry is at capacity.
    pub fn is_at_capacity(&self) -> bool {
        self.sessions.len() >= self.max_sessions
    }

    /// List all session keys with their state.
    pub fn list(&self) -> Vec<(String, SessionState)> {
        self.sessions
            .iter()
            .map(|(k, s)| (k.clone(), s.state()))
            .collect()
    }

    /// Suspend all sessions (save resume IDs, kill transports).
    pub fn suspend_all(&mut self) {
        for session in self.sessions.values_mut() {
            let _ = session.suspend();
        }
    }

    /// Kill all sessions and clear the registry.
    pub fn kill_all(&mut self) {
        for session in self.sessions.values_mut() {
            let _ = session.kill();
        }
        self.sessions.clear();
    }

    /// Find sessions idle longer than the given duration and suspend them.
    /// Returns the keys of suspended sessions.
    pub fn suspend_idle(&mut self, idle_threshold: Duration) -> Vec<String> {
        let now = Instant::now();
        let mut suspended = Vec::new();

        for (key, session) in self.sessions.iter_mut() {
            if session.state() == SessionState::Running
                && !session.is_busy()
                && now.duration_since(session.last_activity()) >= idle_threshold
            {
                let _ = session.suspend();
                suspended.push(key.clone());
            }
        }

        suspended
    }

    /// Run idle timeout sweep using the configured threshold.
    /// Returns the number of sessions suspended.
    pub fn sweep_idle(&mut self) -> usize {
        let threshold = self.idle_timeout;
        self.suspend_idle(threshold).len()
    }

    /// Find the oldest idle (not busy) session key for LRU eviction.
    /// Prefers suspended sessions, then idle, then non-busy running.
    fn find_oldest_idle(&self) -> Option<String> {
        let mut oldest: Option<(&str, Instant)> = None;

        for (key, session) in &self.sessions {
            if session.is_busy() {
                continue;
            }

            let activity = session.last_activity();
            let dominated = match oldest {
                None => true,
                Some((_, oldest_time)) => activity < oldest_time,
            };

            if dominated {
                oldest = Some((key, activity));
            }
        }

        oldest.map(|(k, _)| k.to_string())
    }
}

impl Default for SessionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Thread-safe wrapper for SessionRegistry.
pub type SharedSessionRegistry = Arc<Mutex<SessionRegistry>>;

pub fn new_shared_session_registry() -> SharedSessionRegistry {
    Arc::new(Mutex::new(SessionRegistry::new()))
}

/// Start a periodic idle sweep task. Runs every 60s.
/// Suspends sessions that have been idle longer than the registry's idle_timeout.
pub fn start_idle_sweep(registry: SharedSessionRegistry) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            let count = {
                let mut reg = registry.lock().await;
                reg.sweep_idle()
            };
            if count > 0 {
                eprintln!("[registry] Suspended {} idle session(s)", count);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> SessionConfig {
        SessionConfig {
            cli_path: "/usr/bin/claude".to_string(),
            model: "sonnet".to_string(),
            system_prompt: "test".to_string(),
            working_dir: None,
            effort_level: None,
        }
    }

    #[test]
    fn test_registry_crud() {
        let mut registry = SessionRegistry::new();
        assert!(registry.is_empty());
        assert!(!registry.has("task-1"));

        // Create
        registry
            .get_or_create("task-1", test_config(), TransportType::Pipe)
            .unwrap();
        assert!(registry.has("task-1"));
        assert_eq!(registry.len(), 1);

        // Get
        let session = registry.get("task-1").unwrap();
        assert_eq!(session.model(), "sonnet");

        // Remove
        registry.remove("task-1");
        assert!(!registry.has("task-1"));
        assert!(registry.is_empty());
    }

    #[test]
    fn test_registry_lru_eviction() {
        let mut registry = SessionRegistry::with_max_sessions(2);

        registry
            .get_or_create("task-1", test_config(), TransportType::Pipe)
            .unwrap();
        registry
            .get_or_create("task-2", test_config(), TransportType::Pipe)
            .unwrap();

        // At capacity — LRU eviction kicks in, evicts task-1 (oldest)
        let result = registry.get_or_create("task-3", test_config(), TransportType::Pipe);
        assert!(result.is_ok());
        assert_eq!(registry.len(), 2);

        // task-1 was evicted, task-2 and task-3 remain
        assert!(!registry.has("task-1"));
        assert!(registry.has("task-2"));
        assert!(registry.has("task-3"));
    }

    #[test]
    fn test_registry_capacity_existing_key() {
        let mut registry = SessionRegistry::with_max_sessions(2);

        registry
            .get_or_create("task-1", test_config(), TransportType::Pipe)
            .unwrap();
        registry
            .get_or_create("task-2", test_config(), TransportType::Pipe)
            .unwrap();

        // Existing key still works at capacity (no eviction needed)
        let result = registry.get_or_create("task-1", test_config(), TransportType::Pipe);
        assert!(result.is_ok());
        assert_eq!(registry.len(), 2);
    }

    #[test]
    fn test_find_oldest_idle() {
        let mut registry = SessionRegistry::new();

        registry
            .get_or_create("old", test_config(), TransportType::Pipe)
            .unwrap();

        // Slight delay so "new" has a later timestamp
        std::thread::sleep(std::time::Duration::from_millis(10));

        registry
            .get_or_create("new", test_config(), TransportType::Pipe)
            .unwrap();

        let oldest = registry.find_oldest_idle();
        assert_eq!(oldest, Some("old".to_string()));
    }

    #[test]
    fn test_registry_list() {
        let mut registry = SessionRegistry::new();
        registry
            .get_or_create("task-1", test_config(), TransportType::Pipe)
            .unwrap();
        registry
            .get_or_create("chef:ws-1", test_config(), TransportType::Pipe)
            .unwrap();

        let list = registry.list();
        assert_eq!(list.len(), 2);
        assert!(list.iter().all(|(_, s)| *s == SessionState::Idle));
    }

    #[test]
    fn test_registry_kill_all() {
        let mut registry = SessionRegistry::new();
        registry
            .get_or_create("task-1", test_config(), TransportType::Pipe)
            .unwrap();
        registry
            .get_or_create("task-2", test_config(), TransportType::Pipe)
            .unwrap();

        registry.kill_all();
        assert!(registry.is_empty());
    }

    #[test]
    fn test_registry_get_or_create_reuses() {
        let mut registry = SessionRegistry::new();

        // First call creates
        {
            let session = registry
                .get_or_create("task-1", test_config(), TransportType::Pipe)
                .unwrap();
            session.set_resume_id(Some("resume-abc".to_string()));
        }

        // Second call reuses (preserves resume ID)
        {
            let session = registry
                .get_or_create("task-1", test_config(), TransportType::Pipe)
                .unwrap();
            assert_eq!(session.resume_id(), Some("resume-abc"));
        }
    }
}
