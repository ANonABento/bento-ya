//! Kaiten Agents — the runtime seam.
//!
//! An `Agent` (see [`crate::db::Agent`]) is a *definition* you craft once. What
//! varies between agents is not just values but **shape**: a script runner needs
//! command/args/env; an LLM needs a system prompt, a model, an MCP set, skills.
//! That is the "runtime-typed dossier" idea, and [`AgentConfig`] is where it
//! lives.
//!
//! Two pieces:
//!
//! - [`AgentConfig`] — an internally-tagged enum. It is the **registry**: adding
//!   a runtime is a variant, and the compiler then finds every site that has to
//!   care.
//! - [`Runtime`] — the **seam**. Small on purpose.
//!
//! There is deliberately **no `execute`/`spawn` method here.** The decision was
//! "design the seam, ship a few plugins behind it, no execution engine on day
//! one". When agents are wired into columns, spawning should reuse the existing
//! `pipeline::spawn::resolve()` rather than growing a second copy of the
//! cli/model/cwd/prompt precedence rules.
//!
//! Spec: `.tickets/_docs/specs/KAITEN_AGENTS.md`

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The runtime tokens persisted in `agents.runtime`.
pub const RUNTIME_CLAUDE: &str = "claude";
pub const RUNTIME_CODEX: &str = "codex";
pub const RUNTIME_SCRIPT: &str = "script";

/// Every runtime the MVP ships, in display order.
pub const ALL_RUNTIMES: &[&str] = &[RUNTIME_CLAUDE, RUNTIME_CODEX, RUNTIME_SCRIPT];

/// Config for an LLM-backed agent (claude or codex).
///
/// The field names are deliberately the reusable half of the existing
/// `SpawnCliAction` (`src/types/column.ts`) plus the MCP pair chef sessions
/// already use (`chat/session.rs` — `mcp_config_path` / `allowed_tools`).
/// Keeping them identical is what makes wiring this into the pipeline later a
/// mapping rather than a redesign.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LlmConfig {
    /// Appended to the CLI's system prompt when the agent runs.
    pub system_prompt: String,
    /// `opus` | `sonnet` | `haiku` for claude; a model id for codex. Empty
    /// means "whatever the CLI defaults to".
    pub model: String,
    /// Path to an MCP config file to pass through (`--mcp-config`).
    pub mcp_config_path: String,
    /// Tool allow-list paired with `mcp_config_path` (`--allowedTools`).
    pub allowed_tools: Vec<String>,
    /// Ids into the `skills` table. Dangling ids are tolerated and surfaced in
    /// the UI as "missing skill" rather than being an error.
    pub skill_ids: Vec<String>,
}

/// Config for the generic script runtime — the escape hatch that makes "does
/// anything, incl. video/deploy" real without a bespoke engine.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScriptConfig {
    pub command: String,
    pub args: Vec<String>,
    /// Sorted map so serialization is stable — otherwise saving an unchanged
    /// agent would produce a different `config` blob each time.
    pub env: BTreeMap<String, String>,
}

/// The runtime-typed config stored in `agents.config`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "runtime", rename_all = "snake_case")]
pub enum AgentConfig {
    Claude(LlmConfig),
    Codex(LlmConfig),
    Script(ScriptConfig),
}

impl AgentConfig {
    /// The runtime token matching `agents.runtime`.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Claude(_) => RUNTIME_CLAUDE,
            Self::Codex(_) => RUNTIME_CODEX,
            Self::Script(_) => RUNTIME_SCRIPT,
        }
    }

    /// An empty config for a runtime token, for "new agent" defaults.
    pub fn default_for(runtime: &str) -> Option<Self> {
        match runtime {
            RUNTIME_CLAUDE => Some(Self::Claude(LlmConfig::default())),
            RUNTIME_CODEX => Some(Self::Codex(LlmConfig::default())),
            RUNTIME_SCRIPT => Some(Self::Script(ScriptConfig::default())),
            _ => None,
        }
    }

    /// The LLM half, when this is an LLM runtime.
    pub fn llm(&self) -> Option<&LlmConfig> {
        match self {
            Self::Claude(c) | Self::Codex(c) => Some(c),
            Self::Script(_) => None,
        }
    }
}

