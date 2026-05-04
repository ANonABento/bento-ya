//! Application settings — global defaults + per-workspace overrides.
//!
//! Settings stored in `~/.bentoya/settings.json`. Workspace-level overrides
//! stored in the `config` JSON column on the workspaces table.
//!
//! All settings are mutable at runtime via API.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

pub const DEFAULT_PIPELINE_MAX_CONCURRENT_AGENTS: i64 = 5;
pub const DEFAULT_BRANCH_PREFIX: &str = "bentoya/";
pub const DEFAULT_BASE_BRANCH: &str = "main";

/// Global cached settings instance. Reloaded on save.
static CACHED_SETTINGS: OnceLock<Mutex<AppSettings>> = OnceLock::new();

fn cached() -> &'static Mutex<AppSettings> {
    CACHED_SETTINGS.get_or_init(|| {
        let path = AppSettings::file_path_static();
        let settings = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Mutex::new(settings)
    })
}

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectivePipelineSettings {
    pub default_agent_cli: String,
    pub default_model: Option<String>,
    pub max_concurrent_agents: i64,
    pub branch_prefix: String,
    pub default_base_branch: String,
}

fn workspace_config_value<'a>(config: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = config;
    for key in path {
        current = current.get(*key)?;
    }
    Some(current)
}

fn workspace_config_string(config: &Value, paths: &[&[&str]]) -> Option<String> {
    paths.iter().find_map(|path| {
        workspace_config_value(config, path)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
    })
}

fn workspace_config_i64(config: &Value, paths: &[&[&str]]) -> Option<i64> {
    paths.iter().find_map(|path| {
        let value = workspace_config_value(config, path)?;
        if let Some(n) = value.as_i64() {
            return Some(n);
        }
        value.as_str()?.trim().parse::<i64>().ok()
    })
}

pub(crate) fn normalize_branch_prefix(prefix: &str) -> String {
    let trimmed = prefix.trim();
    if trimmed.is_empty() {
        DEFAULT_BRANCH_PREFIX.to_string()
    } else if trimmed.ends_with('/') {
        trimmed.to_string()
    } else {
        format!("{}/", trimmed)
    }
}

fn effective_pipeline_settings_with_app_settings(
    workspace_config_json: &str,
    settings: &AppSettings,
) -> EffectivePipelineSettings {
    let workspace_config = serde_json::from_str::<Value>(workspace_config_json)
        .unwrap_or_else(|_| Value::Object(Default::default()));

    let default_agent_cli = workspace_config_string(
        &workspace_config,
        &[
            &["defaultAgentCli"],
            &["default_agent_cli"],
            &["agent", "defaultAgentCli"],
            &["agent", "default_agent_cli"],
        ],
    )
    .unwrap_or_else(|| settings.default_agent_cli.clone());

    let default_model = workspace_config_string(
        &workspace_config,
        &[
            &["defaultModel"],
            &["default_model"],
            &["agent", "modelSelection"],
            &["agent", "defaultModel"],
            &["agent", "default_model"],
        ],
    )
    .filter(|model| model != "auto")
    .or_else(|| {
        let model = settings.default_model.trim();
        if model.is_empty() {
            None
        } else {
            Some(model.to_string())
        }
    });

    let max_concurrent_agents = workspace_config_i64(
        &workspace_config,
        &[
            &["maxConcurrentAgents"],
            &["max_concurrent_agents"],
            &["agent", "maxConcurrentAgents"],
            &["agent", "max_concurrent_agents"],
        ],
    )
    .filter(|n| *n > 0)
    .unwrap_or(DEFAULT_PIPELINE_MAX_CONCURRENT_AGENTS);

    let branch_prefix = workspace_config_string(
        &workspace_config,
        &[
            &["branchPrefix"],
            &["branch_prefix"],
            &["git", "branchPrefix"],
            &["git", "branch_prefix"],
            &["workspaceDefaults", "branchPrefix"],
            &["workspace_defaults", "branch_prefix"],
        ],
    )
    .map(|prefix| normalize_branch_prefix(&prefix))
    .unwrap_or_else(|| DEFAULT_BRANCH_PREFIX.to_string());

    let default_base_branch = workspace_config_string(
        &workspace_config,
        &[
            &["defaultBaseBranch"],
            &["default_base_branch"],
            &["git", "defaultBaseBranch"],
            &["git", "default_base_branch"],
        ],
    )
    .unwrap_or_else(|| DEFAULT_BASE_BRANCH.to_string());

    EffectivePipelineSettings {
        default_agent_cli,
        default_model,
        max_concurrent_agents,
        branch_prefix,
        default_base_branch,
    }
}

