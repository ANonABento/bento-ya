# Handoff — Front 3: Unify the agent-spawn path (one `ResolvedAgentSpawn`)

> **Status: ✅ substantially complete (2026-06-05).** Step 1 (the
> `ResolvedAgentSpawn` resolver) is landed: `pipeline::spawn::resolve()` plus the
> shared `model_to_args` (b), `resolve_working_dir` (c), `task_md_default_prompt`
> (d) helpers, and `persist_agent_session_started` for the agent_session writes
> (e). The latent empty-`workspace_id` emit bug (e) is fixed across all
> trigger-lifecycle emits. Helper names were disambiguated (2026-06-05) so the
> remaining "duplication" reads as the by-design split it is.
>
> **What remains is optional and was judged not worth the risk:** Step 2 (collapse
> the two argv families — terminal shell-string vs managed adapter args) touches
> the live headless render for negative clarity gain, since the families encode
> different sandbox/approval contracts. The full per-path agent_session-helper
> merge (e) is similarly blocked by genuine reuse-vs-fresh / managed-vs-interactive
> differences. Don't force a DRY merge there. The original plan follows for
> reference.

## Why this exists

KaitenCode spawns CLI agents (claude / codex) from **5+ entry points**, and the
logic for "given a task, figure out the CLI, model, working dir, prompt, and
make the agent_session row" is **copy-pasted** across them. They drift: a flag
or precedence rule fixed in one path silently stays wrong in the others. This is
the same divergence we already killed for task/entity mutations, applied to the
"run an agent" verb.

**Goal:** one resolver (`ResolvedAgentSpawn`) that every spawn path builds first,
plus one `agent_session` creation helper. Behavior must not change — this is a
consolidation, verified by the existing test suite staying green.

> ⚠️ Line numbers below are approximate (the tree shifted during Fronts 1–2).
> **Anchor on the symbol names — grep for them.** All symbols verified present
> as of this handoff.

## The 5+ spawn entry points (grep these)

| # | Path | Entry symbol | File | argv builder |
|---|---|---|---|---|
| 1 | Headless trigger, `terminal` render | `spawn_cli_trigger_task` | `chat/bridge.rs:~1240` | `build_trigger_command` → `build_claude_streaming_command` / `build_codex_streaming_command` (`bridge.rs:~426/509/581`) — **shell-string + jq** |
| 2 | Headless trigger, `managed` render | `spawn_managed_trigger_task` → `start_managed_trigger_turn` | `pipeline/triggers.rs` | `managed_trigger_turn_args` → `ClaudeCliAdapter/CodexCliAdapter::managed_turn_args` (`chat/runtime.rs:217/322`) — **argv vec** |
| 3 | Interactive trigger | `spawn_interactive_trigger_task` → `spawn_interactive_cli` | `chat/bridge.rs:~2684/2546` | inline arg push in `execute_spawn_cli` (`triggers.rs`) + `build_interactive_claude_argv`/`build_interactive_codex_argv` |
| 4 | Per-task chat, managed turn | `spawn_managed_task_turn` | `commands/agent.rs:~729` | adapters (`managed_turn_args`) |
| 5 | Per-task chat, interactive/terminal turn | `build_task_input_line` (from `send_task_input`) | `commands/agent.rs:~1070/389` | `build_trigger_command` + its **own** model→args (`agent.rs:~1084`) |
| 6 | Chef / orchestrator | `UnifiedChatSession::send_message` | `chat/chef.rs` → `chat/session.rs:~167` | `build_pipe_args_for_cli` (`session.rs:346`) → adapters |
| — | Restart (interactive) | `agent_restart` | `commands/agent_interactive.rs:152` | own working-dir + model→args (`~184`) |
| — | retry / retry_from_start / queue-promote / dep `on_met` | — | `commands/task.rs`, `triggers.rs` | **already funnel through `pipeline::fire_trigger` → `execute_spawn_cli`** — no divergence, leave alone |

## What's duplicated (the actual work to remove)

**(b) `model → ["--model", m]` resolution — 4 copies.** `execute_spawn_cli`
(`triggers.rs`), `build_task_input_line` (`agent.rs`), `agent_restart`
(`agent_interactive.rs`), and inside the adapters. A canonical
`resolve_model_override` already exists at `triggers.rs:987` but **only the
pipeline path uses it**; agent.rs and agent_interactive.rs re-implement the
precedence/empty-string handling ad hoc.

**(c) working-dir resolution — 3 copies.** `resolve_working_dir` (`triggers.rs:978`),
`resolve_task_working_dir` (`agent.rs:140`), and an inline copy in `agent_restart`.
All compute `worktree_path if exists else repo_path`.

**(d) prompt-default — 2 copies.** `format!("{}\n\nSee .task.md for full spec.", task.title)`
appears in `triggers.rs` and `agent_interactive.rs` (tied to the `.task.md`
token-optimization convention).

**(e) `agent_session` row creation — 3 copies.** `spawn_cli_trigger_task`
(`bridge.rs:~1271`), `spawn_interactive_trigger_task` (`bridge.rs:~2700`), and the
per-task chat path. Each independently: `insert_agent_session` (or reuse a
persistent one), `update_agent_session_runtime`, `update_agent_session_model`,
`update_task_agent_status`, set `tasks.agent_session_id`, then
`emit_tasks_changed(app, "", "agent_session_created")`.
**🐞 Latent bug to fix here:** both bridge paths pass an **empty `workspace_id`**
(`""`) to that emit, so the `tasks:changed` event carries no workspace and the
frontend filter (`payload.workspaceId === workspaceId` in `useTaskSync`) drops
it. Thread the real `workspace_id` through when extracting the helper.

