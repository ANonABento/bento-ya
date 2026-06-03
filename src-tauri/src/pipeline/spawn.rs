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
//! trigger > task > column > workspace > global > default
//! ```
//!
//! It is deliberately **`AppHandle`-free and pure** (takes `&Task` / `&Column`
//! / `&Workspace` and plain defaults, returns data) so it is fully
//! unit-testable. All side effects — worktree creation, `.task.md` writing, DB
//! writes, the actual process launch, event emission — stay in the thin
//! spawn/emit wrappers that call this.

use std::collections::HashMap;

use crate::db::{Column, Task, Workspace};
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
}

/// Resolve the full spawn parameter set for a trigger-driven agent. Pure: no
/// `AppHandle`, no DB, no filesystem writes. The only filesystem reads are the
/// worktree-existence check inside [`resolve_working_dir`] and the CLI-path
/// validation inside `validate_agent_cli_path`.
///
/// `default_cli` / `default_model` carry the workspace+global tiers (the caller
/// derives them from `EffectivePipelineSettings`); `prev_column` feeds the
/// template context so `{prev_column.*}` variables interpolate.
pub(crate) fn resolve(
    task: &Task,
    column: &Column,
    workspace: &Workspace,
    prev_column: Option<&Column>,
    overrides: &SpawnOverrides,
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

    // CLI: trigger config > workspace/global default. User-editable JSON is
    // normalized through the same backend allowlist used by direct agent
    // commands before it reaches the shell launcher.
    let raw_cli_type = overrides
        .cli
        .filter(|c| !c.trim().is_empty())
        .map(|c| c.to_string())
        .unwrap_or_else(|| default_cli.to_string());
    let cli_type = if raw_cli_type.trim() == "auto" {
        "codex".to_string()
    } else {
        crate::commands::agent::validate_agent_cli_path(&raw_cli_type)?
    };

    // Prepend slash command if provided.
    let initial_prompt = match overrides.command {
        Some(cmd) if resolved_prompt.is_empty() => cmd.to_string(),
        Some(cmd) => format!("{}\n\n{}", cmd, resolved_prompt),
        None => resolved_prompt,
    };

    // Runtime mode: `normalize_agent_runtime_mode` downgrades `interactive`
    // to `terminal` when the dev flag is unset or the CLI is unsupported.
    let runtime_mode = normalize_agent_runtime_mode(overrides.runtime_mode, &cli_type).to_string();

    // Model: task override > trigger config > workspace/global default.
    let model = resolve_model_override(task.model.as_deref(), overrides.model, default_model);

    Ok(ResolvedAgentSpawn {
        cli_type,
        model,
        runtime_mode,
        working_dir,
        initial_prompt,
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
            "claude",
            None,
        );
        assert!(err.is_err());
    }
}
