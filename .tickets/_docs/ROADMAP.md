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
- Kaiten Agents wired into columns (2026-08-21): a `spawn_cli` trigger carries
  `agent_id`, and the agent then supplies the CLI, instructions, tools and its
  preferred model, with the column able to override **model only** — enforced in
  `pipeline::spawn::resolve()` alone. All three runtimes run, script agents
  included, through the same tmux transport. Instructions and skills ship as
  `.agent.md` rather than a system-prompt flag: codex has no such flag, claude's
  `--append-system-prompt` is last-wins and interactive mode already spends it on
  the done-sentinel, and scripts have no prompt at all. `get_agent_usage` shows
  which columns run an agent so deleting one names what it would break.
- Settings wiring pass (Appearance): all five settings now reach the UI. Font Size
  was worse than unwired — 247 arbitrary `text-[Npx]` values across 63 files were
  absolute, so at "small" the root dropped to 12px while a caption pinned at 11px
  stayed put and rendered *larger* than the `text-sm` body above it. The scale is
  now four rem steps (`text-2xs` added to `@theme`, since Tailwind stops at `xs`),
  all 247 converted, and `scripts/check-type-scale.js` fails CI on the next
  absolute size. Card Density and Animation Speed were fully inert: the chain died
  at `.card-padding`/`.card-gap`/`.transition-appearance`, three helper classes
  zero components used. Density now drives the task card's padding and the
  column's inter-card gap directly; Animation Speed rides Tailwind's own
  `--default-transition-duration`, so every `transition-*` utility honours it
  without opting in. The three dead classes are gone.
- Interactive done-advisory persisted (migration 048, `tasks.agent_done_signaled_at`):
  the signal used to be a Tauri event only, so it existed just while the agent
  panel was mounted. Now the board shows a "Ready to advance" badge that
  survives panel close; cleared on advance and on a fresh agent start.

---

## 🔴 Critical now

Empty. The last item — the stale `/usr/local/bin/claude` — was removed
2026-08-21; `which -a claude` now returns exactly one path (2.1.239).

## 🟡 Important (rough edges, not blockers)

2. **Other inert settings surfaces.** Flagged while wiring Appearance, not fixed:
   custom keyboard shortcuts render but do nothing (`shortcuts-tab.tsx:54`), and
   the OpenRouter / Google / Ollama provider cards are "Coming soon". Framer
   Motion animations also ignore Animation Speed — they read no CSS variable, so
   "none" doesn't fully mean none.

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

## 🟢 Env hygiene (latent, not breaking)

- **Two `codex` copies**, the same shape as the claude footgun that was just
  closed: `/usr/local/bin/codex` is **0.130.0** (root-owned, stale) while fnm's
  shim is **0.145.0** — the version every codex behaviour in this repo was
  verified against. The app resolves via `which`, so it picks whichever the
  launching shell's PATH puts first. Today the running instance gets 0.145.0
  through an fnm shim under `/run/user/1000/…`, but that path is tmpfs, is
  per-shell-session, and vanishes on reboot or when launched from a desktop
  launcher — at which point `/usr/local/bin/codex` wins.
  **Checked 2026-08-21: not currently breaking anything.** Both versions carry
  `--skip-git-repo-check` and `--dangerously-bypass-approvals-and-sandbox`, and
  both have the `resume` subcommand with `--last`. So this is version ambiguity
  waiting to bite, not a live bug. `sudo rm /usr/local/bin/codex` closes it the
  same way the claude one was closed (root-owned, needs your own shell).

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

Nothing is critical. Next by value: **dogfood agents-in-columns** on a real
board → `#3 effort wiring` → `#4 checklist/roadmap MCP` → `#5 MCP gaps`. `#2`
(inert settings surfaces) and the codex env-hygiene note are opportunistic.
