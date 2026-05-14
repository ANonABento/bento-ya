# Agent Panel Terminal Markdown Spec

## Goal

The task agent panel should feel like a polished terminal-native Markdown transcript, not a generic chat app and not a raw shell dump. The primary surface is a readable work log where the user can steer the agent. The raw tmux terminal remains available as a debugging and direct-control layer.

## References

- Codex CLI/App: agent work is managed as sessions, skills, tasks, and readable progress, while the terminal remains powerful for direct control.
- Claude Code CLI/Web: transcript viewer, slash commands, file mentions, shell mode, background tasks, and web task sessions separate conversation, task state, diffs, and terminal details.
- T3 Code: three-panel agent workspace; chat/thread surface is primary, with responsive multi-agent navigation.
- Conductor-style tools: command-center pattern with active sessions, lifecycle state, output, diffs, and review in one workflow.

## UX Principles

1. Keep the terminal soul: monospace accents, Markdown density, command affordances, and low-chrome workbench styling.
2. Do not use chat bubbles. Messages are transcript entries separated by quiet rules and metadata.
3. Hide shell scaffolding by default. Long command setup such as `KAITENCODE_CLAUDE_FILTER=... bash -o pipefail ...` is raw detail, not the main story.
4. Preserve raw access. Users can inspect and interact with the real tmux terminal at any time.
5. Make steering obvious. The composer should sit under the transcript, support multiline input, and leave room for `/commands`, `@files`, and `!shell`.

## Panel Structure

Header:
- Task title, truncated.
- Status chips: model/mode when known, running/idle/error, held state.
- Controls: `Hold`, `Stop`, `Kill`.
- View switch: `Transcript` and `Terminal`.

Transcript View:
- Shows persisted user/assistant/system messages plus live streaming state.
- User entries use a terminal prompt style, for example `> user`.
- Assistant entries use `agent` metadata and Markdown rendering.
- System entries render as centered or inline separators.
- Thinking/tool/output sections are collapsible details.
- Queued messages render as muted prompt entries.
- Empty state says the panel is ready to steer the task.

Terminal View:
- Shows the existing xterm-backed tmux session.
- Is clearly labeled as raw terminal.
- Retains direct interactivity, scrollback, resize, Stop, and Kill behavior.

Composer:
- Reuses shared `ChatInput` for model/settings/voice/attachment support.
- Placeholder should be command-line flavored: `Steer the agent... /commands, @files, !shell`.
- Submit sends to `send_task_input`, preserving the single tmux session path.

## Event/Data Model

Current direction:
- `agent_transcript_events` is the primary persisted Transcript model.
- `agent_sessions.scrollback` remains raw terminal/tmux persistence only.
- `TerminalView` continues to use the raw PTY/tmux channel.
- `agent_messages` may remain as legacy chat history, but it is not the source of truth for the Transcript tab.

See [`UNIVERSAL_AGENT_RUNTIME.md`](./UNIVERSAL_AGENT_RUNTIME.md) for the canonical runtime contract, event list, input semantics, and Transcript/Terminal product UX contract.

Compatibility notes:
- Legacy sessions with no semantic events should show "No semantic transcript yet. Open Terminal."
- Known terminal scaffolding must be filtered or folded when terminal-backed adapters emit coarse semantic `command_output` events.
- New provider integrations should map into the normalized runtime event stream instead of adding UI-specific parsers.

## Implementation Phases

Phase 1:
- Add a terminal-Markdown transcript component.
- Make AgentPanel default to `Transcript`.
- Add `Transcript`/`Terminal` segmented switch.
- Wire shared composer to the existing task chat hook.
- Keep raw Terminal tab intact.

Phase 2:
- Add raw command folding for known Claude/Codex launch scaffolding.
- Add lightweight session metadata blocks: start, complete, error, cost, duration.
- Add transcript keyboard polish.
- Persist run/tool disclosure state so the user can keep noisy details collapsed.
- Keep running/newest runs open by default and collapse older completed runs once read.
- Make composer delivery mode explicit: live steer, queued next turn, resume, or new run.
- Replay tmux scrollback as readable terminal text without forcing pane-grid whitespace into xterm.

Phase 3:
- Add `Files` and `Diff` tabs powered by task changed files and git diff.
- Add slash-command and file mention menus.
- Continue replacing terminal-derived fallback parsing with provider-adapter semantic events.

## Acceptance Criteria For Phase 1

- Opening a task shows Transcript by default.
- Terminal tab still renders `TerminalView` with the same task/workdir.
- User and assistant messages render as Markdown transcript entries, not bubbles.
- Queued and streaming state are visible.
- Hold, Stop, and Kill controls keep their current behavior.
- Tests cover default view, terminal switching, composer send path, and controls.