pub fn effective_pipeline_settings(workspace_config_json: &str) -> EffectivePipelineSettings {
    let settings = AppSettings::load();
    effective_pipeline_settings_with_app_settings(workspace_config_json, &settings)
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
    /// Path to the global settings file (static, no db dependency).
    /// Note: duplicates db::data_dir() logic intentionally to avoid circular init
    /// dependency (OnceLock init can't rely on db module being initialized first).
    fn file_path_static() -> PathBuf {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home).join(".bentoya").join("settings.json")
    }

    /// Path to the global settings file.
    pub fn file_path() -> PathBuf {
        Self::file_path_static()
    }

    /// Load settings from cache (fast, no disk I/O).
    pub fn load() -> Self {
        cached().lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Save settings to disk and update cache.
    pub fn save(&self) -> Result<(), String> {
        let path = Self::file_path();
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;
        std::fs::write(&path, json).map_err(|e| format!("Failed to write settings: {}", e))?;

        // Update cache
        if let Ok(mut cache) = cached().lock() {
            *cache = self.clone();
        }

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
    pub fn resolve_with_workspace<'a>(
        &'a self,
        workspace_config: Option<&'a str>,
        key: &str,
    ) -> Option<String> {
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

    #[test]
    fn test_effective_pipeline_settings_flat_workspace_config() {
        let cfg = r#"{
            "defaultAgentCli": "claude",
            "defaultModel": "sonnet",
            "maxConcurrentAgents": 7,
            "branchPrefix": "work"
        }"#;

        let effective = effective_pipeline_settings_with_app_settings(cfg, &AppSettings::default());

        assert_eq!(effective.default_agent_cli, "claude");
        assert_eq!(effective.default_model.as_deref(), Some("sonnet"));
        assert_eq!(effective.max_concurrent_agents, 7);
        assert_eq!(effective.branch_prefix, "work/");
        assert_eq!(effective.default_base_branch, DEFAULT_BASE_BRANCH);
    }

    #[test]
    fn test_effective_pipeline_settings_default_base_branch_override() {
        let cfg = r#"{"defaultBaseBranch": "develop"}"#;
        let effective = effective_pipeline_settings_with_app_settings(cfg, &AppSettings::default());
        assert_eq!(effective.default_base_branch, "develop");
    }

    #[test]
    fn test_effective_pipeline_settings_default_base_branch_nested() {
        let cfg = r#"{"git": {"defaultBaseBranch": "trunk"}}"#;
        let effective = effective_pipeline_settings_with_app_settings(cfg, &AppSettings::default());
        assert_eq!(effective.default_base_branch, "trunk");
    }

    #[test]
    fn test_effective_pipeline_settings_default_base_branch_empty_falls_back() {
        let cfg = r#"{"defaultBaseBranch": ""}"#;
        let effective = effective_pipeline_settings_with_app_settings(cfg, &AppSettings::default());
        assert_eq!(effective.default_base_branch, DEFAULT_BASE_BRANCH);
    }

    #[test]
    fn test_effective_pipeline_settings_nested_workspace_config() {
        let cfg = r#"{
            "agent": {"modelSelection": "opus", "maxConcurrentAgents": 4},
            "git": {"branchPrefix": "feature/"}
        }"#;

        let effective = effective_pipeline_settings_with_app_settings(cfg, &AppSettings::default());

        assert_eq!(effective.default_model.as_deref(), Some("opus"));
        assert_eq!(effective.max_concurrent_agents, 4);
        assert_eq!(effective.branch_prefix, "feature/");
    }

    #[test]
    fn test_effective_pipeline_settings_ignores_auto_model_and_bad_limit() {
        let cfg = r#"{
            "agent": {"modelSelection": "auto"},
            "maxConcurrentAgents": 0,
            "branchPrefix": ""
        }"#;

        let effective = effective_pipeline_settings_with_app_settings(cfg, &AppSettings::default());

        assert_eq!(effective.default_model, None);
        assert_eq!(
            effective.max_concurrent_agents,
            DEFAULT_PIPELINE_MAX_CONCURRENT_AGENTS
        );
        assert_eq!(effective.branch_prefix, DEFAULT_BRANCH_PREFIX);
    }

    #[test]
    fn test_effective_pipeline_settings_auto_is_only_special_for_model() {
        let cfg = r#"{
            "defaultAgentCli": "auto",
            "branchPrefix": "auto"
        }"#;

        let effective = effective_pipeline_settings_with_app_settings(cfg, &AppSettings::default());

        assert_eq!(effective.default_agent_cli, "auto");
        assert_eq!(effective.branch_prefix, "auto/");
    }
}
