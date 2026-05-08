# Universal Agent Runtime

> Status: Active design target (2026-05-08).
> Builds on: `UNIFIED_CHAT.md`, `PERSISTENT_AGENT_REBUILD.md`, `AGENT_PANEL_TERMINAL_MD_SPEC.md`.
> Purpose: converge Bento's task agents, transcript, terminal, and future model/provider support around one durable runtime contract.

## Problem

Bento currently has two useful but competing ideas:

- A persistent per-task tmux session that preserves the real CLI/terminal experience.
- A structured transcript UI that should read like a normal agent timeline: messages, thinking, tools, commands, and completion.

Historically the transcript was derived from tmux scrollback. That made the terminal the source of truth, which leaked shell prompts, launcher scripts, tmux status, ANSI fragments, and wrapped tail output into the primary Transcript view.

This does not scale to more agents. Claude Code, Codex, API models, local models, Conductor-style runtimes, and future CLIs all expose different session ids, stream shapes, resume semantics, and tool formats. Bento needs one runtime contract that these systems adapt into, not one UI/parser per provider.

## North Star

Bento owns the agent timeline.

Each task has an agent runtime session. The session may be backed by Claude CLI, Codex CLI, a generic tmux process, an API model loop, or a future remote/local agent. Provider details stay inside an adapter. The rest of Bento sees normalized semantic events.

Terminal remains a raw inspection/debug surface. Transcript is never powered by raw terminal scrollback.

## Runtime Contract

Every adapter emits the same durable event stream:

```text
session_started
user_input
agent_started
agent_text_delta
agent_thinking_delta
tool_started
tool_output
tool_completed
command_started
command_output
command_completed
agent_completed
agent_failed
agent_cancelled
```

These events are persisted in `agent_transcript_events` and replayed by the Transcript tab. Raw terminal output remains in `agent_sessions.scrollback` and live `pty:*` channels only.

## Core Shape

```rust
trait AgentRuntimeAdapter {
    async fn start_turn(&mut self, input: AgentInput) -> Result<(), AgentRuntimeError>;
    async fn send_input(&mut self, input: AgentInput) -> Result<InputDelivery, AgentRuntimeError>;
    async fn cancel_turn(&mut self) -> Result<(), AgentRuntimeError>;
    async fn kill_session(&mut self) -> Result<(), AgentRuntimeError>;
    async fn resume_session(&mut self, session_ref: AgentSessionRef) -> Result<(), AgentRuntimeError>;
}
```

The exact Rust shape can vary, but the boundary should be explicit:

- Adapter input: task id, workdir, model, effort, session/thread id, user/trigger prompt, runtime mode.
- Adapter output: normalized `AgentRuntimeEvent`s.
- Adapter state: provider-specific resume id, process id, tmux session name, active command ids.

## Runtime Modes

### Managed

Structured event source. Bento starts a turn, reads provider/API events, and persists semantic transcript events directly.

Examples:

- Claude CLI with `--output-format stream-json`.
- Codex CLI with `exec --json` / `exec resume --json`.
- API model loop with Bento-executed tools.
- Future remote runtimes that expose event streams.

### Terminal

Raw tmux/PTY source. Terminal is primary, Transcript may show only coarse semantic events unless a parser adapter exists.

Examples:

- Unknown CLI.
- Interactive-only tools.
- Debug mode where the user wants the literal shell.

## Built-In Adapters

### Claude CLI Adapter

Inputs:

- `claude --dangerously-skip-permissions --output-format stream-json --verbose --include-partial-messages`
- `--resume <session_id>` when available.

Normalizes:

- `system/init` -> `session_started` metadata with `session_id`, model, CLI.
- text deltas -> `agent_text_delta`.
- thinking deltas -> `agent_thinking_delta`.
- tool use blocks -> `tool_started` / `tool_completed`.
- result/exit -> `agent_completed` / `agent_failed`.

Terminal mode may still pretty-print Claude events into tmux for raw inspection, but Transcript must use the semantic event stream.

### Codex CLI Adapter

Inputs:

- `codex exec --json ... <prompt>`
- `codex exec resume --json <thread_id> <prompt>`

Normalizes:

- `thread.started` -> provider session/thread id.
- `turn.started` -> run/turn start.
- `item.started` command execution -> `command_started`.
- `item.completed` command execution -> `command_output` + `command_completed`.
- `item.completed` agent message -> `agent_text_delta`.
- `turn.completed` -> `agent_completed` with usage metadata.
- `turn.failed` -> `agent_failed`.

