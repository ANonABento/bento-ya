//! Application settings — global defaults + per-workspace overrides.
//!
//! Settings stored in `~/.kaitencode/settings.json`. Workspace-level overrides
//! stored in the `config` JSON column on the workspaces table.
//!
//! All settings are mutable at runtime via API.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

pub const DEFAULT_PIPELINE_MAX_CONCURRENT_AGENTS: i64 = 6;
pub const DEFAULT_BRANCH_PREFIX: &str = "kaitencode/";
pub const LEGACY_BRANCH_PREFIXES: &[&str] = &["bentoya/"];
pub const DEFAULT_BASE_BRANCH: &str = "main";

/// Dev-gating env var for the Phase 1+ interactive runtime mode. When unset
/// or set to a falsy value, any `runtime_mode = "interactive"` trigger config
/// is downgraded to the legacy `terminal` path with a one-time warning. Will
/// be promoted (or removed) in Phase 6 once telemetry on sentinel reliability
/// supports flipping it on by default.
pub const INTERACTIVE_MODE_ENV_VAR: &str = "KAITENCODE_INTERACTIVE_MODE_ENABLED";
pub const DEPRECATED_INTERACTIVE_MODE_ENV_VAR: &str = "BENTOYA_INTERACTIVE_MODE_ENABLED";

/// Whether the interactive runtime mode is currently allowed. The env var is a
/// force-on override (for tests/CI and `launchctl setenv`-style live tweaks
/// without an app restart) — treats `1`, `true`, `yes`, `on` (case-insensitive)
/// as enabled. When the env var is absent/falsy we fall back to the persisted
/// `AppSettings.interactive_mode_enabled` toggle, which is the supported,
/// user-facing way to turn interactive mode on.
pub fn interactive_mode_enabled() -> bool {
    if interactive_mode_env_enabled() {
        return true;
    }
    AppSettings::load().interactive_mode_enabled
}

/// The raw env-var gate, kept separate so callers (and the setting fallback)
/// can distinguish a force-on env override from the persisted toggle.
fn interactive_mode_env_enabled() -> bool {
    match env_var(
        INTERACTIVE_MODE_ENV_VAR,
        DEPRECATED_INTERACTIVE_MODE_ENV_VAR,
    ) {
        Ok(value) => {
            let trimmed = value.trim().to_ascii_lowercase();
            matches!(trimmed.as_str(), "1" | "true" | "yes" | "on")
        }
        Err(_) => false,
    }
}

pub fn env_var(new_key: &str, deprecated_key: &str) -> Result<String, std::env::VarError> {
    std::env::var(new_key).or_else(|new_err| match std::env::var(deprecated_key) {
        Ok(value) => {
            log::warn!("{} is deprecated; rename to {}", deprecated_key, new_key);
            Ok(value)
        }
        Err(_) => Err(new_err),
    })
}

/// Global cached settings instance. Reloaded on save.
static CACHED_SETTINGS: OnceLock<Mutex<AppSettings>> = OnceLock::new();

fn cached() -> &'static Mutex<AppSettings> {
    CACHED_SETTINGS.get_or_init(|| {
        let path = AppSettings::file_path_static();
        let settings = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| AppSettings::from_json_str_with_migrations(&s))
            .unwrap_or_default();
        Mutex::new(settings)
    })
}

const DEPRECATED_SETTING_KEYS: &[(&str, &str)] = &[
    (
        "bento_ya.column_trigger_generation",
        "kaitencode.column_trigger_generation",
    ),
    ("bento_ya.orchestrator_chat", "kaitencode.orchestrator_chat"),
    ("bento_ya.agent_task_input", "kaitencode.agent_task_input"),
];