/// What a runtime tells the UI about itself, so the dossier can render the
/// right shape without hard-coding a match per call site.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDescriptor {
    pub kind: &'static str,
    pub label: &'static str,
    /// True when the dossier should show prompt / model / MCP / skills.
    pub uses_llm_fields: bool,
    /// True when the dossier should show command / args / env.
    pub uses_script_fields: bool,
}

/// The pluggable seam. Intentionally small: describe yourself, and say whether a
/// config is coherent. Execution is not here — see the module docs.
pub trait Runtime {
    fn kind(&self) -> &'static str;
    fn describe(&self) -> RuntimeDescriptor;
    fn validate(&self, config: &AgentConfig) -> Result<(), String>;
}

pub struct ClaudeRuntime;
pub struct CodexRuntime;
pub struct ScriptRuntime;

/// Shared validation for the two LLM runtimes. They differ in how their flags
/// are spelled at spawn time, not in what makes a config coherent.
fn validate_llm(kind: &str, config: &AgentConfig) -> Result<(), String> {
    let Some(llm) = config.llm() else {
        return Err(format!("{} runtime requires an LLM config", kind));
    };
    // An allow-list without an MCP config silently does nothing at spawn time
    // (`--allowedTools` is only passed alongside `--mcp-config`), so flag it
    // here rather than letting it look configured but inert.
    if !llm.allowed_tools.is_empty() && llm.mcp_config_path.trim().is_empty() {
        return Err("Tool allow-list needs an MCP config path to apply to".to_string());
    }
    Ok(())
}

impl Runtime for ClaudeRuntime {
    fn kind(&self) -> &'static str {
        RUNTIME_CLAUDE
    }
    fn describe(&self) -> RuntimeDescriptor {
        RuntimeDescriptor {
            kind: RUNTIME_CLAUDE,
            label: "Claude",
            uses_llm_fields: true,
            uses_script_fields: false,
        }
    }
    fn validate(&self, config: &AgentConfig) -> Result<(), String> {
        validate_llm(RUNTIME_CLAUDE, config)
    }
}

impl Runtime for CodexRuntime {
    fn kind(&self) -> &'static str {
        RUNTIME_CODEX
    }
    fn describe(&self) -> RuntimeDescriptor {
        RuntimeDescriptor {
            kind: RUNTIME_CODEX,
            label: "Codex",
            uses_llm_fields: true,
            uses_script_fields: false,
        }
    }
    fn validate(&self, config: &AgentConfig) -> Result<(), String> {
        validate_llm(RUNTIME_CODEX, config)
    }
}

impl Runtime for ScriptRuntime {
    fn kind(&self) -> &'static str {
        RUNTIME_SCRIPT
    }
    fn describe(&self) -> RuntimeDescriptor {
        RuntimeDescriptor {
            kind: RUNTIME_SCRIPT,
            label: "Script",
            uses_llm_fields: false,
            uses_script_fields: true,
        }
    }
    fn validate(&self, config: &AgentConfig) -> Result<(), String> {
        match config {
            AgentConfig::Script(s) if s.command.trim().is_empty() => {
                Err("Script agents need a command".to_string())
            }
            AgentConfig::Script(_) => Ok(()),
            _ => Err("script runtime requires a script config".to_string()),
        }
    }
}

/// Resolve a runtime token to its plugin.
pub fn runtime_for(kind: &str) -> Option<Box<dyn Runtime>> {
    match kind {
        RUNTIME_CLAUDE => Some(Box::new(ClaudeRuntime)),
        RUNTIME_CODEX => Some(Box::new(CodexRuntime)),
        RUNTIME_SCRIPT => Some(Box::new(ScriptRuntime)),
        _ => None,
    }
}

/// Parse and validate an agent's stored config against its runtime token.
///
/// Guards the one inconsistency the schema can't: `agents.runtime` is a plain
/// string, so it could disagree with the tag inside `agents.config`.
pub fn parse_and_validate(runtime: &str, config_json: &str) -> Result<AgentConfig, String> {
    let plugin = runtime_for(runtime)
        .ok_or_else(|| format!("Unknown runtime `{}` (expected one of {:?})", runtime, ALL_RUNTIMES))?;

    let config: AgentConfig = serde_json::from_str(config_json)
        .map_err(|e| format!("Invalid agent config JSON: {}", e))?;

    if config.kind() != runtime {
        return Err(format!(
            "Config is for runtime `{}` but the agent says `{}`",
            config.kind(),
            runtime
        ));
    }

    plugin.validate(&config)?;
    Ok(config)
}

