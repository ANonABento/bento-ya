# Phase 6 — Polish, Fallback Detection, Docs

## Context

Phases 1-5 shipped interactive mode end-to-end for Claude and Codex with full settings storage, telemetry, pause/resume, and per-task override. Phase 6 is the polish phase: read Phase 4's telemetry to decide whether to add the idle-prompt-detector fallback, promote the dev flag if everything is stable, update all docs to reflect shipped state, and harden user-facing copy.

This phase is judgment-heavy. Don't mechanical-execute it — read the data, make calls, document.

**Read first:**
1. [`README.md`](README.md) in this folder.
2. All Phase 1-5 status sections in [`.tickets/_docs/AGENT_PANEL_MODES.md`](../_docs/AGENT_PANEL_MODES.md) § Phasing.
3. Phase 4's telemetry view in the settings panel — actually look at the numbers. If you don't have dogfooding data, run a dozen interactive tasks first and let the data accumulate.
4. `CLAUDE.md` § "Agent Execution" — to know what needs updating.
5. [`.tickets/_docs/INTERACTIVE_AGENT_TERMINAL.md`](../_docs/INTERACTIVE_AGENT_TERMINAL.md) — needs a header pointing here as the executed plan.
6. [`.tickets/_docs/UNIVERSAL_AGENT_RUNTIME.md`](../_docs/UNIVERSAL_AGENT_RUNTIME.md) — same.

## Goal

The feature is shippable to all users: dev flag removed (or kept opt-in with a clear settings-panel toggle), docs match reality, edge cases are handled, and the completion-detection story is solid based on real data.

## Scope (do this)

### Decision 1 — idle-prompt-detector fallback

Read the `agent_completion_events` telemetry from Phase 4. Compute, over the last N interactive tasks:
- Sentinel hit rate: `sentinel / (sentinel + timeout + manual)` — excluding `kill` (user-initiated)
- Median time-to-sentinel for sentinel completions
- Manual completion rate (proxy for "agent finished but didn't sentinel")

**Decision rule:**
- Sentinel rate ≥ 90%: don't ship the fallback. Sentinel is reliable enough.
- 80-90%: ship the fallback as opt-in (settings toggle).
- < 80%: ship the fallback on by default. Document why.

If shipping the fallback:
1. New module: `interactive_idle_detector` watching `tmux capture-pane` for the input prompt indicator (the same string Phase 1 found for ready-detection) staying visible with no byte changes for N seconds (configurable, default 90s).
2. When triggered: mark the task as "ready for review" (NOT auto-complete) — different from sentinel which auto-completes. User must click to advance.
3. Telemetry event with `completion_source: 'idle_detector'`.

### Decision 2 — dev flag promotion

Read app stability data. Have you had any reports of:
- Tasks stuck in interactive mode with no escape?
- Tmux session leaks?
- Sentinel false positives marking work complete prematurely?
- Performance issues from the watcher tasks?

If clean for 2+ weeks of dogfooding:
- Remove `BENTOYA_INTERACTIVE_MODE_ENABLED` env flag.
- Replace with a settings toggle "Enable interactive runtime mode" (default ON for new installs, opt-in for upgrades for one release, then default ON).

If not clean: keep the flag, document the issues, defer promotion to a follow-up ticket.

### Decision 3 — mode naming

The codebase has `'terminal' | 'managed' | 'interactive'`. The plan suggested collapsing to `'headless' | 'interactive'` with a render sub-toggle. By now, you should know:
- Whether the bubbles vs terminal render distinction matters in practice
- Whether users find "terminal"/"managed" naming confusing

If yes to both → do the collapse: rename internally, keep aliases in the serde deserializer, update UI labels. Migration: existing data parses through aliases, new data writes the new names.

If no → keep current naming. Document the decision in the plan doc with reasoning.

### Polish

7. **User-facing copy review** — every tooltip, placeholder, error message:
   - Honest about pause limitations
   - Honest about interactive mode being for supervised work (not "free unlimited automation")
   - Honest about model switch behavior per CLI (especially codex if it ended up being restart-based)
   - Clear about "Effective: X (from Y)" resolution hints

8. **CLAUDE.md updates** — update the "Agent Execution" section to reflect the new mode taxonomy, control bar, resolver hierarchy. Add a § "Runtime Modes" subsection with a quick reference table.

9. **Design doc updates**:
   - `INTERACTIVE_AGENT_TERMINAL.md` — add header banner pointing to `AGENT_PANEL_MODES.md` as the executed plan. Don't delete it; it's historical context.
   - `UNIVERSAL_AGENT_RUNTIME.md` — same. Note in its current-state section that interactive mode now exists.
   - `AGENT_PANEL_MODES.md` — final § Phasing status, full retrospective: what worked, what didn't, what we'd do differently. Mark the doc "shipped" in the header.

10. **Onboarding wizard touch-up** (Phase 4 added the runtime-mode step; refine it):
    - Better explanation of the trade-off (billing implications, supervision requirement)
    - Link to docs for users who want to read more
    - Sensible defaults that match common usage

11. **Telemetry view polish**:
    - Settings panel completion view: chart over time, not just a table
    - Surface the sentinel hit rate prominently as a health indicator

### Final test pass

12. Full regression sweep — run the existing WebDriver E2E + Vitest + cargo test suites. Catch anything that the 5 phases of churn broke.
13. Performance check — confirm the watcher tasks aren't burning CPU. Open Activity Monitor / `top` with 5 concurrent interactive tasks running, verify reasonable utilization.

## Scope (do NOT do)

- **No new features.** Phase 6 is closing out, not extending. If you find a feature gap, file a follow-up ticket; don't smuggle it in.
- **No breaking config changes** for users who set up runtime modes during Phase 4. Migrations only; no requiring users to redo their settings.
- **No new agents.** "Add Gemini / Bedrock support" is a different project.

## Definition of done

1. All previous phases' "Definition of done" still pass (regression).
2. Telemetry decision documented with the numbers that drove it.
3. If fallback shipped: idle-prompt-detector works and has tests.
4. Dev flag decision documented; settings toggle exists if promoted.
5. Mode naming decision documented; rename done if chosen.
6. CLAUDE.md, plan doc, INTERACTIVE_AGENT_TERMINAL.md, UNIVERSAL_AGENT_RUNTIME.md all reflect shipped state.
7. Manual end-to-end: a user upgrading from pre-Phase-1 bento-ya:
   - Sees no breaking change.
   - Can opt into interactive mode via settings UI.
   - Hits no bugs in the happy path of creating an interactive task and running it through to completion.

## Known gotchas

- **Don't ship the fallback "because it's defensive."** If sentinel reliability is 95%, the fallback is dead code that complicates the completion path. Be willing to NOT ship a planned feature when data says it's not needed.
- **Mode rename has surprising blast radius.** Searches for `"terminal"` and `"managed"` in the codebase will hit a lot of legitimate uses. Use compiler errors from the type system to find the migration sites, not search-and-replace.
- **Dev flag removal is one-way.** Once removed, users can't disable the path. Be confident before doing it. Better to keep the flag for an extra release than to disable production tasks.
- **Onboarding regression.** New-install flow has lots of moving parts. Test on a clean DB with no settings file.

## After you're done

Final status section in plan doc:
- All 6 phases shipped
- Total elapsed days
- Decisions and reasoning for each open question
- Known follow-up work as bullet points (file as separate tickets)
- Retrospective: what should have been a different phase split, what was harder than expected

Stop. Feature is done. Hand back to the user for one final review pass before merge.