fn migrate_deprecated_setting_keys(raw_json: &mut Value) {
    let Some(obj) = raw_json.as_object_mut() else {
        return;
    };

    for (old, new) in DEPRECATED_SETTING_KEYS {
        if let Some(val) = obj.remove(*old) {
            obj.entry((*new).to_string()).or_insert_with(|| val);
            log::warn!("Migrated deprecated setting key: {} -> {}", old, new);
        }
    }
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
    /// Phase 4 (AGENT_PANEL_MODES) — global default runtime mode for
    /// trigger-spawned agents. Tokens match the resolver: `"terminal" |
    /// "managed" | "interactive" | ""` (empty = no global default, fall
    /// through to plan default of headless·bubbles).
    pub default_runtime_mode: String,
    /// Phase 3 (AGENT_PANEL_MODES) — opt-in gate for the interactive runtime
    /// mode. Replaces the dev-only `KAITENCODE_INTERACTIVE_MODE_ENABLED` env
    /// var as the real, user-facing switch. The env var still force-enables
    /// (for tests/CI), but this setting is the supported way to turn it on.
    pub interactive_mode_enabled: bool,
    /// Phase 5 (CLI-compat) — known-good minimum CLI versions. The startup
    /// health check warns (never hard-blocks) when an installed CLI is older.
    /// `None`/empty = accept any version.
    pub claude_min_version: Option<String>,
    pub codex_min_version: Option<String>,
    /// MCP recursion guard — the maximum depth of an agent-spawned task chain.
    /// A trigger-spawned agent that calls the MCP `create_task` tool while its
    /// own task is already at this depth is refused. Default 3 (human → agent →
    /// agent → agent, then stop). See `mcp-add-source-attribution` ticket.
    pub mcp_max_recursion_depth: i64,
    /// Discord MVP — whether to run the Discord sidecar bot. Opt-in; off by
    /// default. See `.tickets/discord/MVP-PLAN.md`.
    pub discord_enabled: bool,
    /// Discord bot token (stored in settings.json for the MVP; encryption-at-rest
    /// is a flagged follow-up). Empty = not configured.
    pub discord_bot_token: String,
    /// Discord channel id where per-task threads are created. MVP uses a single
    /// channel for all task threads; per-column channels are a later slice.
    pub discord_thread_channel_id: String,
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

pub(crate) fn is_task_branch_name(branch_name: &str) -> bool {
    branch_name.starts_with(DEFAULT_BRANCH_PREFIX)
        || LEGACY_BRANCH_PREFIXES
            .iter()
            .any(|prefix| branch_name.starts_with(prefix))
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
            default_runtime_mode: String::new(),
            interactive_mode_enabled: false,
            claude_min_version: None,
            codex_min_version: None,
            mcp_max_recursion_depth: 3,
            discord_enabled: false,
            discord_bot_token: String::new(),
            discord_thread_channel_id: String::new(),
        }
    }
}

impl AppSettings {
    fn from_json_str_with_migrations(input: &str) -> Option<Self> {
        let mut raw_json = serde_json::from_str::<Value>(input).ok()?;
        migrate_deprecated_setting_keys(&mut raw_json);
        serde_json::from_value(raw_json).ok()
    }