/// Descriptors for every shipped runtime, for the UI's runtime picker.
pub fn all_descriptors() -> Vec<RuntimeDescriptor> {
    ALL_RUNTIMES
        .iter()
        .filter_map(|k| runtime_for(k).map(|r| r.describe()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_config_round_trips_for_every_runtime() {
        // The tag is what makes the dossier runtime-typed, so a lost or renamed
        // tag would silently collapse all three shapes into one.
        for runtime in ALL_RUNTIMES {
            let config = AgentConfig::default_for(runtime).expect("known runtime");
            let json = serde_json::to_string(&config).unwrap();
            assert!(
                json.contains(&format!("\"runtime\":\"{}\"", runtime)),
                "config must carry its runtime tag: {}",
                json
            );
            let back: AgentConfig = serde_json::from_str(&json).unwrap();
            assert_eq!(back, config);
            assert_eq!(back.kind(), *runtime);
        }
    }

    #[test]
    fn llm_config_survives_a_full_round_trip() {
        let config = AgentConfig::Claude(LlmConfig {
            system_prompt: "Review carefully.".into(),
            model: "opus".into(),
            mcp_config_path: "/tmp/mcp.json".into(),
            allowed_tools: vec!["mcp__kaitencode__get_board".into()],
            skill_ids: vec!["skill-1".into()],
        });
        let back: AgentConfig =
            serde_json::from_str(&serde_json::to_string(&config).unwrap()).unwrap();
        assert_eq!(back, config);
    }

    #[test]
    fn script_env_serializes_stably() {
        // BTreeMap not HashMap: with a HashMap, saving an unchanged agent would
        // produce a different config blob on each write.
        let mut env = BTreeMap::new();
        env.insert("Z".to_string(), "1".to_string());
        env.insert("A".to_string(), "2".to_string());
        let config = AgentConfig::Script(ScriptConfig {
            command: "./render.sh".into(),
            args: vec!["--out".into(), "cut.mp4".into()],
            env,
        });
        let first = serde_json::to_string(&config).unwrap();
        let second = serde_json::to_string(&config).unwrap();
        assert_eq!(first, second);
        assert!(first.find("\"A\"").unwrap() < first.find("\"Z\"").unwrap());
    }

    #[test]
    fn parse_rejects_a_runtime_config_mismatch() {
        // agents.runtime is a plain TEXT column, so it can disagree with the
        // tag inside agents.config. Nothing else catches this.
        let json = serde_json::to_string(&AgentConfig::Script(ScriptConfig {
            command: "ls".into(),
            ..Default::default()
        }))
        .unwrap();
        let err = parse_and_validate(RUNTIME_CLAUDE, &json).unwrap_err();
        assert!(err.contains("script"), "should name the mismatch: {}", err);
    }

    #[test]
    fn parse_rejects_unknown_runtime() {
        let err = parse_and_validate("aider", "{}").unwrap_err();
        assert!(err.contains("Unknown runtime"), "{}", err);
    }

    #[test]
    fn script_agents_need_a_command() {
        let json = serde_json::to_string(&AgentConfig::Script(ScriptConfig::default())).unwrap();
        let err = parse_and_validate(RUNTIME_SCRIPT, &json).unwrap_err();
        assert!(err.contains("command"), "{}", err);
    }

    #[test]
    fn allow_list_without_mcp_config_is_rejected() {
        // `--allowedTools` is only passed alongside `--mcp-config`, so this
        // config would look configured but do nothing at spawn time.
        let json = serde_json::to_string(&AgentConfig::Claude(LlmConfig {
            allowed_tools: vec!["some_tool".into()],
            ..Default::default()
        }))
        .unwrap();
        let err = parse_and_validate(RUNTIME_CLAUDE, &json).unwrap_err();
        assert!(err.contains("MCP config"), "{}", err);
    }

    #[test]
    fn every_shipped_runtime_has_a_descriptor() {
        let descriptors = all_descriptors();
        assert_eq!(descriptors.len(), ALL_RUNTIMES.len());
        // Each runtime claims exactly one dossier shape.
        for d in descriptors {
            assert_ne!(
                d.uses_llm_fields, d.uses_script_fields,
                "{} must claim exactly one dossier shape",
                d.kind
            );
        }
    }
}
