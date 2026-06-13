# Spec — Tool-based board context for the chef (orchestrator)

> Status: **PLANNED.** The quick dedup (board no longer double-sent) shipped first
> (2026-06-13). This is the real fix that follows it.

## Problem

Today the chef embeds the **entire board state in the prompt every turn**:
- `context::build_cli_system_prompt` puts a `[id] title - description(≤120c)`
  snapshot of every task (across all columns) + the action-protocol prompts into
  `--system-prompt`.
- `chef.rs::augment_message` historically *also* prepended that snapshot to the
  user message (now gated to `--resume` turns only — the quick dedup).

Consequences:
- Prompt size scales with board size, not with what the turn needs.
- It feeds the argv/E2BIG ceiling (see the stdin fix — the `--system-prompt`
  board is still on argv; a large enough board can still trip 128 KiB).
- Most turns ("rename task X", "what's in Review?") don't need the *whole* board.

## Goal

Stop embedding the board. Give the chef a **read tool** and let the model fetch
board state on demand — tiny prompts, scales to any board, removes the E2BIG
residual.

## Design

The chef CLI path spawns `claude -p`. Two ways to give it a read tool:

### Option A — MCP (preferred)
Wire the existing **`kaitencode-mcp`** server (already exposes `get_board`,
`get_task`, `get_workspaces`, …) into the chef's claude invocation via
`--mcp-config` (or `--mcp-server`). The model calls `get_board` when it needs
state.
- `kaitencode-mcp` is already spawned in some flows (see `bridge.rs:1586` env
  threading) and shares the rusqlite build for WAL-safe concurrent reads, so
  read tools work without the app for the DB, but mutations still route through
  `/api/*`.
- **VERIFIED 2026-06-13 (spike):** `claude -p --mcp-config <json>
  --allowedTools "mcp__kaitencode__get_workspaces,..." --output-format stream-json`
  loads `kaitencode-mcp`, the model calls `mcp__kaitencode__get_workspaces`, the
  tool_result (real DB data) comes back, and the answer is correct. The
  tool_use/tool_result events appear in the stream-json (transcript already renders
  tool calls). claude 2.1.177. → **Option A is GO.**
  - Nuance: in the spike, claude had the *user's* global MCP servers loaded too, so
    it went through `ToolSearch` (deferred-tool discovery) before the real call.
    Chef should spawn with an **isolated** config (only kaitencode, via
    `--strict-mcp-config` + `--mcp-config`) so there's no ToolSearch indirection and
    the tool is directly available. Also pre-approve the read tools with
    `--allowedTools` (no permission prompt in headless).
  - Note: pass the prompt on **stdin** (the E2BIG fix already does) — a positional
    prompt makes claude wait ~3s for stdin ("no stdin data received in 3s").

### Option B — extend the action protocol with a read action
Add a `get_board` "action" the model emits (like the existing `create_task`
blocks); the backend intercepts it, runs the read, and feeds the result back as a
follow-up turn. Reuses the existing `parse_cli_action_blocks` machinery — no MCP
dependency — but needs a multi-turn read/observe loop the chef doesn't have yet.

**Recommendation:** Option A if the `-p` + MCP spike works; otherwise B.

## Changes (Option A)

1. `build_cli_system_prompt`: drop the `Current tasks:` snapshot; replace with a
   one-liner — "Call `get_board` to see the current board; call it again after you
   change something." Keep columns list (cheap, stable) + the action protocol for
   *writes*.
2. `chef.rs`: delete `augment_message` / `format_context_message` board injection
   entirely (the quick-dedup branch goes away too).
3. Chef claude invocation (`runtime`/`session` pipe path for orchestrator): add
   `--mcp-config` pointing at `kaitencode-mcp`. Likely a chef-only spawn flag so
   per-task agents are unaffected.
4. Ensure the stream parser surfaces MCP tool-use/tool-result events into the
   transcript (the agent transcript already renders tool calls — reuse).

## Verification

- Spike: `claude -p --mcp-config … "list tasks in Review"` headless → confirm a
  `get_board` tool call + result in the `stream-json` output.
- Prompt size: a 200-task board should produce a *constant* small system prompt.
- Regression: chef can still create/move/rename tasks (writes unaffected).
- No E2BIG at any board size.

## Open questions

- Does `claude -p` support MCP headlessly in this version? (gates A)
- Read-staleness after a write: instruct the model to re-`get_board` after each
  action (cheap) vs. auto-injecting a fresh snapshot post-write.
- Codex parity (codex chef MCP support is separate/unverified).