### Generic CLI Adapter

Inputs:

- tmux/PTY command or configured launcher.

Normalizes:

- process start -> `command_started`.
- raw output chunks -> `command_output` with `source: generic_cli`.
- exit -> `command_completed` + `agent_completed`/`agent_failed`.

Generic CLI output should be folded or excluded by default in Transcript. Terminal remains the full raw view.

### API Agent Adapter

Inputs:

- DB chat/task history.
- Bento tool schema.
- selected provider/model.

Normalizes:

- streaming text/thinking -> text/thinking deltas.
- model tool calls -> tool events.
- Bento tool execution -> tool output/completed.
- command tools -> command events.

This is the most traditional orchestrator mode: user message -> model turn -> tool call -> tool result -> next model turn -> final answer.

## Input Semantics

`send_task_input` must not mean "type into whatever process exists." It means "deliver user input to the task's runtime session."

When the agent is running:

- If adapter supports live input, deliver immediately.
- If adapter cannot accept live input, persist `user_input` with `delivery: queued` and deliver at the next safe turn boundary.
- UI must show queued/running state explicitly.

When the agent is completed:

- Start a new turn using the adapter's resume id/thread id.
- Persist a new run group with `resume: true`.
- Do not start context-cold unless no provider session id exists or the user chooses fresh/fork.

When the agent is cancelled:

- Keep session/resume id unless the user kills the session.
- Next input resumes/forks according to adapter capability and user choice.

When the agent is killed:

- Clear runtime process state.
- Preserve transcript.
- Clear provider resume id only if kill means "forget context"; otherwise model this as a separate "terminate process" action.

## Transcript UX Rules

Transcript is a semantic workbench timeline:

- Assistant markdown visible by default.
- User prompts visible.
- Thinking grouped and collapsed by default.
- Tool rows visible, outputs collapsed by default.
- Command rows visible only when useful; raw output collapsed by default.
- Start/end/error metadata compact.
- Legacy sessions with no semantic events show "No semantic transcript yet. Open Terminal."

Transcript must never show:

- shell prompts
- launcher scripts
- tmux status lines
- ANSI/control garbage
- `BENTOYA_CLAUDE_FILTER`
- `quote>`
- `.bentoya/trigger_logs/run_*.sh`

## Terminal UX Rules

Terminal is the raw tmux/PTY view:

- It may show shell prompts, tmux status, and raw CLI formatting.
- It must not be used as Transcript's source of truth.
- It must preserve persistent tmux sessions.
- It must keep Hold/Stop/Kill semantics clear.
- It should fit tmux cols/rows to xterm size to avoid bad wrapping.

## Product UX Contract

The agent panel intentionally has two surfaces. They should not be two skins over the same stream.

### Transcript

Transcript is the default product surface. It answers:

- What did the user ask?
- What is the agent doing now?
- Which tools or commands ran?
- What changed?
- Did the run complete, cancel, fail, or queue more input?
- What should the user review next?

Transcript should read like an agent workbench timeline:

```text
> user
write a poem for Taiga

run · Working · claude · completed

thinking...

The task is creative writing. I will create a poem file and commit it.

▸ Read task context
▸ Write poem-for-taiga.md
▸ Bash git status and commit

Committed poem-for-taiga.md as d7ee980.

done · 33s · $0.42
```

Transcript is not a terminal emulator. It may include filtered command evidence, but only when that evidence helps the user understand the run. Raw command details should be folded by default.

### Terminal

Terminal is the raw truth/debug/control surface. It answers:

- What process is actually running?
- What did the provider CLI literally print?
- Did tmux preserve the session?
- Can the user interact directly with the shell?
- Is there low-level output that the semantic parser missed?

Terminal may be noisy. That is acceptable because its job is fidelity, not readability.

### Composer

The composer must make delivery mode legible. The same text box can send to several runtime states, so the surrounding status text should tell the user what will happen:

- `Running · input will steer` when the adapter can accept live input now.
- `Running · input will queue` when the adapter cannot accept live input until the next safe boundary.
- `Idle · next message resumes` when a provider session/thread id is available.
- `Idle · next message starts` when no resumable context exists.

Expected behavior:

- Sending while running persists a `user_input` event immediately.
- If live steering is supported, the input is delivered to the current runtime.
- If live steering is not supported, the input is queued and shown in Transcript as queued for the next turn.
- Sending after completion starts a new run using provider resume/thread context when possible.
- Sending after cancellation preserves the transcript and resumes/forks according to adapter capability.
- Killing a session terminates raw process state without deleting transcript history.

