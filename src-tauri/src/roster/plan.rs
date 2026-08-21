//! Turning an agent *definition* into spawn parameters.
//!
//! This is the piece the module docs anticipated: still no execution here, just
//! "what would running this agent look like". [`crate::pipeline::spawn::resolve`]
//! consumes the result and applies precedence against the task/column/workspace
//! tiers; the actual launch stays in `chat::bridge`.
//!
//! ## Why instructions ship as a file, not a system-prompt flag
//!
//! An agent's instructions have to reach three runtimes across three runtime
//! modes, and there is no flag that spans them:
//!
//! - **codex has no system-prompt flag at all** (verified against codex-cli
//!   0.145.0 — assuming otherwise is what broke every sentinel-carrying column
//!   before).
//! - **claude's `--append-system-prompt` is last-wins, not cumulative**
//!   (verified against 2.1.239). Interactive mode already spends that flag on
//!   the done-sentinel and appends it *after* user args, so routing agent
//!   instructions through it would silently drop them in exactly the columns
//!   most likely to use an agent.
//! - **script agents have no prompt concept whatsoever.**
//!
//! So instructions are written to `.agent.md` in the working directory and the
//! prompt points at them — the same convention `.task.md` already established
//! for the task spec. One mechanism, no flag-existence assumptions, and
//! switching a column between headless and interactive can't change what the
//! agent was told. Runtime mode is a rendering and billing choice; it has no
//! business altering behaviour.

use std::collections::BTreeMap;

use crate::db::{Agent, Skill};

use super::{parse_and_validate, AgentConfig, LlmConfig, ScriptConfig};

/// The filename an attached agent's instructions are written to, alongside the
/// `.task.md` the trigger already writes.
pub const AGENT_INSTRUCTIONS_FILE: &str = ".agent.md";

/// Everything an attached agent contributes to a spawn, with nothing resolved
/// against the column/task tiers yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentSpawnPlan {
    /// Display name, for errors and telemetry.
    pub agent_name: String,
    /// What to execute: `claude`, `codex`, or a script agent's own command.
    pub command: String,
    /// True when `command` is a user-authored script rather than a known CLI.
    /// The CLI allow-list does not apply to these — see `pipeline::spawn`.
    pub is_script: bool,
    /// The agent's preferred model. A column or task may still override it;
    /// everything else about the agent is the agent's own.
    pub model: Option<String>,
    /// Rendered instructions + skills for `.agent.md`. `None` for script
    /// agents, which have no prompt.
    pub instructions: Option<String>,
    /// Extra argv: MCP flags for LLM agents, the command's own args for
    /// script agents.
    pub args: Vec<String>,
    /// Environment overrides. Script agents only.
    pub env: BTreeMap<String, String>,
}

/// Build the spawn plan for an agent, given the skills it references.
///
/// `skills` is the resolved subset — dangling ids are dropped by the caller
/// rather than failing, matching how the dossier renders them as "missing".
pub fn plan_for(agent: &Agent, skills: &[Skill]) -> Result<AgentSpawnPlan, String> {
    let config = parse_and_validate(&agent.runtime, &agent.config)?;

    Ok(match &config {
        AgentConfig::Claude(llm) => llm_plan(agent, "claude", llm, skills),
        AgentConfig::Codex(llm) => llm_plan(agent, "codex", llm, skills),
        AgentConfig::Script(script) => script_plan(agent, script),
    })
}

fn llm_plan(agent: &Agent, cli: &str, llm: &LlmConfig, skills: &[Skill]) -> AgentSpawnPlan {
    let mut args = Vec::new();

    // `--allowedTools` only means anything alongside an MCP config — the pair
    // is validated together in `roster::validate_llm`, so by here either both
    // are set or the allow-list is empty. `--strict-mcp-config` keeps the
    // user's own ~/.claude servers out, matching how chef sessions load theirs.
    if !llm.mcp_config_path.trim().is_empty() {
        args.push("--strict-mcp-config".to_string());
        args.push("--mcp-config".to_string());
        args.push(llm.mcp_config_path.trim().to_string());
        if !llm.allowed_tools.is_empty() {
            args.push("--allowedTools".to_string());
            args.push(llm.allowed_tools.join(","));
        }
    }

    AgentSpawnPlan {
        agent_name: agent.name.clone(),
        command: cli.to_string(),
        is_script: false,
        model: non_empty(&llm.model),
        instructions: render_instructions(agent, llm, skills),
        args,
        env: BTreeMap::new(),
    }
}

