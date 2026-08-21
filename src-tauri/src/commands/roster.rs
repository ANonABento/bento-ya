//! Tauri commands for the Kaiten Agents roster — agent + skill definitions.
//!
//! Named `roster` rather than `agent` because `commands/agent.rs` is already
//! taken by *runtime* agent control (interrupt/pause/restart of a live CLI).
//! These commands manage the craftable definitions instead.
//!
//! Spec: `.tickets/_docs/specs/KAITEN_AGENTS.md`

use crate::db::{self, Agent, AppState, Skill};
use crate::error::AppError;
use crate::pipeline::triggers::{columns_using_agent, AgentUsage};
use crate::roster;
use tauri::State;

/// Grab the shared connection, mapping a poisoned mutex to a DB error.
macro_rules! conn {
    ($state:expr) => {
        $state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?
    };
}

// ─── Agents ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_agents(state: State<AppState>) -> Result<Vec<Agent>, AppError> {
    let conn = conn!(state);
    Ok(db::list_agents(&conn)?)
}

#[tauri::command]
pub fn get_agent(state: State<AppState>, id: String) -> Result<Agent, AppError> {
    let conn = conn!(state);
    Ok(db::get_agent(&conn, &id)?)
}

/// Shared validation for create and update.
///
/// `agents.runtime` is a plain TEXT column and `agents.config` is a JSON blob,
/// so nothing in the schema stops the two disagreeing. This is the only place
/// that guards it — see `roster::parse_and_validate`.
fn validate(name: &str, runtime: &str, config: &str) -> Result<(), AppError> {
    if name.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Agent name cannot be empty".to_string(),
        ));
    }
    roster::parse_and_validate(runtime, config).map_err(AppError::InvalidInput)?;
    Ok(())
}

#[tauri::command]
pub fn create_agent(
    state: State<AppState>,
    name: String,
    role: String,
    runtime: String,
    config: String,
    avatar: String,
) -> Result<Agent, AppError> {
    validate(&name, &runtime, &config)?;
    let conn = conn!(state);
    let id = db::new_id();
    Ok(db::insert_agent(
        &conn,
        &id,
        name.trim(),
        role.trim(),
        &runtime,
        &config,
        &avatar,
    )?)
}

#[tauri::command]
pub fn update_agent(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    role: Option<String>,
    runtime: Option<String>,
    config: Option<String>,
    avatar: Option<String>,
) -> Result<Agent, AppError> {
    let conn = conn!(state);
    let existing = db::get_agent(&conn, &id)?;

    // Validate the POST-merge state, not just what was sent. Changing only the
    // runtime, or only the config, would otherwise slip a mismatched pair past
    // us — the exact inconsistency `parse_and_validate` exists to catch.
    let next_name = name.as_deref().unwrap_or(&existing.name);
    let next_runtime = runtime.as_deref().unwrap_or(&existing.runtime);
    let next_config = config.as_deref().unwrap_or(&existing.config);
    validate(next_name, next_runtime, next_config)?;

    Ok(db::update_agent(
        &conn,
        &id,
        name.as_deref().map(str::trim),
        role.as_deref().map(str::trim),
        runtime.as_deref(),
        config.as_deref(),
        avatar.as_deref(),
    )?)
}

/// Which columns currently run this agent.
///
/// Agents are global, so this sweeps every workspace, not just the open board.
/// The Roster shows the count on the dossier and names the columns in the
/// delete confirmation — a column pointing at a deleted agent fails its
/// trigger, and finding that out at 3am is worse than a slightly busier dialog.
#[tauri::command]
pub fn get_agent_usage(state: State<AppState>, id: String) -> Result<Vec<AgentUsage>, AppError> {
    let conn = conn!(state);
    Ok(columns_using_agent(&conn, &id))
}

#[tauri::command]
pub fn delete_agent(state: State<AppState>, id: String) -> Result<(), AppError> {
    let conn = conn!(state);
    // Deliberately *not* blocked when columns still reference it. The UI names
    // them in the confirmation, and forbidding the delete outright would leave
    // no way to remove an agent from a workspace you no longer have open.
    // `execute_spawn_cli` fails loudly and by name if one is later fired.
    let usage = columns_using_agent(&conn, &id);
    if !usage.is_empty() {
        log::info!(
            "[roster] Deleting agent '{}' still attached to {} column(s): {}",
            id,
            usage.len(),
            usage
                .iter()
                .map(|u| format!("{}/{}", u.workspace_name, u.column_name))
                .collect::<Vec<_>>()
                .join(", ")
        );
    }
    Ok(db::delete_agent(&conn, &id)?)
}

/// Every runtime the build ships, so the UI's picker and dossier don't
/// hard-code a list that can drift from the Rust side.
#[tauri::command]
pub fn list_agent_runtimes() -> Vec<roster::RuntimeDescriptor> {
    roster::all_descriptors()
}

// ─── Skills ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_skills(state: State<AppState>) -> Result<Vec<Skill>, AppError> {
    let conn = conn!(state);
    Ok(db::list_skills(&conn)?)
}

#[tauri::command]
pub fn create_skill(
    state: State<AppState>,
    name: String,
    description: String,
    trigger: String,
    script: String,
) -> Result<Skill, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Skill name cannot be empty".to_string(),
        ));
    }
    let conn = conn!(state);
    let id = db::new_id();
    Ok(db::insert_skill(
        &conn,
        &id,
        name.trim(),
        &description,
        &trigger,
        &script,
    )?)
}

#[tauri::command]
pub fn update_skill(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    trigger: Option<String>,
    script: Option<String>,
) -> Result<Skill, AppError> {
    if let Some(n) = name.as_deref() {
        if n.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "Skill name cannot be empty".to_string(),
            ));
        }
    }
    let conn = conn!(state);
    Ok(db::update_skill(
        &conn,
        &id,
        name.as_deref().map(str::trim),
        description.as_deref(),
        trigger.as_deref(),
        script.as_deref(),
    )?)
}

#[tauri::command]
pub fn delete_skill(state: State<AppState>, id: String) -> Result<(), AppError> {
    let conn = conn!(state);
    Ok(db::delete_skill(&conn, &id)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::roster::{AgentConfig, LlmConfig, ScriptConfig};

    fn json(config: &AgentConfig) -> String {
        serde_json::to_string(config).unwrap()
    }

    #[test]
    fn validate_rejects_blank_name() {
        let cfg = json(&AgentConfig::Claude(LlmConfig::default()));
        let err = validate("   ", "claude", &cfg).unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)));
    }

    #[test]
    fn validate_rejects_runtime_config_mismatch() {
        let cfg = json(&AgentConfig::Script(ScriptConfig {
            command: "ls".into(),
            ..Default::default()
        }));
        assert!(validate("Agent", "claude", &cfg).is_err());
        assert!(validate("Agent", "script", &cfg).is_ok());
    }

    #[test]
    fn validate_rejects_unparseable_config() {
        assert!(validate("Agent", "claude", "not json").is_err());
    }

    #[test]
    fn every_runtime_descriptor_is_exposed_to_the_ui() {
        // Guards drift between the Rust runtime registry and the UI picker.
        let kinds: Vec<&str> = list_agent_runtimes().into_iter().map(|d| d.kind).collect();
        assert_eq!(kinds, roster::ALL_RUNTIMES.to_vec());
    }
}