### Recommended Default

Keep `Transcript` as the default tab and `Terminal` as the explicit raw tab. Add a future split/debug mode only if users need to see both at once.

The high-level product bet is:

- Transcript is semantic, readable, durable, and reviewable.
- Terminal is raw, interactive, exact, and advanced.
- The composer is runtime-aware and should never make the user guess whether they are steering, queuing, resuming, or starting fresh.

### Current Implementation Notes

- Transcript run cards are persisted per disclosure key. The newest/running run opens by default; older completed runs may collapse once the user has seen them.
- Tool and command details are folded by default. The visible row should name the action; expanded details should contain input/output evidence.
- Claude/Codex managed adapters should emit semantic events directly from provider JSON streams. Terminal-mode tmux output is allowed only as a filtered fallback and should never leak shell launchers, tmux status lines, `BENTOYA_CLAUDE_FILTER`, `quote>`, or provider JSON blobs into Transcript.
- Claude terminal-mode triggers tee raw stream-json into a side JSONL log while piping the same stream through the human-readable terminal filter. The side log is parsed into semantic transcript events; the pretty tmux log is only a fallback.
- Terminal scrollback replay should favor readability over exact pane grid reconstruction. Raw live interaction remains exact through the tmux attach path.
- Managed follow-up input is backend-owned. The frontend sends immediately; the backend records `user_input`, chooses live/queued/resume/new-turn delivery, and emits final completion only after the last chained turn exits.

## Session Model

`agent_sessions` should model runtime state, not only terminal state:

```text
id
task_id
adapter_kind          claude_cli | codex_cli | generic_cli | api | remote
runtime_mode          managed | terminal
cli_path
model
effort_level
workdir
provider_session_id   Claude session id, Codex thread id, remote run id, etc.
tmux_session_name
status                idle | running | held | completed | failed | cancelled
scrollback            raw terminal only
created_at
updated_at
```

Existing `cli_session_id` can be migrated or treated as the first provider-session field.

Current implementation notes:

- Migration `040_agent_runtime_session_fields` adds `adapter_kind`, `runtime_mode`, `provider_session_id`, and `tmux_session_name`.
- Migration `041_agent_runtime_input_queue` adds a durable per-task/session input queue for adapters that cannot accept live steering.
- `cli_session_id` is mirrored into `provider_session_id` so existing Claude/Codex resume behavior remains compatible.
- Terminal-backed sessions currently persist `runtime_mode: terminal` and their `bentoya_<task_id>` tmux session name.
- `agent_sessions.scrollback` remains raw terminal persistence only.

## Active Goal Todo

Status as of 2026-05-08:

Canonical goal:

Rebuild the agent panel transcript system so the primary Transcript view is powered by semantic agent events, not raw tmux scrollback. Preserve the Terminal tab as the raw interactive tmux view. Keep the UI terminal-native, compact, readable, and folded by default for raw command details. Do not regress persistent tmux sessions, Hold/Stop/Kill, task lifecycle state, or the shared ChatInput used by agent/chef chat.

Goal-tool note:

The Codex goal tracker currently contains a stale placeholder objective from an earlier `/goal` attempt. Until that tool state can be replaced, this section is the authoritative project todo for the transcript/runtime rebuild.