fn script_plan(agent: &Agent, script: &ScriptConfig) -> AgentSpawnPlan {
    AgentSpawnPlan {
        agent_name: agent.name.clone(),
        command: script.command.trim().to_string(),
        is_script: true,
        model: None,
        // A script has no prompt to carry, so no `.agent.md` is written.
        instructions: None,
        args: script.args.clone(),
        env: script.env.clone(),
    }
}

/// Render `.agent.md`: who the agent is, its instructions, and the skills it
/// can reach for.
///
/// Returns `None` when there is genuinely nothing to say, so a bare agent
/// doesn't get a near-empty file and a prompt line pointing at it.
fn render_instructions(agent: &Agent, llm: &LlmConfig, skills: &[Skill]) -> Option<String> {
    let prompt = llm.system_prompt.trim();
    if prompt.is_empty() && skills.is_empty() {
        return None;
    }

    let mut out = format!("# {}\n", agent.name.trim());
    if !agent.role.trim().is_empty() {
        out.push_str(&format!("\n{}\n", agent.role.trim()));
    }

    if !prompt.is_empty() {
        out.push_str("\n## Instructions\n\n");
        out.push_str(prompt);
        out.push('\n');
    }

    if !skills.is_empty() {
        out.push_str("\n## Skills\n\n");
        out.push_str(
            "Capabilities available to you. Reach for one when its situation applies.\n\n",
        );
        for skill in skills {
            out.push_str(&format!("### {}\n\n", skill.name.trim()));
            if !skill.description.trim().is_empty() {
                out.push_str(&format!("{}\n\n", skill.description.trim()));
            }
            if !skill.trigger.trim().is_empty() {
                out.push_str(&format!("Use when: {}\n\n", skill.trigger.trim()));
            }
            if !skill.script.trim().is_empty() {
                out.push_str(&format!("```sh\n{}\n```\n\n", skill.script.trim()));
            }
        }
    }

    Some(out)
}

/// The one-line prompt suffix pointing the agent at its instructions file.
///
/// Newline-free on purpose: in interactive mode the prompt is injected as a
/// single `tmux send-keys -l` payload, where a literal newline submits early.
pub fn instructions_prompt_suffix() -> String {
    format!("Follow the instructions in {}.", AGENT_INSTRUCTIONS_FILE)
}

