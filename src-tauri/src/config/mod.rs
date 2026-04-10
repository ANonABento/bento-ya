//! Application settings — global defaults + per-workspace overrides.
//!
//! Settings stored in `~/.bentoya/settings.json`. Workspace-level overrides
//! stored in the `config` JSON column on the workspaces table.
//!
//! All settings are mutable at runtime via API.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

/// Global application settings with defaults.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    /// Max concurrent agent sessions (tmux sessions)
    pub max_agent_sessions: usize,
    /// Garbage collector interval in minutes
    pub gc_interval_minutes: u64,
    /// Minutes idle before session is put to sleep (detached)
    pub idle_sleep_minutes: u64,
    /// Hours idle before session is killed
    pub idle_kill_hours: u64,
    /// Days in archive before permanent deletion
    pub archive_purge_days: u64,
    /// Default agent CLI (e.g., "codex", "claude")
    pub default_agent_cli: String,
    /// Default model for agents
    pub default_model: String,
    /// Default session strategy: "reuse" or "fresh"
    pub default_session_strategy: String,
    /// Default advance mode: "auto" or "manual"
    pub default_advance_mode: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            max_agent_sessions: 20,
            gc_interval_minutes: 5,
            idle_sleep_minutes: 30,
            idle_kill_hours: 4,
            archive_purge_days: 30,
            default_agent_cli: "codex".to_string(),
            default_model: String::new(), // empty = use CLI default
            default_session_strategy: "fresh".to_string(),
            default_advance_mode: "auto".to_string(),
        }
    }
}

impl AppSettings {
    /// Path to the global settings file.
    pub fn file_path() -> PathBuf {
        crate::db::data_dir().join("settings.json")
    }

    /// Load settings from disk. Returns defaults if file doesn't exist or is invalid.
    pub fn load() -> Self {
        let path = Self::file_path();
        match std::fs::read_to_string(&path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    /// Save settings to disk.
    pub fn save(&self) -> Result<(), String> {
        let path = Self::file_path();
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;
        std::fs::write(&path, json)
            .map_err(|e| format!("Failed to write settings: {}", e))?;
        Ok(())
    }

    /// Merge a partial JSON update into current settings.
    /// Only provided keys are updated, others keep their current values.
    pub fn merge_update(&mut self, updates: &Value) {
        if let Some(obj) = updates.as_object() {
            if let Some(v) = obj.get("max_agent_sessions").and_then(|v| v.as_u64()) {
                self.max_agent_sessions = v as usize;
            }
            if let Some(v) = obj.get("gc_interval_minutes").and_then(|v| v.as_u64()) {
                self.gc_interval_minutes = v;
            }
            if let Some(v) = obj.get("idle_sleep_minutes").and_then(|v| v.as_u64()) {
                self.idle_sleep_minutes = v;
            }
            if let Some(v) = obj.get("idle_kill_hours").and_then(|v| v.as_u64()) {
                self.idle_kill_hours = v;
            }
            if let Some(v) = obj.get("archive_purge_days").and_then(|v| v.as_u64()) {
                self.archive_purge_days = v;
            }
            if let Some(v) = obj.get("default_agent_cli").and_then(|v| v.as_str()) {
                self.default_agent_cli = v.to_string();
            }
            if let Some(v) = obj.get("default_model").and_then(|v| v.as_str()) {
                self.default_model = v.to_string();
            }
            if let Some(v) = obj.get("default_session_strategy").and_then(|v| v.as_str()) {
                self.default_session_strategy = v.to_string();
            }
            if let Some(v) = obj.get("default_advance_mode").and_then(|v| v.as_str()) {
                self.default_advance_mode = v.to_string();
            }
        }
    }

    /// Resolve a setting value with workspace override.
    /// Workspace config takes precedence over global settings.
    pub fn resolve_with_workspace<'a>(&'a self, workspace_config: Option<&'a str>, key: &str) -> Option<String> {
        // Check workspace override first
        if let Some(config_json) = workspace_config {
            if let Ok(config) = serde_json::from_str::<Value>(config_json) {
                if let Some(val) = config.get(key) {
                    return match val {
                        Value::String(s) => Some(s.clone()),
                        Value::Number(n) => Some(n.to_string()),
                        Value::Bool(b) => Some(b.to_string()),
                        _ => None,
                    };
                }
            }
        }

        // Fall back to global settings
        match key {
            "max_agent_sessions" => Some(self.max_agent_sessions.to_string()),
            "gc_interval_minutes" => Some(self.gc_interval_minutes.to_string()),
            "idle_sleep_minutes" => Some(self.idle_sleep_minutes.to_string()),
            "idle_kill_hours" => Some(self.idle_kill_hours.to_string()),
            "archive_purge_days" => Some(self.archive_purge_days.to_string()),
            "default_agent_cli" => Some(self.default_agent_cli.clone()),
            "default_model" => Some(self.default_model.clone()),
            "default_session_strategy" => Some(self.default_session_strategy.clone()),
            "default_advance_mode" => Some(self.default_advance_mode.clone()),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_defaults() {
        let settings = AppSettings::default();
        assert_eq!(settings.max_agent_sessions, 20);
        assert_eq!(settings.default_agent_cli, "codex");
        assert_eq!(settings.default_session_strategy, "fresh");
        assert_eq!(settings.default_advance_mode, "auto");
    }

    #[test]
    fn test_merge_update() {
        let mut settings = AppSettings::default();
        settings.merge_update(&serde_json::json!({
            "max_agent_sessions": 10,
            "default_agent_cli": "claude"
        }));
        assert_eq!(settings.max_agent_sessions, 10);
        assert_eq!(settings.default_agent_cli, "claude");
        // Unchanged fields keep defaults
        assert_eq!(settings.gc_interval_minutes, 5);
    }

    #[test]
    fn test_merge_update_ignores_unknown() {
        let mut settings = AppSettings::default();
        settings.merge_update(&serde_json::json!({
            "unknown_field": "value",
            "max_agent_sessions": 15
        }));
        assert_eq!(settings.max_agent_sessions, 15);
    }

    #[test]
    fn test_resolve_with_workspace_override() {
        let settings = AppSettings::default();
        let ws_config = r#"{"default_agent_cli": "claude", "default_model": "opus"}"#;

        assert_eq!(
            settings.resolve_with_workspace(Some(ws_config), "default_agent_cli"),
            Some("claude".to_string())
        );
        assert_eq!(
            settings.resolve_with_workspace(Some(ws_config), "default_model"),
            Some("opus".to_string())
        );
        // Not overridden → falls back to global
        assert_eq!(
            settings.resolve_with_workspace(Some(ws_config), "max_agent_sessions"),
            Some("20".to_string())
        );
    }

    #[test]
    fn test_resolve_no_workspace() {
        let settings = AppSettings::default();
        assert_eq!(
            settings.resolve_with_workspace(None, "default_agent_cli"),
            Some("codex".to_string())
        );
    }

    #[test]
    fn test_serde_roundtrip() {
        let settings = AppSettings::default();
        let json = serde_json::to_string(&settings).unwrap();
        let deserialized: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.max_agent_sessions, settings.max_agent_sessions);
        assert_eq!(deserialized.default_agent_cli, settings.default_agent_cli);
    }
}