**(f) Two argv families that can drift.** Managed mode (#2, #4, #6) correctly
converges on `ClaudeCliAdapter/CodexCliAdapter::managed_turn_args`
(`runtime.rs`). The terminal/interactive family (#1, #3, #5, restart) builds a
**separate shell string** via `build_trigger_command` → `build_claude_streaming_command`
(`bridge.rs:509`) that re-lists `--print --output-format stream-json --verbose --model …`
plus a jq filter — with no relationship to the adapter args. Add a flag to the
adapter and you have to remember to also edit the shell-string builder.

**(note) Existing types that are NOT the answer.** `SpawnConfig`
(`chat/transport.rs:~28`) only describes a single process launch for
`ChatTransport::spawn` — no model/runtime_mode/cli_type/resume/agent_session
concept. `SessionConfig` (`chat/session.rs:~45`) is closest (cli_path / model /
system_prompt / working_dir / effort) but is private to the chat-session layer
and unused by the pipeline trigger path.

## Recommended approach (ranked, do in order)

### Step 1 — `ResolvedAgentSpawn` + one `resolve()` (highest payoff, lowest risk)
Introduce a struct (new module, e.g. `chat::spawn` or `pipeline::spawn`):
```rust
pub struct ResolvedAgentSpawn {
    pub cli_type: String,          // "claude" | "codex" | other
    pub model: Option<String>,     // already-resolved, empty-string-normalized
    pub runtime_mode: String,      // "terminal" | "managed" | "interactive"
    pub working_dir: String,       // worktree-or-repo, already resolved
    pub resume_id: Option<String>,
    pub initial_prompt: String,    // with .task.md default applied
    pub include_sentinel: bool,
    pub env: Vec<(String, String)>,
}
pub fn resolve(task: &Task, column: &Column, workspace: &Workspace,
               settings: &AppSettings, trigger_overrides: Option<&...>) -> ResolvedAgentSpawn;
```
`resolve()` is the ONE place the documented precedence lives
(`trigger > task > column > workspace > global > default` — see CLAUDE.md and
`resolve_runtime_mode_for_task`). Reuse `resolve_model_override`,
`resolve_working_dir`, and the runtime-mode resolver inside it. Then have
`execute_spawn_cli`, `spawn_managed_task_turn`, `send_task_input`, and
`agent_restart` each build a `ResolvedAgentSpawn` first and read from it. This
kills duplications (b), (c), (d) immediately.

### Step 2 — collapse the two argv families
Make `build_trigger_command` (terminal/shell-string path) derive its base flags
from the same `ClaudeCliAdapter`/`CodexCliAdapter` the managed path uses, so a
new flag added to the adapter automatically reaches both. The jq-wrapping is the
only legitimately terminal-specific part — keep that, share everything else.
Medium risk: this touches the live headless render. Lean on the existing
`bridge.rs` argv tests (`test_build_trigger_command_*`,
`test_build_claude_streaming_command_*`).

### Step 3 — one `agent_session` creation helper
Extract `create_or_reuse_agent_session(conn, task, cli, working_dir, runtime_mode, model) -> AgentSession`
used by both bridge spawn fns and the chat path. Fix the empty-`workspace_id`
emit (bug above) while you're in there.

## ⚠️ The test-typing landmine (read before you start)

The same constraint that blocked chef-move parity in Front 1 applies here:
**`execute_single_tool` in `llm/executor.rs` is deliberately `AppHandle`-free**
because its unit tests can't construct a Wry `AppHandle` (mock runtime is
`AppHandle<MockRuntime>`, the code wants `AppHandle<Wry>`; they don't unify).
Any fn requiring `&AppHandle` cannot be unit-tested the same way.

Practical consequences:
- Keep `resolve()` and argv builders **`AppHandle`-free and pure** (take
  `&Task`/`&Column`/`&Workspace`/`&AppSettings`, return data). Then they're
  fully unit-testable — write tests asserting model/cwd/prompt/runtime_mode
  resolution and argv contents for claude+codex × terminal+managed+interactive.
- Confine `&AppHandle` to the thin spawn/emit wrappers (the agent_session
  helper, the actual process launch), which stay covered by integration-level
  behavior, not unit tests.
- This split is also *why* Step 1 is low-risk: the hard-to-test part (resolution
  + argv) becomes pure and testable; only the already-untested launch glue
  stays untested.

## Verification
- `cargo test --lib` (currently **468 passing**) must stay green — especially
  the `bridge.rs` argv/escaping/sentinel tests and `agent.rs`
  `build_task_input_line_*` tests.
- Add unit tests for `resolve()` covering the precedence chain and for the
  collapsed argv builder (claude/codex × terminal/managed/interactive, with and
  without resume_id / model / sentinel).
- Manual smoke (needs the app + `KAITENCODE_INTERACTIVE_MODE_ENABLED=1`): fire a
  headless trigger, a managed trigger, an interactive trigger, a per-task chat
  turn, and `agent_restart` — confirm each still spawns with the right model,
  cwd, and prompt, and that `tasks:changed` now carries the correct workspaceId
  (verify the live card updates, which it didn't before the (e) bug fix).

## Definition of done
- One `ResolvedAgentSpawn::resolve()` built by all of #1, #3, #4, #5, restart.
- `resolve_model_override` / working-dir / prompt-default each have exactly one
  implementation.
- One `agent_session` creation helper; empty-`workspace_id` emit bug fixed.
- Terminal and managed argv share the adapter as their base.
- All existing tests green + new resolver/argv unit tests added.