fn non_empty(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent(runtime: &str, config: &AgentConfig) -> Agent {
        Agent {
            id: "agent-1".into(),
            name: "Code Smith".into(),
            role: "Implements the task in its worktree".into(),
            runtime: runtime.into(),
            config: serde_json::to_string(config).unwrap(),
            avatar: "{}".into(),
            created_at: "2026-08-21T00:00:00Z".into(),
            updated_at: "2026-08-21T00:00:00Z".into(),
        }
    }

    fn skill(name: &str, trigger: &str, script: &str) -> Skill {
        Skill {
            id: format!("skill-{}", name),
            name: name.into(),
            description: format!("{} does a thing", name),
            trigger: trigger.into(),
            script: script.into(),
            created_at: "2026-08-21T00:00:00Z".into(),
            updated_at: "2026-08-21T00:00:00Z".into(),
        }
    }

    #[test]
    fn llm_runtime_maps_to_its_cli() {
        for (runtime, cli) in [("claude", "claude"), ("codex", "codex")] {
            let cfg = AgentConfig::default_for(runtime).unwrap();
            let plan = plan_for(&agent(runtime, &cfg), &[]).unwrap();
            assert_eq!(plan.command, cli);
            assert!(!plan.is_script);
            assert!(plan.env.is_empty());
        }
    }

    #[test]
    fn script_runtime_carries_command_args_and_env() {
        let mut env = BTreeMap::new();
        env.insert("RENDER_THREADS".to_string(), "8".to_string());
        let cfg = AgentConfig::Script(ScriptConfig {
            command: "./render.sh".into(),
            args: vec!["--preset".into(), "high".into()],
            env,
        });
        let plan = plan_for(&agent("script", &cfg), &[]).unwrap();
        assert_eq!(plan.command, "./render.sh");
        assert!(plan.is_script);
        assert_eq!(plan.args, vec!["--preset".to_string(), "high".to_string()]);
        assert_eq!(plan.env.get("RENDER_THREADS").map(String::as_str), Some("8"));
        // A script has no prompt, so nothing to write to `.agent.md`.
        assert_eq!(plan.instructions, None);
        assert_eq!(plan.model, None);
    }

    #[test]
    fn mcp_config_becomes_strict_flags_and_allow_list() {
        let cfg = AgentConfig::Claude(LlmConfig {
            mcp_config_path: "  /tmp/mcp.json  ".into(),
            allowed_tools: vec!["get_board".into(), "get_task".into()],
            ..Default::default()
        });
        let plan = plan_for(&agent("claude", &cfg), &[]).unwrap();
        assert_eq!(
            plan.args,
            vec![
                "--strict-mcp-config".to_string(),
                "--mcp-config".to_string(),
                // Trimmed — a stray space would make the path unopenable.
                "/tmp/mcp.json".to_string(),
                "--allowedTools".to_string(),
                "get_board,get_task".to_string(),
            ]
        );
    }

    #[test]
    fn no_mcp_config_means_no_flags() {
        let cfg = AgentConfig::default_for("claude").unwrap();
        assert!(plan_for(&agent("claude", &cfg), &[]).unwrap().args.is_empty());
    }

    #[test]
    fn blank_model_means_cli_default_not_an_empty_flag() {
        let cfg = AgentConfig::Claude(LlmConfig {
            model: "   ".into(),
            ..Default::default()
        });
        assert_eq!(plan_for(&agent("claude", &cfg), &[]).unwrap().model, None);
    }

    #[test]
    fn instructions_carry_prompt_and_skills() {
        let cfg = AgentConfig::Claude(LlmConfig {
            system_prompt: "Implement it, then run the tests.".into(),
            ..Default::default()
        });
        let skills = vec![skill("Run tests", "before handing work back", "npm test")];
        let md = plan_for(&agent("claude", &cfg), &skills)
            .unwrap()
            .instructions
            .expect("instructions");

        assert!(md.starts_with("# Code Smith"));
        assert!(md.contains("Implements the task in its worktree"));
        assert!(md.contains("Implement it, then run the tests."));
        assert!(md.contains("### Run tests"));
        assert!(md.contains("Use when: before handing work back"));
        assert!(md.contains("```sh\nnpm test\n```"));
    }

    #[test]
    fn a_bare_agent_gets_no_instructions_file() {
        // Otherwise a prompt would point the agent at a file saying nothing.
        let cfg = AgentConfig::default_for("claude").unwrap();
        assert_eq!(plan_for(&agent("claude", &cfg), &[]).unwrap().instructions, None);
    }

    #[test]
    fn skills_alone_are_enough_to_warrant_instructions() {
        let cfg = AgentConfig::default_for("codex").unwrap();
        let skills = vec![skill("Lint", "after editing", "npm run lint")];
        let md = plan_for(&agent("codex", &cfg), &skills)
            .unwrap()
            .instructions
            .expect("skills alone should still produce a file");
        assert!(md.contains("## Skills"));
        assert!(!md.contains("## Instructions"));
    }

    #[test]
    fn a_runtime_config_mismatch_is_refused() {
        // agents.runtime is plain TEXT, so a hand-edited row can disagree with
        // the tag inside agents.config. Better to refuse than to spawn codex
        // believing it is claude.
        let cfg = AgentConfig::Script(ScriptConfig {
            command: "ls".into(),
            ..Default::default()
        });
        let mut a = agent("script", &cfg);
        a.runtime = "claude".into();
        assert!(plan_for(&a, &[]).is_err());
    }

    #[test]
    fn the_prompt_suffix_stays_newline_free() {
        // Interactive mode injects the prompt as one `tmux send-keys -l`
        // payload; a literal newline submits the line early in the TUI.
        let suffix = instructions_prompt_suffix();
        assert!(!suffix.contains('\n'), "{:?}", suffix);
        assert!(suffix.contains(AGENT_INSTRUCTIONS_FILE));
    }
}