    /// Path to the global settings file (static, no db dependency).
    fn file_path_static() -> PathBuf {
        crate::db::data_dir().join("settings.json")
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
            if let Some(v) = obj.get("default_runtime_mode").and_then(|v| v.as_str()) {
                self.default_runtime_mode = v.to_string();
            }
            if let Some(v) = obj
                .get("interactive_mode_enabled")
                .and_then(|v| v.as_bool())
            {
                self.interactive_mode_enabled = v;
            }
            if let Some(v) = obj.get("claude_min_version").and_then(|v| v.as_str()) {
                self.claude_min_version =
                    Some(v.to_string()).filter(|s| !s.trim().is_empty());
            }
            if let Some(v) = obj.get("codex_min_version").and_then(|v| v.as_str()) {
                self.codex_min_version =
                    Some(v.to_string()).filter(|s| !s.trim().is_empty());
            }
            if let Some(v) = obj.get("mcp_max_recursion_depth").and_then(|v| v.as_i64()) {
                self.mcp_max_recursion_depth = v.max(0);
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
    fn test_interactive_mode_enabled_setting_round_trips() {
        // Defaults off; merge_update flips it; serde preserves it.
        let mut settings = AppSettings::default();
        assert!(!settings.interactive_mode_enabled);
        settings.merge_update(&serde_json::json!({ "interactive_mode_enabled": true }));
        assert!(settings.interactive_mode_enabled);

        let json = serde_json::to_string(&settings).unwrap();
        let parsed: AppSettings = serde_json::from_str(&json).unwrap();
        assert!(parsed.interactive_mode_enabled);

        // Older settings.json without the key deserializes to the default (off).
        let legacy: AppSettings = serde_json::from_str("{}").unwrap();
        assert!(!legacy.interactive_mode_enabled);
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
    fn test_migrate_deprecated_setting_keys() {
        let mut raw = serde_json::json!({
            "bento_ya.column_trigger_generation": "haiku",
            "bento_ya.orchestrator_chat": "sonnet"
        });

        migrate_deprecated_setting_keys(&mut raw);

        assert!(raw.get("bento_ya.column_trigger_generation").is_none());
        assert!(raw.get("bento_ya.orchestrator_chat").is_none());
        assert_eq!(
            raw.get("kaitencode.column_trigger_generation"),
            Some(&serde_json::json!("haiku"))
        );
        assert_eq!(
            raw.get("kaitencode.orchestrator_chat"),
            Some(&serde_json::json!("sonnet"))
        );
    }

    #[test]
    fn test_migrate_deprecated_setting_keys_new_wins() {
        let mut raw = serde_json::json!({
            "bento_ya.agent_task_input": "old",
            "kaitencode.agent_task_input": "new"
        });

        migrate_deprecated_setting_keys(&mut raw);

        assert!(raw.get("bento_ya.agent_task_input").is_none());
        assert_eq!(
            raw.get("kaitencode.agent_task_input"),
            Some(&serde_json::json!("new"))
        );
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
    fn test_interactive_mode_enabled_reads_env_var() {
        // Serialize against process-global env mutation. Multiple values
        // are exercised inside the guard so we don't ping-pong other tests
        // that read the env.
        static ENV_LOCK: Mutex<()> = Mutex::new(());
        let _guard = ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner());

        let prior = std::env::var(INTERACTIVE_MODE_ENV_VAR).ok();
        let prior_deprecated = std::env::var(DEPRECATED_INTERACTIVE_MODE_ENV_VAR).ok();
        std::env::remove_var(INTERACTIVE_MODE_ENV_VAR);
        std::env::remove_var(DEPRECATED_INTERACTIVE_MODE_ENV_VAR);
        assert!(!interactive_mode_enabled());

        for truthy in ["1", "true", "TRUE", "Yes", "on"] {
            std::env::set_var(INTERACTIVE_MODE_ENV_VAR, truthy);
            assert!(
                interactive_mode_enabled(),
                "expected truthy value {} to enable interactive mode",
                truthy
            );
        }
        for falsy in ["0", "false", "no", "off", ""] {
            std::env::set_var(INTERACTIVE_MODE_ENV_VAR, falsy);
            assert!(
                !interactive_mode_enabled(),
                "expected falsy value {:?} to leave interactive mode disabled",
                falsy
            );
        }

        std::env::remove_var(INTERACTIVE_MODE_ENV_VAR);
        std::env::set_var(DEPRECATED_INTERACTIVE_MODE_ENV_VAR, "1");
        assert!(interactive_mode_enabled());

        match prior {
            Some(v) => std::env::set_var(INTERACTIVE_MODE_ENV_VAR, v),
            None => std::env::remove_var(INTERACTIVE_MODE_ENV_VAR),
        }
        match prior_deprecated {
            Some(v) => std::env::set_var(DEPRECATED_INTERACTIVE_MODE_ENV_VAR, v),
            None => std::env::remove_var(DEPRECATED_INTERACTIVE_MODE_ENV_VAR),
        }
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
