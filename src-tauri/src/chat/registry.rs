//! Session registry — manages multiple UnifiedChatSessions with concurrency limits.
//!
//! Sessions are keyed by a string ID:
//! - Task agents: keyed by `task_id`
//! - Orchestrator/chef: keyed by `"chef:{workspace_id}"`
//!
//! The registry enforces `max_concurrent_sessions` and provides
//! get-or-create semantics for trigger integration.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::Mutex;

use super::session::{SessionConfig, SessionState, TransportType, UnifiedChatSession};

const DEFAULT_MAX_SESSIONS: usize = 5;

/// Registry of active chat sessions.
pub struct SessionRegistry {
    sessions: HashMap<String, UnifiedChatSession>,
    max_sessions: usize,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            max_sessions: DEFAULT_MAX_SESSIONS,
        }
    }

    pub fn with_max_sessions(max_sessions: usize) -> Self {
        Self {
            sessions: HashMap::new(),
            max_sessions,
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
    /// Returns Err if at capacity and the key doesn't already exist.
    pub fn get_or_create(
        &mut self,
        key: &str,
        config: SessionConfig,
        transport_type: TransportType,
    ) -> Result<&mut UnifiedChatSession, String> {
        if !self.sessions.contains_key(key) {
            if self.sessions.len() >= self.max_sessions {
                return Err(format!(
                    "Maximum {} concurrent sessions reached",
                    self.max_sessions
                ));
            }
            self.sessions.insert(
                key.to_string(),
                UnifiedChatSession::new(config, transport_type),
            );
        }
        Ok(self.sessions.get_mut(key).unwrap())
    }

    /// Create or replace a session.
    pub fn insert(&mut self, key: &str, session: UnifiedChatSession) {
        self.sessions.insert(key.to_string(), session);
    }

    /// Remove a session, killing it first.
    pub fn remove(&mut self, key: &str) -> Option<UnifiedChatSession> {
        if let Some(mut session) = self.sessions.remove(key) {
            let _ = session.kill();
            Some(session)
        } else {
            None
        }
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
    pub fn suspend_idle(&mut self, idle_threshold: std::time::Duration) -> Vec<String> {
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
    fn test_registry_capacity() {
        let mut registry = SessionRegistry::with_max_sessions(2);

        registry
            .get_or_create("task-1", test_config(), TransportType::Pipe)
            .unwrap();
        registry
            .get_or_create("task-2", test_config(), TransportType::Pipe)
            .unwrap();

        // At capacity — new key rejected
        let result = registry.get_or_create("task-3", test_config(), TransportType::Pipe);
        assert!(result.is_err());

        // Existing key still works at capacity
        let result = registry.get_or_create("task-1", test_config(), TransportType::Pipe);
        assert!(result.is_ok());
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
