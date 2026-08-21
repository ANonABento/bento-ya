//! Single source of truth for resolving "run an agent" parameters.
//!
//! Every spawn entry point (headless trigger, managed trigger, interactive
//! trigger, per-task chat turn, interactive restart) needs the same five
//! things derived from a task: which CLI to run, which model, which runtime
//! mode, which working directory, and the initial prompt. Historically each
//! path re-derived these ad hoc and drifted. `resolve()` is the one place the
//! documented precedence lives:
//!
//! ```text
//! task > trigger > agent > workspace > global > default
//! ```
//!
//! The **agent** tier is new: a column's `spawn_cli` action may name an agent
//! from the Roster, and when it does the agent supplies the CLI, the
//! instructions, the tools and its preferred model. Per the Kaiten Agents spec
//! the column may override **model only** — everything else about the agent is
//! the agent's own, which is the entire point of crafting one. That rule is
//! enforced here and nowhere else.
//!
//! It is deliberately **`AppHandle`-free and pure** (takes `&Task` / `&Column`
//! / `&Workspace` and plain defaults, returns data) so it is fully
//! unit-testable. All side effects — worktree creation, `.task.md` writing, DB
//! writes, the actual process launch, event emission — stay in the thin
//! spawn/emit wrappers that call this.

use std::collections::{BTreeMap, HashMap};

use crate::db::{Column, Task, Workspace};
use crate::roster::plan::AgentSpawnPlan;
use crate::error::AppError;

use super::template::{self, TemplateContext};
use super::triggers::{normalize_agent_runtime_mode, resolve_model_override, resolve_working_dir};

/// The token-optimized default prompt: point the agent at `.task.md` instead
/// of inlining the full spec. Used by every spawn path that has no explicit
/// prompt, mirroring the `.task.md` convention written by `execute_spawn_cli`.
pub(crate) fn task_md_default_prompt(task: &Task) -> String {
    format!("{}\n\nSee .task.md for full spec.", task.title)
}

/// Translate an already-resolved model into CLI args: a non-empty (trimmed)
/// model becomes `["--model", model]`, anything else becomes `[]`. The single
/// source of truth shared by the trigger, chat, and restart argv builders.
pub(crate) fn model_to_args(model: Option<&str>) -> Vec<String> {
    match model {
        Some(m) if !m.trim().is_empty() => vec!["--model".to_string(), m.to_string()],
        _ => Vec::new(),
    }
}

/// Trigger-config overrides — the narrowest precedence tier. Each field, when
/// `Some`/non-empty, wins over the task/column/workspace/global tiers that
/// `resolve()` reads from its other arguments.
#[derive(Debug, Default, Clone)]
pub(crate) struct SpawnOverrides<'a> {
    pub cli: Option<&'a str>,
    pub command: Option<&'a str>,
    pub prompt_template: Option<&'a str>,
    pub prompt: Option<&'a str>,
    pub runtime_mode: Option<&'a str>,
    pub model: Option<&'a str>,
}

/// Everything a spawn path needs, with all precedence already applied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedAgentSpawn {
    /// Validated CLI binary/path (`"claude"` | `"codex"` | canonicalized path).
    pub cli_type: String,
    /// Resolved model, empty-string-normalized; `None` means "CLI default".
    pub model: Option<String>,
    /// `"terminal"` | `"managed"` | `"interactive"` — already normalized
    /// (interactive downgrades to terminal when the dev flag is off / CLI
    /// unsupported, matching the legacy behavior).
    pub runtime_mode: String,
    /// Worktree-or-repo, resolved via [`resolve_working_dir`]. Callers still
    /// apply their own filesystem-existence fallback for the spawn cwd.
    pub working_dir: String,
    /// Prompt with the `.task.md` default applied and any slash command
    /// prepended.
    pub initial_prompt: String,
    /// Name of the attached agent, for errors and telemetry. `None` when the
    /// column spawns a bare CLI the old way.
    pub agent_name: Option<String>,
    /// True when the resolved command is a script agent's own command rather
    /// than a known CLI binary. Callers must not treat it as claude/codex.
    pub is_script_agent: bool,
    /// Extra argv the agent contributes (MCP flags, or a script's own args).
    pub agent_args: Vec<String>,
    /// Environment overrides from a script agent.
    pub agent_env: BTreeMap<String, String>,
    /// Rendered `.agent.md` contents, when the agent has anything to say. The
    /// caller writes the file; see `roster::plan` for why instructions travel
    /// as a file rather than a system-prompt flag.
    pub agent_instructions: Option<String>,
}

