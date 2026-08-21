# KaitenCode Roadmap

> Authoritative "what's done / what's left" as of **2026-06-12**, verified against
> `main` HEAD. Supersedes the tier table in [STATUS.md](./STATUS.md) and the
> session-scoped [handoffs/REMAINING_WORK.md](./handoffs/REMAINING_WORK.md) (both
> kept for history). Released: **v1.0.0** (Linux `.deb` + AppImage, 2026-06-07).

Context: the goal is to **daily-drive KaitenCode as the primary surface for
agent-driven dev work** (in place of raw terminals). Priorities below are ranked
by that goal — interactive-mode reliability first, since it's the path that
replaces the terminal.

---

## ✅ Shipped & wired

- Source-of-truth refactor (Fronts 1–3): all surfaces (UI / HTTP API / MCP / chef)
  funnel through shared `pipeline::*_service`; MCP routes through `/api/*`.
- Reliability cluster (PR #256): queue-stall, worktree leak, startup false-success,
  over-spawn, sentinel scan — fixed before v1.
- Interactive mode (PR #257): real `claude`/`codex` TUI in per-task tmux, opt-in
  setting + per-chat toggle.
- Terminal-harness B1–B4: create-UI options, interactive promotion, chef terminal,
  CLI health check.
- Local HTTP API on by default (PR #258).
- Discord MVP (PR #260): task→thread + agent-output streaming (one-way).
- Trigger UX redesign phase 1 (PR #261): sentence-builder + recipes.
- Settings runtime tab (PR #262): backend `AppSettings` via System → Runtime.
- MCP: 25 tools; source attribution + recursion guard (migration 046);
  mark_complete/dependencies route through `/api/*`.
- Interactive codex parity + adaptive readiness: codex's `--append-system-prompt`
  was invalid (**confirmed** against codex-cli 0.145.0 — no such flag), so every
  sentinel-carrying column killed the session at startup; the sentinel now rides
  the prompt. `resume --last` wired for codex restart. Readiness is quiescence-based
  with a 60s budget and **never** hard-kills — exhausting it injects anyway and
  leaves the pane inspectable. `CLI_HEALTH_SPECS` now probes the interactive
  codex path so the same drift can't ship silently again.

---

## 🔴 Critical now (blocks comfortable daily-driving)

1. **Two-claude footgun (env hygiene).** Stale `/usr/local/bin/claude` (2.1.138 npm
   copy) can win in some PATHs. App now resolves absolute paths correctly, but
   `rm /usr/local/bin/claude` removes the ambiguity. One-liner, do it.

## 🟡 Important (rough edges, not blockers)

2. **Interactive completion is panel-bound.** The "agent done" advisory only fires
   while the panel is attached — no persisted flag / card badge. Needs a migration
   + badge so it survives panel close. → board task "Interactive: persist advisory".
3. **`effort_level` not wired into the trigger path.** It's a real DB field + has a
   `thinking-selector.tsx` and works in the interactive chat panel, but no
   `effort_level`→CLI plumbing in `pipeline/spawn.rs` (the headless `spawn_cli`
   path). Either wire `--effort`/`-c model_reasoning_effort` into the trigger
   command or document it as interactive-only.
4. **Checklist as per-workspace roadmap + MCP surface.** Checklist has zero
   `/api/*` routes and zero MCP tools. Make it agent-readable/maintainable so it
   can serve as the project roadmap. **Spec:** [specs/CHECKLIST_AS_ROADMAP.md](./specs/CHECKLIST_AS_ROADMAP.md).
   Planned, deferred 2026-06-12.
5. **MCP UI-only gaps.** No MCP tool for `update_column`/`delete_column`/
   `reorder_columns`, `update_script`/`delete_script`, per-task runtime-mode
   override, or agent control (inject/interrupt/pause/restart/switch-model). Each
   needs an `/api/*` route first. Add as needed (the checklist spec establishes the
   route+tool pattern).

## ⚪ Inert / deferred (known, intentional)

- Custom keyboard shortcuts render but are inert (`shortcuts-tab.tsx:54`).
- Providers OpenRouter / Google AI / Ollama are "Coming soon" cards.
- Voice/Whisper built but gated out of the default build (`voice` Cargo feature).
- macOS release: matrix disabled pending Apple Developer ID + notarization secrets.
  Windows unsupported by design (tmux/jq/sh).
- Discord: one-way only; reply-routing / `#chef` / bidirectional are later slices
  (`.tickets/discord/`).
- MCP source-attribution Part 3 (spawned-by badge + human/agent filter); interactive/
  managed spawn-path env threading (headless done).

---

## Needs testing (no automated coverage)

- Interactive codex round-trip (`resume --last`, prompt-carried sentinel) against
  a real binary. The argv is now verified against codex-cli 0.145.0 and unit-tested,
  but the end-to-end spawn → inject → sentinel → advance loop still has no
  automated coverage.
- Live CLI smoke test (throwaway-tmux round-trip) — designed in B4, not built.
- Discord thread streaming end-to-end.
- 5-agent-per-workspace concurrency under real load (queue promotion).

## Suggested order

`#1 rm stale claude` (free) → `#2 persist advisory` → `#3 effort wiring` →
`#4 checklist/roadmap MCP` → `#5 MCP gaps`.
