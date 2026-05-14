# Phase 3 — Codex Parity

## Context

Phases 1 + 2 shipped interactive mode for Claude end-to-end: a user can opt a task into interactive mode, see the Claude Code TUI in the agent panel, type into a live input box, interrupt, switch models, and restart. Phase 3 extends the same patterns to the **Codex** CLI.

Codex has an equivalent split: `codex exec --json '<prompt>'` (headless) vs `codex` alone (interactive REPL). The slash command vocabulary differs slightly (`/quit` instead of `/exit`), and `/model` support mid-conversation is not guaranteed on all Codex releases — verify before shipping.

**Read first:**
1. [`README.md`](README.md) in this folder.
2. Phase 1 + 2 status sections in [`.tickets/_docs/AGENT_PANEL_MODES.md`](../_docs/AGENT_PANEL_MODES.md) § Phasing — these tell you what shipped, what diverged, what to watch.
3. `src-tauri/src/chat/bridge.rs` — find `build_codex_streaming_command` and the existing codex handling in `build_trigger_command`.
4. The Phase 1 + 2 PRs to see how Claude's interactive path was implemented; you're mirroring the structure.

## Goal

A user can set `cli: "codex"` on a trigger with `runtime_mode: "interactive"` and get the same behavior as Phase 1+2 delivered for Claude: TUI in the agent panel, live input injection, interrupt / model switch / restart controls. All Tauri commands from Phase 2 (`agent_inject_message`, `agent_interrupt`, `agent_switch_model`, `agent_restart`) work for codex with the same call signatures.

## Scope (do this)

### Verify Codex CLI behavior first

Before writing code, manually validate against the actual `codex` binary on the system:

1. Does `codex --append-system-prompt "..."` work, or is there a different flag? If neither, the sentinel must be inlined in the initial prompt (`"<task>\n\nWhen done, output: <<<KAITENCODE_DONE:{id}>>>"`).
2. Does `/model <name>` work mid-conversation? If not, the model switch button must do "Restart with --model X" instead.
3. What does Codex's input prompt indicator look like? (Needed for ready-detection in the spawn helper.)
4. Confirm `/quit` (or whichever exit command) leaves the shell clean for restart.

**Document findings in this phase's status section.** If any of these block parity, surface to the user before proceeding — don't ship a degraded Codex experience that pretends to be feature-equivalent.

### Implementation

5. **`spawn_interactive_codex` helper** in `src-tauri/src/chat/bridge.rs` — parallel to `spawn_interactive_claude` from Phase 1. Same shape, codex-specific flags:
   - `codex [args]` (no `exec`)
   - Sentinel: append via `--append-system-prompt` if supported, else prefix the initial prompt
   - Ready-poll for the codex prompt indicator
   - Same `tmux send-keys -l + Enter` injection pattern

6. **Dispatch update** in `execute_spawn_cli` (triggers.rs): the `cli == "claude" && interactive` branch from Phase 1 becomes `cli in ("claude", "codex") && interactive`, routing each to its respective spawn helper.

7. **`agent_switch_model` codex branch**:
   - If `/model` mid-conversation verified: send `/model <name>` + Enter (same as Claude).
   - If NOT: the command becomes a full restart with `--model <name>` flag. Surface this difference in the UI (button label changes to "Switch & Restart" when cli=codex and the flag is unverified). Read the agent's cli from the task's resolved trigger config so the frontend can adjust.

8. **`agent_restart` codex branch**: same as Claude restart but uses `/quit` (or whichever exit codex needs).

9. **Sentinel detection is unchanged.** The watcher from Phase 1 polls `tmux capture-pane` and matches `<<<KAITENCODE_DONE:{task_id}>>>`. CLI-agnostic.

10. **`agent_inject_message`, `agent_interrupt` are unchanged.** They're tmux-level operations that don't care which CLI is running.

### Tests

11. Unit tests for `spawn_interactive_codex` command shape, mirroring Phase 1's claude tests.
12. Update the dispatcher tests in `triggers.rs` to cover the codex interactive branch.
13. Integration test (`#[ignore]` if it needs a real codex binary): same shape as Phase 1's claude integration test.

## Scope (do NOT do)

- **No new UI components.** The control bar from Phase 2 already works — adjust button labels conditionally on `cli`, don't build a parallel codex view.
- **No model dropdown changes** beyond the conditional label. The list of supported models comes from settings store, same as Claude.
- **No fancy "auto-detect codex features" runtime probe.** If a feature isn't supported on the user's codex version, gate it statically based on the version string we ship against, surface honestly.

## Definition of done

1. `cargo check && cargo test && npm run lint && npx tsc --noEmit && npm test` all pass.
2. New unit + integration tests pass.
3. Manual verification: create a task with `cli: "codex"`, `runtime_mode: "interactive"`. Confirm:
   - Codex TUI renders in agent panel.
   - Type a message → injected into live codex.
   - Interrupt works.
   - Model switch works (whatever path you chose — direct slash or restart).
   - Restart works.
   - Sentinel detection completes the task.
4. Phase 3 status appended to plan doc with the codex feature-support findings (which flags worked, which didn't, what fallbacks shipped).

## Known gotchas

- **Codex output is differently formatted from Claude.** Don't assume your sentinel regex from Phase 1 will work without adjustment — codex might wrap output, add prefixes, etc. Test against real codex output.
- **`codex exec` vs `codex` mode confusion in the codebase.** Today the headless codex path uses `codex exec --json`. Don't accidentally break that when adding the interactive branch. Both must coexist.
- **Codex session-id semantics.** May differ from Claude. If `--resume` works differently or not at all, document it; Phase 4's settings work needs to know.

## After you're done

Append a Phase 3 status section to the plan doc:
- Which codex features worked, which didn't
- Fallback choices made (e.g. "model switch is restart-with-flag for codex 1.2.x")
- Anything the model dropdown UI needs to know about codex limits

Then stop. Surface to the user for review.