/// Resolve the full spawn parameter set for a trigger-driven agent. Pure: no
/// `AppHandle`, no DB, no filesystem writes. The only filesystem reads are the
/// worktree-existence check inside [`resolve_working_dir`] and the CLI-path
/// validation inside `validate_agent_cli_path`.
///
/// `default_cli` / `default_model` carry the workspace+global tiers (the caller
/// derives them from `EffectivePipelineSettings`); `prev_column` feeds the
/// template context so `{prev_column.*}` variables interpolate.
#[allow(clippy::too_many_arguments)]
pub(crate) fn resolve(
    task: &Task,
    column: &Column,
    workspace: &Workspace,
    prev_column: Option<&Column>,
    overrides: &SpawnOverrides,
    agent: Option<&AgentSpawnPlan>,
    default_cli: &str,
    default_model: Option<&str>,
) -> Result<ResolvedAgentSpawn, AppError> {
    let working_dir = resolve_working_dir(task, &workspace.repo_path);

    // Prompt: explicit prompt > template > `.task.md` default.
    let ctx = TemplateContext {
        task,
        column,
        workspace,
        prev_column,
        next_column: None,
        dep_tasks: HashMap::new(),
    };
    let resolved_prompt = if let Some(p) = overrides.prompt {
        if !p.is_empty() {
            template::interpolate(p, &ctx)
        } else if let Some(tmpl) = overrides.prompt_template {
            template::interpolate(tmpl, &ctx)
        } else {
            task_md_default_prompt(task)
        }
    } else if let Some(tmpl) = overrides.prompt_template {
        template::interpolate(tmpl, &ctx)
    } else {
        task_md_default_prompt(task)
    };

    // CLI. An attached agent owns this outright — picking "Code Smith" and
    // then having the column's stale `cli` token silently run codex instead
    // would make the roster a lie. A leftover token is logged, not obeyed.
    let cli_type = if let Some(plan) = agent {
        if let Some(stale) = overrides.cli.filter(|c| !c.trim().is_empty()) {
            if stale != plan.command {
                log::info!(
                    "[spawn] Column names agent '{}' ({}) — ignoring its leftover cli token '{}'",
                    plan.agent_name,
                    plan.command,
                    stale
                );
            }
        }
        if plan.is_script {
            // Script agents are arbitrary commands by design; that is the
            // point of the runtime. The claude/codex allow-list guards
            // *hand-editable trigger JSON*, and this command did not come
            // from there — it came from an `agents` row authored in the
            // Roster UI, the same trust level `run_script` already grants
            // user-authored scripts. Emptiness is still refused.
            if plan.command.trim().is_empty() {
                return Err(AppError::InvalidInput(format!(
                    "Agent '{}' has no command to run",
                    plan.agent_name
                )));
            }
            plan.command.clone()
        } else {
            crate::commands::agent::validate_agent_cli_path(&plan.command)?
        }
    } else {
        // No agent: trigger config > workspace/global default. User-editable
        // JSON is normalized through the same backend allowlist used by direct
        // agent commands before it reaches the shell launcher.
        let raw_cli_type = overrides
            .cli
            .filter(|c| !c.trim().is_empty())
            .map(|c| c.to_string())
            .unwrap_or_else(|| default_cli.to_string());
        if raw_cli_type.trim() == "auto" {
            "codex".to_string()
        } else {
            crate::commands::agent::validate_agent_cli_path(&raw_cli_type)?
        }
    };

    // Prepend slash command if provided.
    let mut initial_prompt = match overrides.command {
        Some(cmd) if resolved_prompt.is_empty() => cmd.to_string(),
        Some(cmd) => format!("{}\n\n{}", cmd, resolved_prompt),
        None => resolved_prompt,
    };

    // Point the agent at its own instructions, the same way the default prompt
    // points at `.task.md`. Only when there is a file to read — a bare agent
    // gets no dangling reference.
    let agent_instructions = agent.and_then(|p| p.instructions.clone());
    if agent_instructions.is_some() {
        let suffix = crate::roster::plan::instructions_prompt_suffix();
        if initial_prompt.trim().is_empty() {
            initial_prompt = suffix;
        } else {
            initial_prompt = format!("{}\n\n{}", initial_prompt, suffix);
        }
    }

    // Runtime mode: `normalize_agent_runtime_mode` downgrades `interactive`
    // to `terminal` when the dev flag is unset or the CLI is unsupported.
    //
    // A script agent is always `terminal`. The other two modes are shaped
    // around an LLM CLI — `managed` parses a semantic JSON event stream and
    // `interactive` drives a TUI — and a render script has neither. Forcing it
    // here beats letting a column's leftover `runtime_mode` produce a pane
    // that waits forever for events that will never come.
    let runtime_mode = if agent.is_some_and(|p| p.is_script) {
        "terminal".to_string()
    } else {
        normalize_agent_runtime_mode(overrides.runtime_mode, &cli_type).to_string()
    };

    // Model: task override > trigger config > agent > workspace/global default.
    // This is the *only* tier a column may take from an attached agent — the
    // rest of the agent's config is the agent's own (Kaiten Agents spec). The
    // agent slots in below the trigger so "this column, but with opus" stays
    // possible without redefining the agent.
    let agent_or_default = agent
        .and_then(|p| p.model.as_deref())
        .or(default_model);
    let model = resolve_model_override(task.model.as_deref(), overrides.model, agent_or_default);

    Ok(ResolvedAgentSpawn {
        cli_type,
        model,
        runtime_mode,
        working_dir,
        initial_prompt,
        agent_name: agent.map(|p| p.agent_name.clone()),
        is_script_agent: agent.is_some_and(|p| p.is_script),
        agent_args: agent.map(|p| p.args.clone()).unwrap_or_default(),
        agent_env: agent.map(|p| p.env.clone()).unwrap_or_default(),
        agent_instructions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    /// Build a real workspace/column/task triple via the in-memory test DB so
    /// the model structs match production exactly.
    fn fixture() -> (db::Workspace, db::Column, db::Task, rusqlite::Connection) {
        let conn = db::init_test().unwrap();
        let ws = db::insert_workspace(&conn, "Test", "/tmp/test-spawn").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Working", 0).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col.id, "My Task", None).unwrap();
        (ws, col, task, conn)
    }

    #[test]
    fn model_to_args_skips_blank_and_emits_flag() {
        assert_eq!(model_to_args(None), Vec::<String>::new());
        assert_eq!(model_to_args(Some("   ")), Vec::<String>::new());
        assert_eq!(
            model_to_args(Some("opus")),
            vec!["--model".to_string(), "opus".to_string()]
        );
    }

    #[test]
    fn task_md_default_prompt_points_at_task_md() {
        let (_, _, task, _) = fixture();
        assert_eq!(
            task_md_default_prompt(&task),
            "My Task\n\nSee .task.md for full spec."
        );
    }

    #[test]
    fn resolve_uses_default_cli_and_task_md_prompt_when_unspecified() {
        let (ws, col, task, _conn) = fixture();
        let resolved = resolve(
            &task,
            &col,
            &ws,
            None,
            &SpawnOverrides::default(),
            None,
            "claude",
            None,
        )
        .unwrap();
        assert_eq!(resolved.cli_type, "claude");
        assert_eq!(resolved.model, None);
        // No dev flag in the test env → headless terminal.
        assert_eq!(resolved.runtime_mode, "terminal");
        // worktree_path unset → workspace repo_path.
        assert_eq!(resolved.working_dir, ws.repo_path);
        assert_eq!(resolved.initial_prompt, "My Task\n\nSee .task.md for full spec.");
    }

    #[test]
    fn resolve_trigger_cli_and_model_override_default() {
        let (ws, col, task, _conn) = fixture();
        let resolved = resolve(
            &task,
            &col,
            &ws,
            None,
            &SpawnOverrides {
                cli: Some("codex"),
                model: Some("gpt-5"),
                ..Default::default()
            },
            None,
            "claude",
            Some("sonnet"),
        )
        .unwrap();
        assert_eq!(resolved.cli_type, "codex");
        // Trigger model beats the global default.
        assert_eq!(resolved.model.as_deref(), Some("gpt-5"));
    }

    #[test]
    fn resolve_task_model_beats_trigger_and_default() {
        let (ws, col, _task, conn) = fixture();
        let task = db::insert_task_full(
            &conn,
            &db::NewTask {
                workspace_id: &ws.id,
                column_id: &col.id,
                title: "Modeled Task",
                model: Some("haiku"),
                ..Default::default()
            },
        )
        .unwrap();
        let resolved = resolve(
            &task,
            &col,
            &ws,
            None,
            &SpawnOverrides {
                model: Some("sonnet"),
                ..Default::default()
            },
            None,
            "claude",
            Some("opus"),
        )
        .unwrap();
        assert_eq!(resolved.model.as_deref(), Some("haiku"));
    }

    #[test]
    fn resolve_auto_cli_maps_to_codex() {
        let (ws, col, task, _conn) = fixture();
        let resolved = resolve(
            &task,
            &col,
            &ws,
            None,
            &SpawnOverrides {
                cli: Some("auto"),
                ..Default::default()
            },
            None,
            "claude",
            None,
        )
        .unwrap();
        assert_eq!(resolved.cli_type, "codex");
    }

    #[test]
    fn resolve_explicit_prompt_wins_and_command_prepends() {
        let (ws, col, task, _conn) = fixture();
        let resolved = resolve(
            &task,
            &col,
            &ws,
            None,
            &SpawnOverrides {
                prompt: Some("do the thing"),
                command: Some("/review"),
                ..Default::default()
            },
            None,
            "claude",
            None,
        )
        .unwrap();
        assert_eq!(resolved.initial_prompt, "/review\n\ndo the thing");
    }

    #[test]
    fn resolve_command_only_uses_command_as_prompt() {
        let (ws, col, task, _conn) = fixture();
        let resolved = resolve(
            &task,
            &col,
            &ws,
            None,
            &SpawnOverrides {
                prompt: Some(""),
                command: Some("/review"),
                ..Default::default()
            },
            None,
            "claude",
            None,
        )
        .unwrap();
        // Empty explicit prompt + no template → falls to the .task.md default,
        // which is non-empty, so the command is prepended (not used alone).
        assert_eq!(
            resolved.initial_prompt,
            "/review\n\nMy Task\n\nSee .task.md for full spec."
        );
    }

    // ── Attached agents ────────────────────────────────────────────────
    //
    // The contract from the Kaiten Agents spec: the agent owns its config and
    // the column may override *model only*. These pin both halves.

    fn plan(command: &str, is_script: bool) -> AgentSpawnPlan {
        AgentSpawnPlan {
            agent_name: "Code Smith".to_string(),
            command: command.to_string(),
            is_script,
            model: None,
            instructions: None,
            args: Vec::new(),
            env: BTreeMap::new(),
        }
    }

    #[test]
    fn an_attached_agent_supplies_the_cli() {
        let (ws, col, task, _conn) = fixture();
        let resolved = resolve(
            &task,
            &col,
            &ws,
            None,
            &SpawnOverrides::default(),
            Some(&plan("codex", false)),
            "claude",
            None,
        )
        .unwrap();
        assert_eq!(resolved.cli_type, "codex");
        assert_eq!(resolved.agent_name.as_deref(), Some("Code Smith"));
    }

    #[test]
    fn an_attached_agent_beats_a_stale_cli_token_on_the_column() {
        // Columns configured before the agent was attached still carry a `cli`.
        // Obeying it would run a different binary than the roster tile shows.
        let (ws, col, task, _conn) = fixture();
        let resolved = resolve(
            &task,
            &col,
            &ws,
            None,
            &SpawnOverrides {
                cli: Some("claude"),
                ..Default::default()
            },
            Some(&plan("codex", false)),
            "claude",
            None,
        )
        .unwrap();
        assert_eq!(resolved.cli_type, "codex");
    }

    #[test]
    fn the_column_may_override_the_agents_model_and_nothing_else() {
        let (ws, col, task, _conn) = fixture();
        let mut agent = plan("claude", false);
        agent.model = Some("haiku".to_string());
        agent.args = vec!["--strict-mcp-config".to_string()];

        let resolved = resolve(
            &task,
            &col,
            &ws,
            None,
            &SpawnOverrides {
                model: Some("opus"),
                ..Default::default()
            },
            Some(&agent),
            "claude",
            None,
        )
        .unwrap();
        // Model: the column wins — that is the one permitted override.
        assert_eq!(resolved.model.as_deref(), Some("opus"));
        // Tools: still the agent's.
        assert_eq!(resolved.agent_args, vec!["--strict-mcp-config".to_string()]);
    }

    #[test]
    fn the_agents_model_beats_the_workspace_default() {
        let (ws, col, task, _conn) = fixture();
        let mut agent = plan("claude", false);
        agent.model = Some("haiku".to_string());
        let resolved = resolve(
            &task,
            &col,
            &ws,
            None,
            &SpawnOverrides::default(),
            Some(&agent),
            "claude",
            Some("sonnet"),
        )
        .unwrap();
        assert_eq!(resolved.model.as_deref(), Some("haiku"));
    }

    #[test]
    fn a_task_model_still_beats_the_agent() {
        // Task is the narrowest tier; attaching an agent must not take away
        // per-task control that already worked.
        let (ws, col, _task, conn) = fixture();
        let task = db::insert_task_full(
            &conn,
            &db::NewTask {
                workspace_id: &ws.id,
                column_id: &col.id,
                title: "Modeled Task",
                model: Some("opus"),
                ..Default::default()
            },
        )
        .unwrap();
        let mut agent = plan("claude", false);
        agent.model = Some("haiku".to_string());
        let resolved = resolve(
            &task,
            &col,
            &ws,
            None,
            &SpawnOverrides::default(),
            Some(&agent),
            "claude",
            None,
        )
        .unwrap();
        assert_eq!(resolved.model.as_deref(), Some("opus"));
    }

    #[test]
    fn a_script_agent_skips_the_cli_allow_list() {
        // `./render.sh` is not claude or codex and never will be. The allow
        // list guards hand-edited trigger JSON; this command came from an
        // agents row instead.
        let (ws, col, task, _conn) = fixture();
        let resolved = resolve(
            &task,
            &col,
            &ws,
            None,
            &SpawnOverrides::default(),
            Some(&plan("./render.sh", true)),
            "claude",
            None,
        )
        .unwrap();
        assert_eq!(resolved.cli_type, "./render.sh");
        assert!(resolved.is_script_agent);
    }

    #[test]
    fn a_script_agent_is_forced_to_terminal_mode() {
        // `managed` parses an LLM event stream and `interactive` drives a TUI.
        // A render script produces neither, so a leftover mode token would
        // leave the pane waiting on events that never arrive.
        let (ws, col, task, _conn) = fixture();
        for mode in ["managed", "interactive"] {
            let resolved = resolve(
                &task,
                &col,
                &ws,
                None,
                &SpawnOverrides {
                    runtime_mode: Some(mode),
                    ..Default::default()
                },
                Some(&plan("./render.sh", true)),
                "claude",
                None,
            )
            .unwrap();
            assert_eq!(resolved.runtime_mode, "terminal", "mode {}", mode);
        }
    }

    #[test]
    fn a_script_agent_with_no_command_is_refused() {
        let (ws, col, task, _conn) = fixture();
        assert!(resolve(
            &task,
            &col,
            &ws,
            None,
            &SpawnOverrides::default(),
            Some(&plan("   ", true)),
            "claude",
            None,
        )
        .is_err());
    }

    #[test]
    fn instructions_add_a_prompt_pointer_to_the_file() {
        let (ws, col, task, _conn) = fixture();
        let mut agent = plan("claude", false);
        agent.instructions = Some("# Code Smith\n\nDo the thing.\n".to_string());
        let resolved = resolve(
            &task,
            &col,
            &ws,
            None,
            &SpawnOverrides::default(),
            Some(&agent),
            "claude",
            None,
        )
        .unwrap();
        assert!(
            resolved.initial_prompt.ends_with(&crate::roster::plan::instructions_prompt_suffix()),
            "{}",
            resolved.initial_prompt
        );
        // The task spec pointer survives alongside it.
        assert!(resolved.initial_prompt.contains(".task.md"));
        assert!(resolved.agent_instructions.is_some());
    }

    #[test]
    fn a_bare_agent_adds_no_prompt_pointer() {
        let (ws, col, task, _conn) = fixture();
        let resolved = resolve(
            &task,
            &col,
            &ws,
            None,
            &SpawnOverrides::default(),
            Some(&plan("claude", false)),
            "claude",
            None,
        )
        .unwrap();
        assert!(!resolved.initial_prompt.contains(".agent.md"));
        assert_eq!(resolved.agent_instructions, None);
    }

    #[test]
    fn no_agent_leaves_every_agent_field_empty() {
        // The old path has to stay byte-identical — most columns have no agent.
        let (ws, col, task, _conn) = fixture();
        let resolved = resolve(
            &task,
            &col,
            &ws,
            None,
            &SpawnOverrides::default(),
            None,
            "claude",
            None,
        )
        .unwrap();
        assert_eq!(resolved.agent_name, None);
        assert!(!resolved.is_script_agent);
        assert!(resolved.agent_args.is_empty());
        assert!(resolved.agent_env.is_empty());
        assert_eq!(resolved.agent_instructions, None);
        assert_eq!(resolved.initial_prompt, "My Task\n\nSee .task.md for full spec.");
    }

    #[test]
    fn resolve_rejects_unknown_cli() {
        let (ws, col, task, _conn) = fixture();
        let err = resolve(
            &task,
            &col,
            &ws,
            None,
            &SpawnOverrides {
                cli: Some("aider"),
                ..Default::default()
            },
            None,
            "claude",
            None,
        );
        assert!(err.is_err());
    }
}