- [x] Durable transcript events table separate from raw scrollback.
- [x] Backend `AgentRuntimeEvent` model and adapter contract.
- [x] Claude/Codex managed turn argument builders behind runtime adapters.
- [x] Runtime event persistence path for bridge output/completion.
- [x] Runtime-aware input delivery labels: `live`, `queued`, `new_turn`, `resume_turn`.
- [x] Session runtime metadata migration and DB helpers.
- [x] Durable runtime input queue table and DB helpers.
- [x] Managed runtime follow-up turns drain queued user input after successful turn completion and resume with provider session id.
- [x] Generic CLI terminal adapter contract for coarse/future runtimes.
- [x] Provider JSON line parser for Claude stream-json and Codex JSONL semantic events.
- [x] Managed runtime turn runner that withholds terminal completion/failure until process exit.
- [x] Managed runtime persistence helper that streams runner events into transcript IPC/DB.
- [x] Managed Claude stream-json parser reconstructs tool input deltas into folded semantic tool detail.
- [x] Managed Codex JSONL parser maps reasoning, command, and tool/function-call items to semantic events.
- [x] API and remote adapter hooks reserve managed queue semantics without pretending provider execution exists yet.
- [x] `send_task_input` backend hook for sessions marked `runtime_mode = managed`.
- [x] `spawn_cli` trigger config accepts `runtime_mode`; task `agent_mode` selects terminal vs managed runtime.
- [x] Column `spawn_cli` editor exposes Terminal vs Managed runtime selection.
- [x] Task settings expose Auto/Terminal/Managed runtime override.
- [x] Managed `spawn_cli` trigger hook starts structured runtime turns without tmux transcript parsing.
- [x] Transcript renderer grouped by run, with folded tools/commands and no raw fallback.
- [x] Terminal sizing/attach duplication first pass.
- [x] True managed Claude adapter path consumes stream-json directly instead of relying on tmux tail parsing for semantic detail.
- [x] True managed Codex JSONL adapter.
- [x] Drain and replay queued user input for managed adapters at safe turn boundaries.
- [x] Task-level runtime override controls.
- [x] API/remote adapter hooks.
- [x] Full gate: `npm run type-check`, `npm run lint`, `npx vitest run`, `npm run build`, `cd src-tauri && cargo test && cargo check`.
- [x] Tauri/WebDriver QA for opening the panel, Transcript/Terminal separation, Terminal xterm mount, lifecycle controls, reload, and shared app flow.
- [x] Update stale WebDriver panel coverage from the old single-Terminal layout to the new Transcript/Terminal tab model.
- [x] Final verification: `npm run type-check`, `npm run lint`, `npx vitest run`, `npm run build`, `npm run build:webdriver`, `npm run test:webdriver`, `cd src-tauri && cargo test && cargo check`.

## Implementation Slices

### Slice 1: Adapter Contract

- Add backend `AgentRuntimeEvent` and adapter trait/module.
- Keep current event DB schema.
- Add tests for event mapping from adapter events to `agent_transcript_events`.

Validation:

- Rust unit tests for adapter event persistence.
- Existing insert/list transcript tests stay green.

### Slice 2: Claude Adapter

- Move Claude stream-json launch/parsing behind `ClaudeCliAdapter`.
- Capture and persist Claude session id.
- Preserve tmux pretty terminal path as raw Terminal only.

Validation:

- Claude stream-json fixtures map to text/thinking/tool/completion events.
- Sending after completion resumes with stored session id.
- Terminal raw events still emit independently.

### Slice 3: Codex Adapter

- Use `codex exec --json` for managed turns.
- Use `codex exec resume --json <thread_id>` for follow-up turns.
- Map JSONL thread/turn/item events to semantic transcript events.

Validation:

- Codex JSONL fixtures map to command/text/completion events.
- Resume command includes thread id.
- Failed turns produce `agent_failed`, not fake completion.

### Slice 4: Input Router

- Replace ad hoc chat steering with runtime-aware `send_task_input`.
- Explicitly model delivery: `live`, `queued`, `new_turn`, `resume_turn`.
- Keep Hold/Stop/Kill behavior stable.

Validation:

- Running adapter that cannot accept live input queues.
- Completed adapter starts resumed turn.
- Cancel/kill do not leave stuck running state.

### Slice 5: Transcript Renderer Polish

- Group by run/turn.
- Merge thinking spans.
- Collapse tool/command outputs by default.
- Filter remaining shell scaffolding for legacy/coarse outputs.

Validation:

- Component tests for every event type.
- Regression tests for polluted terminal scrollback not appearing in Transcript.

### Slice 6: Terminal Separation

- Fix xterm/tmux sizing.
- Avoid duplicate scrollback append on attach.
- Keep terminal raw but visually calmer.

Validation:

- Manual Tauri test for live attach, reload, resize, hold/stop/kill.
- Terminal still shows real tmux session.

### Slice 7: Settings and Future Adapters

- Per-column/task runtime mode.
- Default adapter selection.
- Generic CLI fallback.
- API agent adapter using Bento tools.

Validation:

- Existing chef/shared `ChatInput` still works.
- Agent panel and chef tests stay green.

## Non-Goals

- Do not remove raw Terminal.
- Do not force every provider to expose the same internal behavior.
- Do not block unknown CLIs on semantic parsing; they can run in terminal/coarse mode.
- Do not make Transcript depend on tmux scrollback again.

## Acceptance Criteria

- Transcript is a replayable semantic timeline for managed runtimes.
- Terminal remains raw tmux and can be used to inspect/debug.
- Sending input resumes/continues the right provider session when possible.
- Running state ends only on real completion/failure/cancel.
- Old tasks with no semantic events load safely.
- Future adapters can be added by mapping provider events to `AgentRuntimeEvent`, not by rewriting the UI.
