# Discord MVP — thin vertical slice

> **Status**: planned (2026-06-07) · **Parent**: [E001](./E001-discord-integration.md)
> **Decision**: thread = task (board mirror) · thin MVP first · KaitenCode → Discord (one direction)

The full epic (E001, tickets T052–T060) stays the roadmap. This is "phase 1, lite":
the smallest end-to-end slice that proves the **hard, reusable** parts — the
Node.js sidecar, the stdin/stdout IPC protocol, Discord auth, thread creation,
and batched message posting — before we add reply-routing, `#chef`, and
bidirectional sync.

## The slice

> Connect the bot → when a task starts running, create a Discord **thread** for
> it in its column's channel → **stream that agent's output into the thread.**

One direction only (KaitenCode → Discord). No reply routing, no `#chef`, no
board mutation from Discord yet.

## Why this slice

It exercises every reusable building block exactly once:
- sidecar process lifecycle + supervision,
- the JSON IPC protocol (Rust ⇄ Node),
- Discord auth + a guild/category the bot can write to,
- thread create + the `MessageSplitter`/`RateLimiter` 2000-char batching
  (already specced in T056/T057),
- subscribing to existing app events and forwarding them.

Reply-routing (`--resume`, T058), `#chef` (T059), and bidirectional sync (T060)
then bolt onto the **same bridge** without re-architecting.

## Components

| Piece | Where (new unless noted) | What it does |
|------|--------------------------|--------------|
| Sidecar bot | `src-tauri/sidecars/discord-bot/` | Node.js + `discord.js`. Reads JSON commands on stdin (`createThread`, `postMessage`); connects to Discord; emits events (`ready`, errors) on stdout. (T052) |
| Rust bridge | `src-tauri/src/discord/mod.rs` | Spawns + supervises the sidecar; sends commands; subscribes to app events (task→running, agent output) and forwards them. |
| Commands | `src-tauri/src/commands/discord.rs` | `discord_set_token`, `discord_enable`, `discord_test_connection`, `discord_status`. |
| DB | new migration (after current latest) | Re-add workspace `discord_*` fields + minimal `discord_task_threads` (task_id ↔ thread_id). The old `018` migration was reverted by `026`; revive only the MVP bits. |
| Settings UI | `src/components/settings/tabs/discord-tab.tsx` | Bot token, enable toggle, guild + category pickers, "Test connection". |

## Event flow (MVP)

1. Task enters a trigger column / agent starts → bridge sends `createThread`
   `{ taskTitle, columnChannelId }` → sidecar creates the thread, returns
   `threadId` → bridge persists `discord_task_threads(task_id, thread_id)`.
2. Agent output events (`pty:<key>:output` / agent transcript) → bridge buffers
   + splits (≤2000 chars, batched per Discord rate limits) → `postMessage`
   `{ threadId, content }`.
3. Agent completes → `postMessage` a short summary; leave the thread (archive
   lifecycle is a later slice).

No agent-side changes — output already flows as events; the bridge just listens.

## Open practical notes

- **Node.js** becomes a runtime dep for Discord users → add to the preflight
  check (where `tmux`/`jq` already live), opt-in.
- The user **invites the bot** to a server and picks a guild/category in
  settings; the bot needs the **Create Public Threads** + **Send Messages in
  Threads** perms.
- **Token at rest**: stored in settings for the MVP; encryption-at-rest is a
  flagged follow-up, not MVP.
- **Opt-in**: gated by the per-workspace `discord_enabled` flag; the app runs
  fully without Discord and without Node.

## Out of scope (later slices, already ticketed)

- Reply in a thread → route to the task's agent (`--resume`) — T058
- `#chef` channel → natural-language board management — T059
- Column/workspace rename sync, conflict resolution, offline queue — T060
- Thread archive/reactivate lifecycle — T054 (full)
