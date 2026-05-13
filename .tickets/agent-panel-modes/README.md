# /goal — Agent Panel Modes Rollout (6 Phases)

You're implementing a multi-phase feature: adding **interactive** runtime mode to bento-ya alongside the existing **headless** mode (`claude -p` / `codex exec`). Full design lives in [`.tickets/_docs/AGENT_PANEL_MODES.md`](../_docs/AGENT_PANEL_MODES.md). Each phase has its own handoff prompt in this directory.

## Motivation

Starting 2026-06-15, paid Claude plans get a fixed monthly Agent SDK credit that covers `claude -p` and Agent SDK invocations; overage bills at API rates. Interactive `claude` draws from subscription interactive limits, not the SDK credit. Beyond the billing dimension, interactive mode also lets users supervise and redirect running agents instead of being passive observers of headless `-p` output.

## Sequence

Execute phases strictly in order. **Do not start phase N+1 until phase N is:**
1. Implemented per its prompt's "Definition of done"
2. Manually verified by the user (running app, real `claude` binary)
3. Merged (or staged for merge)
4. Documented in [`.tickets/_docs/AGENT_PANEL_MODES.md`](../_docs/AGENT_PANEL_MODES.md) § Phasing

## Phase files

| # | File | Scope | Effort |
|---|------|-------|--------|
| 1 | [`phase-1-backend-interactive-spawn.md`](phase-1-backend-interactive-spawn.md) | Backend spawn + sentinel completion for Claude (dev-flag gated, no UI) | 1-2 days |
| 2 | [`phase-2-frontend-interactive-view.md`](phase-2-frontend-interactive-view.md) | Panel dispatcher, control bar, live input routing, per-task picker | 2-3 days |
| 3 | [`phase-3-codex-parity.md`](phase-3-codex-parity.md) | Apply Phase 1+2 patterns to codex CLI | 1 day |
| 4 | [`phase-4-settings-surfaces.md`](phase-4-settings-surfaces.md) | Workspace/global defaults, DB migration, telemetry | 1-2 days |
| 5 | [`phase-5-pause-resume.md`](phase-5-pause-resume.md) | Pause/resume controls | 1 day |
| 6 | [`phase-6-polish-docs.md`](phase-6-polish-docs.md) | Onboarding, doc updates, fallback completion detection | 1 day |

**Total:** ~7-10 focused days.

## Critical: do NOT run unattended

This is a 10-day effort touching the agent execution path — the most load-bearing part of bento-ya. **Stop after each phase for the user to:**

- Review the diff
- Manually exercise the running app (real `claude`, not just unit tests)
- Decide whether to adjust the next phase based on what was learned

If a phase reveals something that invalidates the design — e.g., `/model` slash command doesn't actually work mid-conversation, sentinel reliability is below 80%, Claude Code's prompt indicator changed in a release — **STOP and surface it to the user**. Don't paper over with workarounds that compound across phases. Cheap to revisit; expensive to debug after Phase 5.

## Carrying state forward

After each phase, append a status section to [`.tickets/_docs/AGENT_PANEL_MODES.md`](../_docs/AGENT_PANEL_MODES.md) § Phasing with:

- What shipped (file paths, commands added, behaviors enabled)
- What was deferred and why
- Any spec deviations (e.g. "used `>` instead of `╭` for prompt detection")
- Notes for the next phase

The next phase's agent reads this section. It's the project's working memory across handoffs.

## Cross-cutting watch-outs

- **TOS framing.** Interactive mode is for supervised user-driven work — not "free unlimited Claude Code automation." Keep user-facing copy honest. The user is on this carefully.
- **`tmux send-keys` quoting.** Always use `-l` (literal) + separate `Enter`. Never construct keystrokes from unescaped task content.
- **Mode resolution order.** Trigger > task > column > workspace > global > default (`headless`). Get this right once in Phase 2's resolver helper; every later phase wires more storage tiers into it.
- **Backward compatibility.** Existing `AgentRuntimeMode = 'terminal' | 'managed'` columns and triggers must keep working. Both are headless-family. The new `'interactive'` is additive. Do NOT rename until Phase 6 (if at all).
- **Dev flag.** `BENTOYA_INTERACTIVE_MODE_ENABLED=1` gates the entire interactive path through Phase 5. Phase 6 decides if it's promoted to a real setting.

## Start

Read [`.tickets/_docs/AGENT_PANEL_MODES.md`](../_docs/AGENT_PANEL_MODES.md) in full (it's the source of truth), then open [`phase-1-backend-interactive-spawn.md`](phase-1-backend-interactive-spawn.md) and execute.
