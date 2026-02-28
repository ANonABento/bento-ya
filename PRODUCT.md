# Bento-ya - Agentic Workflow App

> Talk about what to build. Watch agents build it.

---

## What Is This

Bento-ya is a lightweight desktop app for orchestrating AI coding agents across multiple projects. You describe what you want in natural language (type or speak), it breaks work into tasks, spawns agents to implement them, and gives you an automated kanban pipeline where columns actually do things.

The whole UI is drag-and-droppable. Columns, cards, tabs — everything moves. Click a task card and you drop into a full terminal session with the agent. It's a thin, beautiful wrapper around the terminals where real work happens.

Think: Conductor's parallel agent muscle + Vibe Kanban's board UI + a real automated pipeline, in a bento-styled drag-and-drop interface.

---

## Problems to Solve

### 1. Agent orchestration is manual and messy
Today you copy-paste prompts, manually track which agent is doing what, and context-switch between terminal windows. There's no single view of "what's happening across my projects."

### 2. Task decomposition is a human bottleneck
You have a feature idea but turning it into agent tasks requires thought. An orchestrator agent should handle this decomposition.

### 3. Terminal overload
Running 5 agents means 5 terminal tabs. You lose track of which is which. Clicking a task should drop you into exactly the terminal you care about.

### 4. Multi-project chaos
Working on 3 projects means 3x the above problems. No tool unifies the view across projects.

### 5. Kanban boards are passive displays
In every tool, kanban columns are just labels. Moving a card to "Review" doesn't trigger a review. Moving to "Done" doesn't notify anyone. Columns should be automated pipeline stages.

### 6. Existing tools are too heavy
Vibe Kanban is a full issue tracker. Conductor is powerful but focused on workspace isolation. Neither is optimized for "I just want to talk, see tasks, and watch agents work."

### 7. Git conflicts with parallel agents
Multiple agents editing the same repo causes conflicts. Need smart change tracking without the overhead of worktrees — one localhost, clean PRs.

---

## Core Concepts

```
Workspace      A project/repo — each gets its own tab and board
Task           A unit of work for one agent
Column         An automated pipeline stage (not just a label)
Agent          A coding agent instance (Claude Code, Codex, etc.)
Terminal       Full terminal session — click task card to open split view
Orchestrator   A persistent agent that decomposes requests into tasks
Pipeline       The left-to-right flow of columns with automated actions
Mode           Agent operating mode (Code, Architect, Debug, Ask, Plan, custom)
```

---

## Core Flow

```
You say or speak something
        |
        v
Orchestrator agent interprets it
        |
        v
Creates/updates tasks on the board
        |
        v
Tasks enter the pipeline (leftmost column)
        |
        v
Each column transition triggers automated actions
        |
        v
Agents spawn, review runs, PRs go out — all automated
        |
        v
You intervene only when needed (attention indicators)
        |
        v
Click any task card -> drops into its terminal session
```

---

## The Pipeline: Automated Columns

The key differentiator. Columns are not labels — they're pipeline stages with triggers. Users can add, remove, reorder, and configure ANY column they want. The entire board is their pipeline to design.

### How It Works
- Each column has a **trigger** (what happens when a task enters)
- Each column has **exit criteria** (what moves the task to the next column)
- Transitions can be automatic or manual
- Columns are fully configurable per workspace
- Drag columns to reorder the pipeline
- Add new columns with "+" button on the board
- Right-click column header for config menu
- Column templates for quick setup

### Example Pipeline

These are defaults/examples — everything is addable, removable, reorderable, configurable:

| Column | Trigger | Exit Criteria | UI |
|--------|---------|---------------|-----|
| **Backlog** | None (static) | Manual drag or orchestrator assigns | Notes, brain dumps, free-form text. A parking lot for ideas. |
| **Combobulating** | Agent spawns on the task | Agent completes or needs attention | Terminal view on click. Attention indicator pulses when agent has a question or hit a blocker. |
| **RCA** | Run RCA agent on the issue | RCA report generated | Root cause analysis view. Agent investigates, produces findings. |
| **Review** | Run review agent/skills on changes | Review passes or feedback given | Diff viewer + review comments. Can run custom skills (lint, type-check, security scan). |
| **Siege** | PR is created, run comment-watch loop | PR approved or comments handled | Like clanker-spanker — monitors PR, auto-fixes review comments, loops until clean. |
| **Manual Test** | PR merged, generate test checklist | All checklist items checked off | Interactive checklist generated from the changes. You manually verify. |
| **Notify** | Checklist done + deployed to prod | User confirms notification sent | Reminder to notify customer/stakeholder. Shows context of what changed. |
| **Archived** | Task fully complete | N/A (terminal state) | Hidden from default view. Toggle to show. Searchable history. |

### Column Configuration

Each column is defined by:

```
Column {
  name:           string          # Display name
  icon:           string          # Emoji or icon
  trigger:        TriggerConfig   # What runs when task enters
  exit_criteria:  ExitConfig      # What moves task forward
  auto_advance:   boolean         # Auto-move when exit criteria met
  agent_config:   AgentConfig?    # Optional: which agent/skill to run
  color:          string          # Column accent color
  visible:        boolean         # Show/hide from board
  width:          string          # Column width (auto, fixed, etc.)
}

TriggerConfig {
  type:   "none" | "agent" | "skill" | "script" | "webhook"
  config: {
    agent?:    string     # Agent to spawn (claude-code, codex, etc.)
    skill?:    string     # Skill/command to run
    script?:   string     # Custom script path
    webhook?:  string     # URL to call
    flags?:    string[]   # Additional CLI flags
  }
}

ExitConfig {
  type:   "manual" | "agent_complete" | "script_success" | "checklist_done" | "pr_approved"
  config: {
    timeout?:   int       # Max time before flagging (minutes)
    retry?:     boolean   # Auto-retry on failure
    max_retry?: int       # Retry limit
  }
}
```

### Adding Custom Columns

Users can create columns for any stage. Examples:
- "Staging Deploy" — auto-deploy to staging after review
- "QA Bot" — run automated E2E tests
- "Docs Update" — agent updates documentation
- "Changelog" — auto-generate changelog entry
- "Security Scan" — run security audit agent
- "Performance Test" — benchmark before/after
- Whatever fits their workflow

Column creation: click "+" at the end of the column row, pick a name, configure trigger and exit criteria. Or start from a template.

---

## Features

### P0 - Core (MVP)

#### Browser-Style Workspace Tabs
- Centered tab bar at top (not left-aligned — centered like Arc browser)
- Each tab = one workspace (repo)
- "+" tab to add new workspace (select local directory)
- Each workspace has its own board, tasks, and config
- Tab shows workspace name + notification badge
- Drag to reorder tabs
- **Two-finger swipe** left/right to switch between workspace tabs (trackpad gesture)
- Close tab (workspace stays in settings, just not active)
- Keyboard: Cmd+1-9 for quick tab switching, Cmd+T for new tab

#### Voice Input
- Embedded whisper.cpp for local speech-to-text
- Press-and-hold hotkey to speak, release to send
- Or toggle continuous listening mode
- Transcription happens locally — no cloud, no latency
- Falls back to text input always available
- Visual waveform indicator when listening

#### Chat Input (The Orchestrator)
- Bottom panel or floating input
- Natural language: "add dark mode" or "fix the login bug and add tests"
- Or speak it via whisper
- Sends to the orchestrator agent
- Orchestrator creates tasks automatically
- Can also manually create tasks
- Orchestrator is a dedicated agent instance per workspace

#### Drag-and-Drop Everything
- **Cards**: Drag between columns or reorder within a column
- **Columns**: Drag to reorder the entire pipeline
- **Tabs**: Drag to reorder workspace tabs
- Smooth animations, snap-to-grid, visual drop targets
- Hold to pick up, drop to place
- @dnd-kit for all drag interactions (accessible, performant)

#### Automated Kanban Board
- Configurable columns with automated triggers (see Pipeline section)
- Add columns with "+" button, remove via header menu
- Each card = one task
- Cards show: title, agent status, branch name, attention indicator
- Right-click card for quick actions (stop, retry, archive, etc.)
- Column config accessible via column header menu

#### Task Focus View (Click to Open — Split Layout)

Clicking a task card doesn't navigate away from the board. It splits the view:

- **Left side**: Kanban collapses — only the column containing the clicked card is visible
  - The active task card expands vertically to show details
  - Top section: title, description, branch name, commits, changed files summary
  - Bottom section: usage stats (tokens, cost, duration), agent config, session info
- **Right side**: Full terminal session with the agent
- Esc or click "Back to board" to collapse terminal and restore full kanban
- Multiple terminal sessions stay alive in background
- Attention indicator visible from board view when agent needs input

```
Board View (default)
+--------------------------------------------------------------+
|            [ Proj A ]  [ Proj B ]  [ Proj C ]  [+]           |
+--------------------------------------------------------------+
|                                                              |
|  BACKLOG    COMBOBULATING    REVIEW    SIEGE     [+column]   |
|  +-------+  +----------+   +------+  +------+              |
|  | brain |  | fix auth |   | add  |  | feat |              |
|  | dump  |  |  ● live  |   | api  |  | PR#4 |              |
|  +-------+  | [!attn]  |   +------+  +------+              |
|  +-------+  +----------+                                    |
|  | idea  |  | refactor |                                    |
|  +-------+  |  ● live  |                                    |
|             +----------+                                    |
+--------------------------------------------------------------+
|  [mic]  Type or speak... "fix the login validation bug"      |
+--------------------------------------------------------------+


Click "fix auth" card ----->


Task Focus View (split)
+--------------------------------------------------------------+
|            [ Proj A ]  [ Proj B ]  [ Proj C ]  [+]           |
+------+-------------------------------------------------------+
|      |                                                       |
| COMB |  Terminal                                             |
|      |                                                       |
| +--+ |  I'll fix the auth validation. Let me read the        |
| |fix | |  current implementation...                          |
| |auth| |                                                     |
| |    | |  Reading src/auth/login.ts...                       |
| |----| |  Reading src/utils/validation.ts...                 |
| |desc| |                                                     |
| |  3 | |  Found the issue. The email regex doesn't           |
| |cmts| |  handle subdomains. Fixing now...                   |
| |  5 | |                                                     |
| |fils| |  Editing src/utils/validation.ts...                 |
| +--+ |  Running npm test...                                 |
|      |  > 12 passed, 0 failed                               |
|------|                                                       |
| USAGE|                                                       |
| 12k  |                                                       |
| tkns |                                                       |
| $0.04|                                                       |
| 2:34 |                                                       |
+------+-------------------------------------------------------+
|      | [mode ▾] [model ▾] [thinking ▾]                       |
|      | [mic] Type message...      [attach] [Cmd+Enter] [stop]|
+------+-------------------------------------------------------+
```

**Left panel (collapsed kanban):**
- Only the active column is visible, narrowed
- Active task card is expanded, showing:
  - Title + description
  - Branch name (`bentoya/fix-auth`)
  - Commit count + list (expandable)
  - Changed files list (expandable, with +/- line counts)
- Below the card: usage/stats tile
  - Token usage (prompt + completion)
  - Estimated cost
  - Session duration
  - Agent model name + thinking level

**Right panel (terminal):**
- Full xterm.js terminal — the real agent session
- Scrollback preserved, GPU-rendered via WebGL
- Bottom input bar with all controls (see Terminal Input Bar below)

#### Terminal Input Bar

The input bar at the bottom of the terminal is feature-rich:

```
+--------------------------------------------------------------+
| [Code ▾] [claude-sonnet ▾] [Extended ▾] [Plan mode ▾]       |
| [mic] Type your message here...   [📎 attach] [⌘⏎] [■ stop]|
+--------------------------------------------------------------+
```

**Controls:**
- **Mode selector** — dropdown to switch agent operating mode:
  - **Code** — default, agent reads/edits/runs (like Cline Act mode)
  - **Architect** — plan-only, outlines approach without editing files (like Kilo Architect)
  - **Debug** — focused on diagnosing errors, inspecting logs, running tests
  - **Ask** — quick questions, no file changes
  - **Plan** — analyze repo and propose changes, execute only after approval (like Cline Plan mode)
  - **Review** — review existing code/changes, suggest improvements
  - **Custom modes** — user-defined in settings (e.g., "Docs", "Test Writer", "Security Audit")
- **Model selector** — dynamic, provider-aware (see Model & Thinking System below)
- **Thinking level** — dynamic, shows only options valid for the selected model
- **Voice input** — mic button, TTS available here too (speak instead of type)
- **Message input** — text field for typing messages to the agent
- **Attach** — add files, images, screenshots as context
- **Send** — Cmd+Enter to send (configurable shortcut)
- **Stop** — cancel/interrupt the running agent (sends SIGINT, then SIGTERM if needed)

#### Model & Thinking System

The model selector and thinking level are **provider-aware** — they dynamically show only what's valid for the selected agent CLI and model. Starting with Anthropic (Claude Code) and OpenAI (Codex CLI).

**Supported Providers (v1):**

**Anthropic (Claude Code)**

| Model | ID | Thinking | Effort Levels | Pricing (input/output MTok) |
|-------|-----|----------|---------------|----------------------------|
| Opus 4.6 | `claude-opus-4-6` | Extended + Adaptive | low, medium, high (default), max | $5 / $25 |
| Sonnet 4.6 | `claude-sonnet-4-6` | Extended + Adaptive | low, medium, high, max | $3 / $15 |
| Haiku 4.5 | `claude-haiku-4-5` | Extended | low, medium, high, max | $1 / $5 |

- Extended thinking: model reasons internally before responding (uses output tokens)
- Adaptive thinking: model decides when to think deeply vs. respond quickly based on task complexity
- Effort levels control reasoning depth vs. speed/cost tradeoff
- When thinking is set to "adaptive", the model auto-selects depth

**OpenAI (Codex CLI)**

| Model | ID | Reasoning | Effort Levels | Notes |
|-------|-----|-----------|---------------|-------|
| GPT-5.3 Codex | `gpt-5.3-codex` | Built-in | low, medium (recommended), high, xhigh | Most capable coding model |
| GPT-5.3 Codex Spark | `gpt-5.3-codex-spark` | Built-in | low, medium, high | Near-instant, real-time iteration |
| GPT-5.2 Codex | `gpt-5.2-codex` | Built-in | low, medium, high, xhigh | Previous gen, still capable |

- Reasoning is always active (not togglable like Claude's extended thinking)
- xhigh = extra-long reasoning for complex problems, significantly more tokens
- medium is recommended as daily driver for most tasks

**How the selectors adapt:**

```
User selects agent: Claude Code
  -> Model dropdown shows: Opus 4.6, Sonnet 4.6, Haiku 4.5
  -> Thinking dropdown shows: Adaptive, Low, Medium, High, Max
  -> Cost estimate updates in usage panel

User selects agent: Codex CLI
  -> Model dropdown shows: GPT-5.3 Codex, GPT-5.3 Spark, GPT-5.2 Codex
  -> Thinking dropdown label changes to "Reasoning"
  -> Shows: Low, Medium, High, XHigh
  -> Cost estimate updates in usage panel

User selects agent: Aider (future)
  -> Model dropdown shows whatever models aider supports
  -> Thinking dropdown adapts or hides if not applicable
```

**Provider registry (extensible):**

```typescript
type Provider = {
  name: string                    // "anthropic" | "openai" | ...
  agent_cli: string               // "claude-code" | "codex" | ...
  models: Model[]
  thinking_label: string          // "Thinking" for Claude, "Reasoning" for Codex
  supports_adaptive: boolean
}

type Model = {
  id: string                      // "claude-opus-4-6"
  display_name: string            // "Opus 4.6"
  effort_levels: string[]         // ["low", "medium", "high", "max"]
  default_effort: string          // "high"
  pricing: {
    input_per_mtok: number
    output_per_mtok: number
  }
  context_window: number          // 200000
  max_output: number              // 128000
  supports_thinking: boolean
  supports_adaptive: boolean
  supports_vision: boolean
}
```

**Usage panel cost estimation:**

The usage tile in the left panel (split view) shows real-time estimates based on the selected model's pricing:
- Token count (prompt + completion + thinking tokens)
- Cost = tokens * model pricing rate
- Thinking tokens shown separately (they're billed as output tokens for Claude)
- For Codex, reasoning tokens shown separately

#### Agent Modes

Inspired by Kilo, Roo Code, and Cline — but unified across any agent CLI:

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Code** | Full autonomy — read, edit, create files, run commands | Default for implementation tasks |
| **Architect** | Read-only + plan output. No file edits. | "How should I structure this?" |
| **Debug** | Focus on error diagnosis — run tests, inspect logs, trace issues | "Why is this failing?" |
| **Ask** | Conversational — answer questions about the codebase | "How does auth work here?" |
| **Plan** | Propose changes as a plan, execute only on user approval | Complex changes you want to review first |
| **Review** | Analyze existing code/diff and provide feedback | Code review, PR review |
| **Custom** | User-defined modes with custom system prompts and tool permissions | "Docs Writer", "Test Generator", etc. |

Modes are implemented by:
1. Prepending a system prompt that constrains the agent's behavior
2. Optionally restricting tool access (e.g., Architect mode disables file write tools)
3. Modes are per-task — different tasks can run in different modes
4. Mode is switchable mid-session via the dropdown

**Custom mode definition:**
```json
{
  "name": "Test Writer",
  "icon": "🧪",
  "system_prompt": "You are a test writing specialist. Focus exclusively on writing comprehensive tests...",
  "allowed_tools": ["read", "write", "execute"],
  "restricted_tools": ["browser"],
  "description": "Focused on writing unit and integration tests"
}
```

**Terminal stack:**
- **Frontend**: xterm.js + xterm-addon-webgl (GPU rendering) + xterm-addon-fit (auto-resize)
- **Backend (Rust)**: portable-pty for cross-platform PTY management
- **IPC**: Tauri events stream PTY output to xterm.js, keyboard input back to PTY
- **Theming**: Custom xterm.js theme matching bento dark/light palettes
- **Font**: JetBrains Mono (bundled) or configurable

#### Smart Git Management
- No worktrees — single localhost checkout
- Each agent task works on its own branch (auto-created)
- Change tracker: knows which files each agent touched
- Automatic stash/restore when switching between agent branches
- PR-ready: each task's changes map to a clean diff
- Conflict detection: warn before two agents touch the same file
- Branch naming: `bentoya/<task-slug>` convention

#### Diff Review
- When agent completes, task auto-advances to Review column
- Inline diff viewer (like GitHub PR view)
- Approve -> creates PR (or merges directly, configurable)
- Reject -> send feedback to agent, task returns to Combobulating

### P1 - Quality of Life

#### Settings (Highly Configurable)

Settings panel — full page, tabbed layout. Every aspect of Bento-ya is configurable.

**Agent Configuration**
- Default agent CLI per workspace (claude-code, codex, aider, cursor, amp, opencode, etc.)
- Override agent per column (e.g., different agent for RCA vs implementation)
- Agent binary path / location
- Custom flags and arguments per agent
- Max concurrent agents limit
- Environment variables per agent
- Custom system prompts / instructions file path (e.g., CLAUDE.md, .cursorrules)

**Agent Modes**
- Default mode per workspace (Code, Architect, Debug, Ask, Plan, Review)
- Per-column mode override (e.g., RCA column defaults to Debug mode)
- Custom mode creator:
  - Name, icon, description
  - System prompt (what the agent should focus on)
  - Tool permissions (which tools are allowed/blocked)
  - Example custom modes: "Docs Writer", "Test Generator", "Security Audit", "Refactor"
- Import/export custom modes as JSON

**Model & Thinking**
- Default model per agent (e.g., Opus 4.6 for Claude Code, GPT-5.3 Codex for Codex CLI)
- Default effort level per model (e.g., "high" for Opus, "medium" for Codex)
- Per-task model + effort override (switchable mid-session via terminal input bar)
- Token budget limits
- Adaptive thinking toggle (Claude only — let the model decide reasoning depth)
- Provider registry: add new providers/models as they ship
- Cost display preference (show/hide cost estimates in usage panel)

**MCP Servers**
- Add/remove MCP server configurations
- Per-workspace MCP server lists
- Connection status indicators
- Auto-start MCP servers with workspace
- Server logs viewer
- Environment variable injection

**Skills & Commands**
- Register custom skills (scripts, CLI commands)
- Assign skills to column triggers
- Skill arguments configuration
- Import skills from other projects
- Built-in skills: lint, type-check, test, security-scan
- Custom skill editor (name, command, args, description)

**Voice Input**
- Whisper model selection (tiny, base, small, medium, large)
- Language preference
- Hotkey configuration (press-and-hold vs toggle)
- Sensitivity / silence detection threshold
- Auto-punctuation toggle

**Git**
- Branch prefix convention (default: `bentoya/`)
- Auto-PR creation toggle
- Default PR template (markdown editor)
- Merge strategy (squash, merge, rebase)
- Default base branch
- Auto-delete branch after merge

**Appearance**
- Theme: dark / light (system preference option)
- Accent color picker
- Font size (UI + terminal separately)
- Terminal font selection
- Card density (compact / comfortable / spacious)
- Animation speed (fast / normal / reduced motion)
- Column width preference

**Columns / Pipeline**
- Visual column editor (add, remove, reorder — drag and drop)
- Column templates library
- Import/export pipeline configs as JSON
- Default pipeline for new workspaces
- Per-column trigger and exit criteria editor

**Keyboard Shortcuts**
- Customizable hotkeys for all actions
- Vim-style navigation option
- Global hotkeys (works when app is in background)

#### Orchestrator Improvements
- Smart task decomposition (parallel vs sequential dependencies)
- Task dependency lines on the board
- Re-plan: "actually split this into smaller tasks"
- Orchestrator watches agent progress and can intervene

#### Notifications
- Desktop notifications when agent finishes, errors, or needs attention
- Sound toggle (per event type)
- Badge count on workspace tab
- Notification center (bell icon) for history
- Configurable notification rules

#### Quick Actions
- "Retry" button on failed tasks
- "Stop" button on running agents
- "Archive" completed tasks
- Bulk operations (stop all, retry all failed)
- Context menu on right-click

### P2 - Power Features

#### Multi-Agent Chat
- Chat with the orchestrator about a specific task
- "Why did you split it this way?" / "Combine these two tasks"
- Review agent's work conversationally before approving

#### Pipeline Templates
- Save column configurations as reusable templates
- "Full CI Pipeline", "Quick Fix", "Spike/Research"
- Share templates across workspaces
- Community template library (future)
- Template marketplace

#### History & Replay
- Full history of all agent sessions per workspace
- Replay terminal output
- Compare before/after for merged tasks
- Search across all workspace history
- Export session logs

#### Metrics Dashboard
- Tasks completed per day/week
- Average time per pipeline stage
- Agent success rate by column
- Cost tracking (API usage per task/workspace)
- Time saved estimates

#### Workspace Templates
- Clone workspace config (columns, agent settings, MCP servers) for new projects
- "Same setup as my other React project"

#### Production Readiness Checklists

A workspace-level feature that gives you a living checklist of everything needed to ship a production app. When you create a new workspace (project), you can attach a **readiness checklist** — a categorized, trackable guide of things to do before (and after) launch.

**The Problem**: Every new project has the same gaps. You forget to add error handling, skip accessibility, never set up CI, ship without proper logging. These aren't tasks for agents — they're meta-concerns that span the entire project lifecycle.

**How It Works**:

1. **Attach to workspace**: When creating a new workspace, option to "Add production checklist" — pick a template or start blank
2. **Checklist lives alongside the board**: Accessible via a dedicated icon in the workspace header (clipboard icon next to settings gear). Opens as a slide-over panel from the right
3. **Categorized sections**: Each category is collapsible, with items inside
4. **Items are checkable**: Manual check-off, with optional notes per item
5. **Smart items**: Some items can auto-detect completion (e.g., "Has CI/CD config" → scan for `.github/workflows/`, "Has tests" → scan for test files)
6. **Agent-assisted items**: Click "Fix this" on an unchecked item → creates a task on the board (e.g., "Add error boundaries" → spawns an agent to do it)
7. **Progress bar**: Top of checklist shows overall completion percentage
8. **Templates**: Built-in templates for common stacks, plus user-created custom templates

**Built-in Template: "Production Readiness"**

```
📋 Production Readiness Checklist          [72% complete]
                                           [████████░░░]

🔒 Security
  ☑ API keys stored securely (not in code/env files committed to git)
  ☑ Input validation on all user-facing endpoints
  ☐ Authentication/authorization implemented
  ☐ HTTPS enforced for all external calls
  ☐ Dependencies audited for vulnerabilities (npm audit / cargo audit)
  ☐ No secrets in logs or error messages
  ☐ Rate limiting on public endpoints
  ☐ CORS configured correctly

🧪 Testing
  ☑ Unit tests for core logic
  ☐ Integration tests for critical paths
  ☐ E2E tests for key user flows
  ☐ Edge cases covered (empty states, error states, boundary values)
  ☐ Tests run in CI on every PR
  ☐ Test coverage above target threshold

🏗️ Code Quality
  ☑ Linter configured and passing
  ☑ Formatter configured (consistent style)
  ☑ TypeScript strict mode / Clippy enabled
  ☐ No TODOs or FIXMEs left unresolved
  ☐ No dead code / unused imports
  ☐ Constants extracted (no magic strings/numbers)
  ☐ Functions are focused and under ~50 lines
  ☐ No duplicated logic

🚨 Error Handling
  ☐ Global error boundary (React) or panic handler (Rust)
  ☐ User-friendly error messages (not stack traces)
  ☐ Graceful degradation for network failures
  ☐ Retry logic for transient failures
  ☐ Error states designed for every view

📊 Logging & Observability
  ☐ Structured logging configured
  ☐ Key events logged (auth, errors, critical operations)
  ☐ No sensitive data in logs (PII, tokens, passwords)
  ☐ Log rotation / retention configured
  ☐ Crash reporting set up (opt-in)
  ☐ Health check endpoint (for services)

📖 Documentation
  ☐ README with setup instructions
  ☐ Architecture overview (how it works)
  ☐ Contributing guide (if open source)
  ☐ API documentation (if applicable)
  ☐ Changelog maintained
  ☐ License file present

♿ Accessibility
  ☐ Keyboard navigation works for all interactive elements
  ☐ ARIA labels on non-text elements
  ☐ Color contrast meets WCAG AA (4.5:1)
  ☐ Focus indicators visible
  ☐ Reduced motion respected
  ☐ Screen reader tested

⚡ Performance
  ☐ Lighthouse / performance audit passing
  ☐ No memory leaks (long-running sessions tested)
  ☐ Lazy loading for heavy resources
  ☐ Bundle size within target
  ☐ Database queries optimized (no N+1)
  ☐ Images/assets optimized

🚀 Deployment & CI/CD
  ☐ CI pipeline configured (lint + test + build)
  ☐ CD pipeline configured (auto-deploy on merge)
  ☐ Environment variables managed properly
  ☐ Build succeeds on clean checkout
  ☐ Release process documented
  ☐ Rollback plan exists
  ☐ Auto-update mechanism (for desktop apps)

🎨 UX Polish
  ☐ Loading states for all async operations
  ☐ Empty states designed (first-run, no data)
  ☐ Confirmation dialogs for destructive actions
  ☐ Toast/notification system for feedback
  ☐ Responsive layout (if web) or window resize handling (if desktop)
  ☐ Onboarding flow for first-time users

🌐 Operational
  ☐ Backup strategy defined
  ☐ Data export/import supported
  ☐ Privacy policy (if collecting data)
  ☐ Terms of service (if SaaS)
  ☐ Support channel established
  ☐ Analytics/telemetry (opt-in only)
```

**Additional templates**:
- **"Quick Ship"** — minimal checklist for MVPs and prototypes (just security + testing + docs basics)
- **"API Service"** — backend-specific (rate limiting, auth, OpenAPI docs, monitoring, SLAs)
- **"Mobile App"** — app store requirements, deep links, push notifications, offline mode
- **"Open Source"** — license, contributing guide, issue templates, CoC, CI badges
- **"Desktop App"** — code signing, auto-update, installer, cross-platform testing, crash reporting

**Custom checklists**:
- Create your own checklist template from scratch
- Fork a built-in template and customize it
- Export/import as JSON for sharing across teams
- Checklist templates stored in `~/.bentoya/checklists/`

**Data Model**:

```
Checklist
  id              UUID
  workspace_id    FK -> Workspace
  template_name   string (nullable — null if custom)
  title           string
  created_at      timestamp
  updated_at      timestamp

ChecklistCategory
  id              UUID
  checklist_id    FK -> Checklist
  name            string
  icon            string (emoji)
  position        int (sort order)

ChecklistItem
  id              UUID
  category_id     FK -> ChecklistCategory
  text            string
  checked         boolean
  notes           text (nullable — user notes on this item)
  auto_detect     JSON (nullable — {type: "file_exists", pattern: ".github/workflows/*"})
  task_id         FK -> Task (nullable — linked task if "Fix this" was clicked)
  position        int
  checked_at      timestamp (nullable)
  checked_by      string (nullable — "user" | "auto-detect" | "agent")
```

**UI**:

```
Workspace header:
[ Proj A ]  [ Proj B ]  [+]           [📋 72%] [⚙️] [🔔]
                                        ^
                                        checklist icon + progress

Click 📋 -->

+----------------------------------------------------------+
| Board (dimmed)              | 📋 Production Readiness    |
|                             |    72% complete ████████░░ |
|                             |                            |
|                             | 🔒 Security        5/8    |
|                             |   ☑ API keys secured      |
|                             |   ☑ Input validation      |
|                             |   ☐ Auth implemented      |
|                             |     [Fix this] [Add note] |
|                             |   ☐ HTTPS enforced        |
|                             |     ...                    |
|                             |                            |
|                             | 🧪 Testing         2/6   |
|                             |   ☑ Unit tests            |
|                             |   ☐ Integration tests     |
|                             |     [Fix this] [Add note] |
|                             |     ...                    |
|                             |                            |
|                             | [+ Add category]          |
|                             | [+ Add item]              |
+----------------------------------------------------------+
```

**"Fix this" flow**:
1. Click "Fix this" on unchecked item "Add error boundaries"
2. Bento-ya creates a task: "Add React error boundaries to all major UI sections"
3. Task enters the pipeline (Backlog → Combobulating → ...)
4. When task completes and is approved, the checklist item auto-checks
5. Checklist item links to the task for traceability

**Auto-detect examples**:
- `{ type: "file_exists", pattern: ".github/workflows/*.yml" }` → CI/CD configured
- `{ type: "file_exists", pattern: "LICENSE*" }` → License file present
- `{ type: "file_exists", pattern: "README.md" }` → README exists
- `{ type: "command_succeeds", command: "npm test" }` → Tests pass
- `{ type: "file_contains", file: "tsconfig.json", pattern: "\"strict\": true" }` → Strict mode enabled
- `{ type: "file_absent", pattern: ".env" }` → No .env committed (check gitignore)
- `{ type: "dependency_audit", command: "npm audit --audit-level=high" }` → No high vulnerabilities

---

## Layout & UI Design

### Design Philosophy
- **Bento grid**: Content organized in clean rectangular tiles with rounded corners
- **Drag everything**: Cards, columns, tabs — all draggable
- **Minimal chrome**: No unnecessary borders, shadows kept subtle
- **Centered tabs**: No sidebar — centered tab bar at top like Arc browser
- **Split focus**: Click a task -> board collapses left, terminal opens right
- **Two themes**: Dark (default) and light, both warm and clean
- **Gesture-driven**: Two-finger swipe between workspace tabs
- **Information density**: Show what matters, hide what doesn't
- **Spatial consistency**: 8px grid system, consistent gaps between tiles
- **Attention design**: Subtle but unmissable indicators when agents need you

### Board View (Default)

Full kanban board. Tabs centered at top.

```
+--------------------------------------------------------------+
|         [ Proj A ]  [ Proj B ]  [ Proj C ]  [+]              |
|                                         [mic] [notifications] [gear]  |
+--------------------------------------------------------------+
|                                                              |
|  BACKLOG    COMBOBULATING    REVIEW    SIEGE     [+column]   |
|  +-------+  +----------+   +------+  +------+              |
|  | brain |  | fix auth |   | add  |  | feat |              |
|  | dump  |  |  ● live  |   | api  |  | PR#4 |              |
|  | notes |  | [!attn]  |   |[diff]|  |[loop]|              |
|  +-------+  +----------+   +------+  +------+              |
|  +-------+  +----------+                                    |
|  | idea  |  | refactor |                                    |
|  |  ...  |  |  ● live  |                                    |
|  +-------+  +----------+                                    |
|                                                              |
+--------------------------------------------------------------+
|  [mic]  Type or speak... "fix the login validation bug"      |
+--------------------------------------------------------------+
```

- Tabs centered in the top bar
- Two-finger swipe left/right on trackpad switches tabs
- Cmd+1-9 for quick tab switching
- Global actions (mic, notifications, settings) pinned to top-right
- Bottom input bar is the orchestrator chat

### Task Focus View (Split — Click a Card)

When you click a task card, the view splits. Kanban collapses to the left showing only the relevant column. Terminal opens on the right.

```
+--------------------------------------------------------------+
|         [ Proj A ]  [ Proj B ]  [ Proj C ]  [+]              |
+------+-------------------------------------------------------+
| COMB |                                                       |
| OBUL |  Terminal                                    ● Live   |
| ATING|                                                       |
|      |  I'll fix the auth validation. Let me read the        |
| +--+ |  current implementation...                            |
| |    | |                                                     |
| |Fix | |  Reading src/auth/login.ts...                       |
| |auth| |  Reading src/utils/validation.ts...                 |
| |vali| |                                                     |
| |dati| |  Found the issue. The email regex doesn't           |
| |on  | |  handle subdomains. Fixing now...                   |
| |    | |                                                     |
| |----| |  Editing src/utils/validation.ts...                 |
| |DESC| |  Running npm test...                                |
| |Fix | |  > 12 passed, 0 failed                             |
| |the | |                                                     |
| |emai| |  All tests passing. The fix handles subdomains      |
| |l.. | |  like user@mail.example.co.uk correctly now.        |
| |    | |                                                     |
| |----| |                                                     |
| |CHNG| |                                                     |
| | 2  | |                                                     |
| |fils| |                                                     |
| | +8 | |                                                     |
| | -3 | |                                                     |
| |----| |                                                     |
| |CMTS| |                                                     |
| | 3  | |                                                     |
| +--+ |                                                       |
|      |                                                       |
|------|                                                       |
|USAGE |                                                       |
|claude|                                                       |
|sonnet|                                                       |
|12.4k |                                                       |
|tokens|                                                       |
|$0.04 |                                                       |
|02:34 |                                                       |
+------+-------------------------------------------------------+
|      | [Code ▾] [claude-sonnet ▾] [Extended ▾]               |
|      | [mic] Type message...     [📎] [⌘⏎ Send] [■ Stop]    |
+------+-------------------------------------------------------+
```

#### Left Panel — Task Detail (Collapsed Kanban)

The left panel shows only the column this task belongs to, with the task card expanded:

**Task Card (Expanded)**
- Title (editable)
- Description / notes
- Branch: `bentoya/fix-auth-validation`
- Status indicator (● Running / ✓ Done / ✕ Failed)

**Changes Section**
- File count with +/- line counts
- Expandable file list
- Click a file to see its diff

**Commits Section**
- Commit count
- Expandable list with short hashes + messages

**Usage Section** (bottom of left panel, separate tile)
- Agent + model (e.g., "Claude Code - Opus 4.6")
- Effort level (e.g., "High" or "Medium")
- Token usage breakdown:
  - Input tokens
  - Output tokens
  - Thinking/reasoning tokens (shown separately — billed as output for Claude)
- Estimated cost ($) — real-time, based on model pricing
- Session duration
- Current mode (Code / Architect / etc.)

#### Right Panel — Terminal

Full xterm.js terminal session. This is the real agent — not a summary.

**Terminal area**: Full scrollback, GPU-rendered, themed to match bento palette.

**Input bar** (bottom of right panel):
```
+--------------------------------------------------------------+
| [Code ▾]  [claude-sonnet ▾]  [Extended ▾]                   |
| [mic] Type your message here...    [📎 attach] [⌘⏎] [■ stop]|
+--------------------------------------------------------------+
```

- **Mode dropdown**: Code, Architect, Debug, Ask, Plan, Review, Custom
- **Model dropdown**: Provider-aware (e.g., Opus 4.6 / Sonnet 4.6 / Haiku 4.5 for Claude Code)
- **Thinking dropdown**: Provider-aware (e.g., Adaptive / Low / Medium / High / Max for Claude, Low / Medium / High / XHigh for Codex)
- **Mic button**: Voice input (whisper TTS), available here too
- **Text input**: Type message to agent, Cmd+Enter to send
- **Attach**: Add files, images, screenshots as context to the message
- **Send**: Cmd+Enter (configurable)
- **Stop**: Interrupt agent (SIGINT, then SIGTERM if needed). Cancels current operation.

#### Transitioning Between Views

```
Board View                          Task Focus View
+---------------------------+       +------+--------------------+
| All columns visible       |       | One  | Terminal           |
| All cards visible         | ----> | col  | Full agent session |
| Full kanban pipeline      | click | Task | Input bar          |
|                           | card  | dets |                    |
+---------------------------+       +------+--------------------+
                              <----
                              Esc / back button / click
                              outside left panel
```

- Transition is animated (board columns slide left and collapse)
- Esc or back button returns to full board view
- Other agents keep running in background
- Board view badges update in real-time even while in focus view

### Task Card (Bento Tile — Board View)

```
+----------------------------------+
|  Fix login validation       [...]|
|                                  |
|  claude-code    bentoya/fix-login|
|  ● Running  [!]      00:02:34   |
+----------------------------------+
```

- Rounded corners (12px radius)
- Subtle background tint per column
- Agent icon + branch name
- Duration timer for active tasks
- `[!]` attention indicator — pulses when agent needs you
- Click -> opens split focus view
- Draggable between columns
- Right-click for context menu (stop, retry, archive, change mode, etc.)

### Attention Indicator

When an agent needs user input or hit a blocker:
- Card gets a subtle pulsing border glow (amber/accent color)
- Small badge icon on the card
- Tab badge increments (workspace tab)
- Optional desktop notification + sound
- In focus view: the question/blocker is highlighted in the terminal with a distinct background

### Navigation & Gestures

| Action | Gesture / Shortcut |
|--------|-------------------|
| Switch workspace tabs | Two-finger swipe left/right on trackpad |
| Switch workspace tabs | Cmd+1-9 or Cmd+Shift+[ / ] |
| New workspace tab | Cmd+T |
| Close workspace tab | Cmd+W |
| Open task focus view | Click task card |
| Return to board view | Esc, or back button, or Cmd+[ |
| Send message to agent | Cmd+Enter |
| Stop/interrupt agent | Cmd+. or click stop button |
| Voice input | Hold configured hotkey (default: Cmd+Shift+V) |
| Quick switch between tasks | Cmd+J (opens task fuzzy finder) |
| Open settings | Cmd+, |
| Search tasks | Cmd+K |

### Color Palette

**Dark Theme**
```
Background:       #0D0D0D
Surface:          #1A1A1A
Surface Hover:    #242424
Border:           #2A2A2A
Text Primary:     #E5E5E5
Text Secondary:   #888888
Accent:           #E8A87C (warm peach)
Success:          #4ADE80
Warning:          #FBBF24
Error:            #F87171
Running:          #60A5FA (soft blue)
Attention:        #F59E0B (amber pulse)
```

**Light Theme**
```
Background:       #FAFAF9
Surface:          #FFFFFF
Surface Hover:    #F5F5F4
Border:           #E7E5E4
Text Primary:     #1C1917
Text Secondary:   #78716C
Accent:           #C2703E (warm terracotta)
Success:          #16A34A
Warning:          #D97706
Error:            #DC2626
Running:          #2563EB
Attention:        #D97706 (amber pulse)
```

### Typography
```
UI Text:         Inter or system font
Terminal:        JetBrains Mono (bundled)
Sizes:           14px base, 12px secondary, 16px headings
Weight:          400 normal, 500 medium (headings), 600 semi-bold (emphasis)
```

---

## Tech Stack

### Desktop Shell: Tauri v2

Tauri is confirmed. Reasons:
- Stable, battle-tested (90k+ GitHub stars, massive community)
- Tiny bundles (~5-10MB vs Electron's 150MB+)
- Rust backend handles PTY management, git operations, process lifecycle
- Built-in updater, system tray, native dialogs
- Cross-platform (macOS, Windows, Linux)
- portable-pty crate for terminal management
- Security model (sandboxed webview, explicit API surface)

### Frontend
- **React + TypeScript** - ecosystem, iteration speed
- **Tailwind CSS** - utility-first, bento grid patterns, theme switching via CSS variables
- **Zustand** - lightweight state management
- **Motion** (formerly Framer Motion) - animation engine (~85KB, 18M+ monthly downloads)
  - Layout animations for split view transitions
  - Spring physics for natural card movement
  - `AnimatePresence` for mount/unmount transitions
  - Gesture support (complements @dnd-kit)
  - `layoutId` for shared element transitions across views
  - Stagger children for card/column entry animations
  - `animate` with `repeat` for attention pulse indicators
- **@dnd-kit** - drag and drop logic (cards, columns, tabs)
  - `@dnd-kit/core` - collision detection, drag events
  - `@dnd-kit/sortable` - sortable lists (columns, cards within columns)
  - `@dnd-kit/utilities` - helpers
  - Note: @dnd-kit handles _what_ moves, Motion handles _how it looks_
- **xterm.js** - terminal emulation in webview
  - `xterm-addon-webgl` - GPU-accelerated rendering
  - `xterm-addon-fit` - auto-resize to container
  - `xterm-addon-search` - search terminal scrollback
  - `xterm-addon-unicode11` - proper unicode support
- **Shiki** - syntax highlighting for diff viewer (same engine as VS Code)

### Backend (Tauri / Rust)
- **portable-pty** - cross-platform PTY spawning and management
- **tauri** v2 - IPC, window management, system integration
- **rusqlite** - SQLite database
- **serde** - JSON serialization for configs
- **tokio** - async runtime for concurrent agent management
- **notify** - file system watching (change tracking)
- **git2** - libgit2 bindings for git operations

### Voice Input
- **whisper.cpp** compiled as Tauri sidecar binary
- Model: `whisper-tiny` (39MB) default, configurable up to `whisper-large`
- Sidecar approach: Rust spawns whisper.cpp process, streams audio, gets text back
- VAD (Voice Activity Detection) for auto-start/stop
- Models downloaded on first use (not bundled with app)

### Git Management
- **git2** (Rust libgit2 bindings) for branch operations
- Branch manager: creates, tracks, stashes per task
- Diff generator: produces clean diffs per task branch
- Conflict detector: file-level overlap checking between active agents
- PR creator: via `gh` CLI subprocess or GitHub API (octocrab crate)

### Data
- **SQLite** via rusqlite - local-first, no server needed
- Schema: workspaces, tasks, columns, agent_sessions, chat_history, settings
- Config: `~/.bentoya/config.json` (global settings)
- Per-workspace config stored in DB

### Build & Package
- **pnpm** for frontend dependencies
- **Vite** for frontend bundling
- **Cargo** for Rust backend
- Tauri bundler for .dmg / .app / .msi / .AppImage

---

## Data Model

```
Workspace
  id              UUID
  name            string
  repo_path       string
  default_agent   string
  settings        JSON (workspace-level overrides)
  tab_order       int
  is_active       boolean
  created_at      timestamp
  updated_at      timestamp

Column
  id              UUID
  workspace_id    FK -> Workspace
  slug            string (url-safe identifier)
  name            string
  icon            string
  position        int (sort order, drag to reorder)
  trigger_type    enum (none, agent, skill, script, webhook)
  trigger_config  JSON
  exit_type       enum (manual, agent_complete, script_success, checklist_done, pr_approved)
  exit_config     JSON
  auto_advance    boolean
  color           string
  visible         boolean (toggle for archived, etc.)
  created_at      timestamp

Task
  id              UUID
  workspace_id    FK -> Workspace
  column_id       FK -> Column
  title           string
  description     text
  notes           text (for backlog brain dumps)
  branch          string
  files_touched   string[] (change tracking)
  agent_type      string
  agent_mode      string (code, architect, debug, ask, plan, review, custom)
  agent_model     string (nullable, override — e.g., "claude-opus-4-6", "gpt-5.3-codex")
  effort_level    string (nullable, override — e.g., "high", "medium", "xhigh")
  priority        int
  position        int (sort order within column)
  parent_id       FK -> Task (nullable, for subtasks)
  pr_number       int (nullable)
  pr_url          string (nullable)
  checklist       JSON (nullable, for manual test column)
  created_at      timestamp
  updated_at      timestamp

AgentSession
  id              UUID
  task_id         FK -> Task
  agent_type      string
  pid             int
  status          enum (running, completed, failed, stopped, needs_attention)
  started_at      timestamp
  ended_at        timestamp
  token_usage     JSON (nullable)
  terminal_buffer text (scrollback history for replay)

ChatMessage
  id              UUID
  workspace_id    FK -> Workspace
  role            enum (user, orchestrator, system)
  content         text
  task_ids        UUID[] (tasks created/referenced)
  input_type      enum (text, voice)
  created_at      timestamp

Settings (global + per-workspace override)
  id              UUID
  scope           enum (global, workspace)
  workspace_id    FK -> Workspace (nullable)

  -- Agent
  agent_default         string
  agent_paths           JSON { agent_name: binary_path }
  agent_max_concurrent  int
  agent_custom_flags    JSON { agent_name: string[] }
  agent_env_vars        JSON { agent_name: { key: value } }
  agent_instructions    JSON { agent_name: file_path }

  -- Modes
  agent_default_mode    string (code, architect, debug, ask, plan, review)
  agent_custom_modes    JSON[] {
                          name, icon, system_prompt, allowed_tools[],
                          restricted_tools[], description
                        }
  agent_column_modes    JSON { column_slug: mode_name } (per-column default mode)

  -- Model & Thinking
  providers             JSON[] {
                          name: string,         # "anthropic" | "openai"
                          agent_cli: string,    # "claude-code" | "codex"
                          default_model: string,# "claude-opus-4-6"
                          default_effort: string,# "high"
                          models: Model[]       # registered models
                        }
  token_budget          int (nullable)
  adaptive_thinking     boolean (Claude only)
  show_cost_estimates   boolean

  -- MCP
  mcp_servers           JSON[] {
                          name, command, args[], env{}, auto_start
                        }

  -- Skills
  skills                JSON[] {
                          name, command, description, args_schema
                        }

  -- Voice
  voice_model           string (tiny, base, small, medium, large)
  voice_language        string
  voice_hotkey          string
  voice_sensitivity     float
  voice_mode            enum (push_to_talk, toggle, continuous)

  -- Git
  git_branch_prefix     string (default: "bentoya/")
  git_auto_pr           boolean
  git_pr_template       text
  git_merge_strategy    enum (squash, merge, rebase)
  git_base_branch       string (default: "main")
  git_auto_delete       boolean

  -- Appearance
  theme                 enum (dark, light, system)
  accent_color          string
  font_size_ui          int
  font_size_terminal    int
  terminal_font         string
  card_density          enum (compact, comfortable, spacious)
  animation_speed       enum (fast, normal, reduced)

  -- Pipeline
  default_pipeline      JSON (column template for new workspaces)

  created_at            timestamp
  updated_at            timestamp
```

---

## Architecture

```
+----------------------------------------------------------+
|  Bento-ya (Tauri v2)                                     |
|                                                          |
|  +-------------------+  +-----------------------------+  |
|  |  React Frontend   |  |  Rust Backend               |  |
|  |                   |  |                             |  |
|  |  Tab Bar (DnD)    |  |  Process Manager            |  |
|  |  Kanban Board     |  |    portable-pty             |  |
|  |   Columns (DnD)   |  |    Agent lifecycle          |  |
|  |   Cards (DnD)     |  |    Concurrent via tokio     |  |
|  |  Terminal View    |  |                             |  |
|  |   xterm.js+WebGL  |  |  Git Manager (git2)         |  |
|  |  Chat Input       |  |    Branch per task          |  |
|  |  Voice Indicator  |  |    Change tracking          |  |
|  |  Diff Viewer      |  |    Stash/restore            |  |
|  |  Settings Panel   |  |    Conflict detection       |  |
|  |                   |  |                             |  |
|  +--------+----------+  |  Pipeline Engine            |  |
|           |              |    Column triggers          |  |
|           |  Tauri IPC   |    Auto-advance logic       |  |
|           | (events +    |    Skill/script runner      |  |
|           |  commands)   |                             |  |
|           +--------------+  Whisper Sidecar            |  |
|                          |    whisper.cpp binary       |  |
|                          |    Audio capture            |  |
|                          |    VAD detection            |  |
|                          |                             |  |
|                          |  SQLite (rusqlite)          |  |
|                          +-----------------------------+  |
+----------------------------------------------------------+
        |              |              |
  +-----+------+ +----+-----+ +-----+------+
  | Agent PTY  | | Agent    | | Agent      |
  | claude-code| | codex    | | aider      |
  | task-1     | | task-2   | | task-3     |
  +-----+------+ +----+-----+ +-----+------+
        |              |              |
  [branch:         [branch:       [branch:
   bentoya/         bentoya/       bentoya/
   fix-login]       add-api]       refactor]
```

### Terminal Architecture Detail

```
Click task card
      |
      v
Frontend: create/show xterm.js instance for this task
      |
      v
IPC: subscribe to Tauri event channel "pty:{task_id}"
      |
      v
Backend: already has PTY running for this task's agent
  - portable-pty::CommandBuilder::new("claude-code")
  - Spawned when task entered Combobulating column
  - Output continuously buffered and sent via Tauri events
      |
      v
Frontend: xterm.js renders output in real-time
  - WebGL addon for GPU-accelerated rendering
  - Themed to match bento dark/light palette
  - Scrollback preserved (configurable limit)
      |
      v
User types in input bar
  - Frontend sends input via Tauri command
  - Backend writes to PTY stdin
  - Agent receives input, continues working
```

### Smart Git Management (No Worktrees)

```
Single repo checkout
        |
        +-- main (base branch)
        |
        +-- bentoya/fix-login     (task 1 - agent A)
        +-- bentoya/add-api       (task 2 - agent B)
        +-- bentoya/refactor-auth (task 3 - agent C)

Change Tracker:
  task-1: [src/login.ts, src/validation.ts]
  task-2: [src/api/routes.ts, src/api/handlers.ts]
  task-3: [src/auth/middleware.ts]

Conflict Matrix:
  task-1 vs task-2: NO OVERLAP -> safe to parallel
  task-1 vs task-3: POSSIBLE (both touch auth-adjacent) -> warn

Each agent:
  1. Bento-ya creates branch: git checkout -b bentoya/<slug> from main
  2. Agent spawns in PTY, working directory = repo root
  3. Agent works normally (reads, edits, runs tests)
  4. Bento-ya tracks all file changes via git diff
  5. When done -> diff is clean, PR-ready
  6. If conflict detected with another active task -> flag to user
```

---

## Drag and Drop Specification

Everything in Bento-ya is draggable. The entire UI is a spatial workspace you arrange.

### What's Draggable

| Element | Drag Behavior | Drop Target |
|---------|---------------|-------------|
| **Task Card** | Pick up card, ghost follows cursor | Any column (reorder within or move between columns) |
| **Column** | Pick up entire column | Between other columns (reorder pipeline) |
| **Workspace Tab** | Pick up tab | Between other tabs (reorder) |

### DnD Implementation (@dnd-kit)

```typescript
// Board uses SortableContext for columns
<DndContext onDragEnd={handleDragEnd}>
  <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
    {columns.map(col => (
      <SortableColumn key={col.id} column={col}>
        {/* Each column has its own SortableContext for cards */}
        <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
          {cards.map(card => <SortableCard key={card.id} card={card} />)}
        </SortableContext>
      </SortableColumn>
    ))}
  </SortableContext>
</DndContext>
```

### Visual Feedback
- **Pick up**: Card lifts with subtle scale(1.02) + shadow
- **Dragging**: Ghost overlay follows cursor, original spot shows dotted placeholder
- **Over target**: Drop zone highlights with accent color border
- **Drop**: Smooth animation to final position
- **Invalid drop**: Card snaps back with gentle bounce

### Pipeline Trigger on Drop
When a card is dropped into a new column:
1. Position updated in DB
2. If column has a trigger -> trigger fires
3. If auto_advance is set on previous column -> skip (was auto-moved)
4. Visual feedback: brief flash on card confirming trigger started

---

## Animation Specification

Bento-ya should feel alive. Every state change, transition, and interaction has considered motion. The animation engine is **Motion** (formerly Framer Motion).

### Animation Principles
- **Purpose over decoration**: Every animation communicates something (state change, spatial relationship, feedback)
- **Fast by default**: Transitions should feel snappy (200-300ms), never sluggish
- **Spring physics**: Use spring-based easing for natural feel, not linear/ease-in-out
- **Interruptible**: All animations can be interrupted mid-flight (clicking during a transition doesn't break anything)
- **Reducible**: Respect `prefers-reduced-motion` — all animations have a reduced/off mode in settings

### Animation Catalog

#### Board View

| Animation | Trigger | Duration | Easing | Details |
|-----------|---------|----------|--------|---------|
| **Card appear** | Task created | 300ms | spring(stiffness: 300, damping: 25) | Fade in + scale from 0.95 -> 1.0, stagger 50ms between cards |
| **Card reorder** | Drag within column | auto | spring(stiffness: 500, damping: 30) | `layout` prop — other cards slide to make room |
| **Card move between columns** | Drop in new column | 300ms | spring(stiffness: 400, damping: 28) | Card flies to new column, old spot collapses, new spot opens |
| **Card remove** | Archived/deleted | 200ms | easeOut | Scale to 0.95 + fade out |
| **Column appear** | "+" column added | 400ms | spring(stiffness: 300, damping: 25) | Expand from 0 width, other columns slide to make room |
| **Column reorder** | Drag column | auto | spring(stiffness: 400, damping: 30) | `layout` prop — columns slide horizontally |
| **Column remove** | Delete column | 300ms | easeOut | Collapse width to 0, other columns fill space |
| **Auto-advance** | Exit criteria met | 500ms | spring(stiffness: 250, damping: 22) | Card lifts, flies to next column with arc motion |

#### Split View Transition

| Animation | Trigger | Duration | Easing | Details |
|-----------|---------|----------|--------|---------|
| **Open split** | Click task card | 400ms | spring(stiffness: 300, damping: 28) | Board columns slide left + collapse. Active column stays, narrows. Terminal slides in from right. Card expands vertically. |
| **Close split** | Esc / back | 350ms | spring(stiffness: 350, damping: 30) | Reverse of open. Terminal slides right. Columns expand back. |
| **Shared element** | Card in board -> expanded card in split | 400ms | spring | `layoutId` on card — smoothly morphs from compact to expanded |

Implementation sketch:
```tsx
// The card has a layoutId that persists across board and split view
<motion.div layoutId={`task-${task.id}`} layout>
  {isExpanded ? <TaskCardExpanded task={task} /> : <TaskCardCompact task={task} />}
</motion.div>

// Board columns use layout animation to collapse/expand
<motion.div layout style={{ width: isSplitView ? '240px' : 'auto' }}>
  <Column />
</motion.div>

// Terminal panel uses AnimatePresence for enter/exit
<AnimatePresence>
  {isSplitView && (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
    >
      <TerminalView task={activeTask} />
    </motion.div>
  )}
</AnimatePresence>
```

#### Tab Bar

| Animation | Trigger | Duration | Easing | Details |
|-----------|---------|----------|--------|---------|
| **Tab switch** | Click / swipe / Cmd+N | 250ms | spring(stiffness: 400, damping: 30) | Board content crossfades. Active tab indicator slides. |
| **Tab add** | "+" clicked | 300ms | spring | New tab expands from 0 width, slides in from right |
| **Tab close** | Close button | 200ms | easeOut | Tab collapses, neighbors slide to fill |
| **Tab reorder** | Drag tab | auto | spring | Smooth horizontal reorder with `layout` |
| **Swipe gesture** | Two-finger swipe | velocity-based | spring(damping: 20) | Board slides left/right following finger, snaps to nearest tab. Elastic overscroll at edges. |

Swipe implementation sketch:
```tsx
const x = useMotionValue(0)
const controls = useDragControls()

<motion.div
  drag="x"
  dragControls={controls}
  dragConstraints={{ left: 0, right: 0 }}
  dragElastic={0.1}
  onDragEnd={(_, info) => {
    if (info.velocity.x > 500) switchTab('prev')
    else if (info.velocity.x < -500) switchTab('next')
  }}
  style={{ x }}
>
  <BoardContent />
</motion.div>
```

#### Attention Indicators

| Animation | Trigger | Duration | Easing | Details |
|-----------|---------|----------|--------|---------|
| **Pulse glow** | Agent needs attention | 2s loop | ease-in-out | Border glow pulses between 0 and accent color opacity. Subtle, not jarring. |
| **Badge bounce** | New attention event | 300ms | spring(stiffness: 500) | Badge scales 1.0 -> 1.3 -> 1.0 with spring bounce |
| **Tab badge** | Attention in background tab | 300ms | spring | Badge number increments with brief scale pulse |

```tsx
// Attention pulse on task card
<motion.div
  animate={{
    boxShadow: needsAttention
      ? ['0 0 0 0 rgba(245,158,11,0)', '0 0 0 4px rgba(245,158,11,0.3)', '0 0 0 0 rgba(245,158,11,0)']
      : 'none'
  }}
  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
/>
```

#### Micro-interactions

| Animation | Trigger | Duration | Easing |
|-----------|---------|----------|--------|
| **Card hover** | Mouse enter | 150ms | ease | Subtle lift: translateY(-2px) + shadow increase |
| **Button press** | Click | 100ms | ease | Scale to 0.97 then back to 1.0 |
| **Dropdown open** | Click selector | 200ms | spring | Scale from 0.95 + fade in, origin from trigger button |
| **Toast notification** | Event | 300ms in, 200ms out | spring / easeOut | Slide in from top-right, fade out on dismiss |
| **Status dot** | Agent starts | 500ms | ease | Fade in + brief scale pulse. Running state has subtle continuous pulse. |
| **Input focus** | Focus chat/terminal input | 200ms | ease | Border color transitions to accent |
| **Voice waveform** | Speaking | realtime | linear | Audio-reactive bars, smooth interpolation between levels |
| **Settings panel** | Open/close | 350ms | spring | Slide in from right as overlay, dim background |

### Performance Guidelines

- Use `will-change: transform` on frequently animated elements
- Prefer `transform` and `opacity` animations (GPU-composited, no layout thrash)
- Avoid animating `width`/`height` directly — use `scale` or `layout` animations instead
- Keep concurrent animations under 10 active at a time
- xterm.js terminal should never be animated (GPU-rendered separately)
- Use `useReducedMotion()` hook to respect system preference

### Animation Speed Settings

Users can configure in settings:

| Setting | Options | Effect |
|---------|---------|--------|
| **Fast** | All durations * 0.6 | Snappy, minimal transitions |
| **Normal** | Default durations | Balanced, the designed experience |
| **Reduced** | Only opacity fades, no transforms | Accessibility-friendly, no motion sickness |

---

## User Stories

### First Run
1. Open Bento-ya, see empty state with "+" tab
2. Click "+" to add workspace, select repo directory
3. Default pipeline columns appear (Backlog through Archived)
4. Type in chat: "I need to add user authentication"
5. Orchestrator creates 3 tasks in Backlog
6. All three auto-advance to Combobulating (agents spawn)

### Working Session
1. See 3 tasks in Combobulating, agents running
2. Task 1 gets `[!]` attention indicator — click the card
3. Board splits: left shows Combobulating column with expanded task details, right shows terminal
4. Terminal shows: agent asking "Should I use JWT or sessions?"
5. Type "JWT" in input bar (Cmd+Enter to send), agent continues
6. Left panel shows files changing in real-time, token count ticking up
7. Press Esc to go back to full board view
8. Task 2 finished -> auto-advanced to Review
9. Click it, see diff in the changes section, approve -> PR created, moves to Siege
10. PR gets comments -> Siege loop handles them automatically
11. Done -> moves to Manual Test with auto-generated checklist

### Mode Switching
1. Working on a task in Code mode (default)
2. Agent is about to make a big refactor — want to review first
3. Switch to Plan mode via dropdown in terminal input bar
4. Agent proposes changes without executing, you review
5. Approve the plan, switch back to Code mode, agent executes
6. Or switch to Architect mode to ask "what's a better approach?"

### Swipe Navigation
1. Working on frontend workspace, agents running
2. Two-finger swipe right on trackpad -> switches to backend workspace tab
3. See backend board, different tasks, different pipeline
4. Notification badge on frontend tab: "1 needs attention"
5. Two-finger swipe left -> back to frontend
6. Or Cmd+1 / Cmd+2 for quick switching

### Voice Workflow
1. Hold hotkey, say "the signup form has a bug where email validation isn't working"
2. Whisper transcribes locally, text appears in chat input
3. Orchestrator creates task: "Fix email validation in signup form"
4. Task enters pipeline automatically

### Custom Pipeline
1. Right-click between Review and Siege columns
2. "Add column here"
3. Name: "E2E Tests", trigger: script (`npm run test:e2e`)
4. Exit criteria: script success
5. Drag it to the right position if needed
6. Now tasks pass through E2E tests before PR creation

### Rearranging the Board
1. Don't like column order? Grab a column header, drag it
2. Want to prioritize a task? Drag the card up in its column
3. Think a task should skip review? Drag it past Review to Siege
4. Pipeline is YOUR workflow — arrange it how you think

---

## What Makes This Different

| Feature | Conductor | Vibe Kanban | Bento-ya |
|---------|-----------|-------------|----------|
| Navigation | Separate workspaces | Single project | Centered tabs + swipe gestures |
| Task creation | Manual | Issue tracker | Voice/text -> auto-decompose |
| Columns | N/A | Static labels | Automated pipeline stages |
| Column config | N/A | Limited | Fully configurable (trigger, exit, add/remove/reorder) |
| Task focus | Per-workspace terminal | Side panel | Split view: collapsed kanban + terminal |
| Agent modes | N/A | N/A | Code, Architect, Debug, Ask, Plan, Review, Custom |
| Git strategy | Worktrees | Worktrees | Smart branch management |
| Orchestrator | None | None | Built-in per workspace |
| Voice input | No | No | Embedded whisper.cpp (input bar + board) |
| Drag and drop | No | Cards only | Everything (cards, columns, tabs) |
| Terminal controls | Basic | Basic | Mode/model/thinking selectors, attach, stop, TTS |
| Customization | Limited | Settings page | Deep config (agents, modes, MCP, skills, columns, themes) |
| Design | Functional | Feature-rich | Bento minimal |
| Themes | Dark only | Dark/light | Dark + light |

---

## Security

### API Key & Secret Management
- **Tauri Stronghold**: Use `tauri-plugin-stronghold` for encrypted secret storage (AES-256-GCM)
- API keys (Anthropic, OpenAI, GitHub tokens) are never stored in plaintext — always in the OS keychain or Stronghold vault
- Keys never leave the Rust backend; frontend requests agent actions via IPC, backend injects credentials
- No keys in SQLite, no keys in logs, no keys in crash reports
- Per-workspace secrets: each workspace can have its own API keys (personal vs org)

### Agent Sandboxing
- Each agent PTY runs as a child process of the Tauri backend
- File system access is scoped to the workspace repo directory
- Option to run agents with restricted permissions (read-only mode for review agents)
- Future: container-based isolation for untrusted agents (P2)

### IPC Security (Tauri v2)
- Tauri v2 capabilities system: each frontend permission (fs access, shell, network) is explicitly declared in `capabilities/` files
- IPC commands are typed and validated on the Rust side — frontend can't bypass command signatures
- No arbitrary shell execution from frontend; all commands go through defined Tauri command handlers

### Network Security
- HTTPS-only for all external API calls (Anthropic, OpenAI, GitHub)
- No telemetry or phone-home unless user explicitly opts in
- Whisper runs fully local — audio never leaves the machine
- MCP server connections are user-configured and auditable

### Input Sanitization
- Terminal input: sanitized before writing to PTY stdin (no escape sequence injection)
- Chat input: sanitized before sending to orchestrator
- Column trigger scripts: validated paths, no arbitrary injection
- Settings import: schema-validated before applying

### Update Security
- Tauri's built-in updater verifies code signatures
- Updates served over HTTPS with signature verification
- Users can disable auto-update and manually install

---

## Error Handling & Resilience

### Crash Recovery
- **State persistence**: All task/column state is in SQLite — app restarts restore the board exactly
- **Agent reconnection**: If the app crashes, PTY processes are orphaned. On restart, detect orphaned agent branches and offer to reconnect or clean up
- **Undo/redo**: Board-level undo for task moves, column changes, accidental deletes (in-memory stack, 50 levels)
- **Auto-save**: Settings and board state saved on every mutation, not just on close

### Agent Failure Handling
- Agent PTY exits unexpectedly → card gets `[!]` attention indicator with "Agent exited (code N)"
- Agent stuck (no output for configurable timeout) → prompt user: "Agent idle for 5m — restart?"
- Agent produces error output → parse common patterns (rate limit, auth failure, OOM) and surface actionable message
- Network loss during agent work → agent continues locally, status bar shows "Offline" badge

### Graceful Degradation
- GitHub unreachable → PR creation queued, retry when online
- Whisper model missing → voice button disabled with "Download model" link
- SQLite corruption → auto-detect, offer to restore from last backup
- Git conflicts → don't crash, surface conflict UI with resolution options

### Error Boundaries (React)
- Each major UI section (board, terminal, settings) wrapped in error boundary
- Terminal crash doesn't take down the board
- Board crash doesn't kill running agents
- Error states show "Something went wrong" with retry button, not blank screens

---

## Testing Strategy

### Unit Tests
- **Frontend (Vitest)**: Store logic (Zustand), hooks, utility functions, pipeline logic
- **Backend (Rust `#[test]`)**: Git operations, PTY management, SQLite queries, pipeline trigger evaluation
- Coverage target: 80%+ for logic-heavy modules (stores, pipeline engine, git manager)

### Integration Tests
- **Tauri IPC**: Test command handlers end-to-end (Rust handler → SQLite → response)
- **Terminal flow**: Spawn real PTY, send input, verify output streaming
- **Pipeline triggers**: Create task, advance through columns, verify triggers fire
- **Git flow**: Branch creation, change tracking, conflict detection against real git repos

### E2E Tests (Playwright / WebDriver)
- **Board operations**: Create task, drag between columns, verify state
- **Split view**: Click card, verify terminal opens, type input, verify agent receives it
- **Tab management**: Add workspace, switch tabs, close tab
- **Settings**: Change theme, verify UI updates. Change model, verify selector updates
- **DnD**: Drag card between columns, drag column to reorder, verify persistence

### Snapshot Tests
- Component snapshots for visual regression (task card, column, tab bar)
- Theme snapshots: verify dark/light palettes apply correctly

### Manual Test Checklist (per release)
- Fresh install on clean machine
- Upgrade from previous version (data migration)
- Multiple workspaces running agents simultaneously
- Network disconnection during agent work
- Large repo (10k+ files) — no UI lag
- Whisper voice input → task creation flow

---

## Logging & Observability

### Structured Logging (Rust)
- Use `tracing` crate with structured JSON output
- Log levels: ERROR (user-facing failures), WARN (recoverable issues), INFO (key events), DEBUG (development)
- Key events logged: agent start/stop, column transitions, PTY spawn/exit, git operations, IPC calls
- Logs written to `~/.bentoya/logs/` with daily rotation (7-day retention default)

### Frontend Logging
- Structured console logging with `[module]` prefixes
- Error boundary catches → logged with component stack
- Performance marks for animation frame drops, terminal render times
- IPC call timing (warn if >500ms)

### Diagnostics
- **"Export diagnostics" button** in settings: bundles logs, system info, config (no secrets) into a zip
- System info: OS version, Tauri version, app version, available memory, GPU info
- Agent info: CLI version, model in use, session duration
- Useful for bug reports

### Crash Reporting (opt-in)
- Optional Sentry/similar integration for crash telemetry
- Disabled by default, explicit opt-in in settings
- PII-stripped: no file paths, no terminal content, no API keys
- Just: stack trace, OS, app version, event leading to crash

---

## Auto-Update

### Tauri Updater Plugin
- `tauri-plugin-updater` for self-updating
- Check for updates on launch (configurable: always / daily / weekly / never)
- Show non-intrusive toast: "Update available (v0.2.1) — Install now or later"
- Download in background, apply on next restart
- No forced updates — user always has the choice

### Release Channels
- **Stable**: Default, tested releases
- **Beta**: Early access for testers (opt-in in settings)
- Configurable in settings → Appearance → Update channel

### Migration
- SQLite schema migrations run automatically on update
- Settings schema changes handled with defaults for new fields
- Backward-compatible: opening a newer DB in an older app shows a warning

---

## Accessibility

### Keyboard Navigation
- Full keyboard control without mouse:
  - `Tab` / `Shift+Tab` to navigate between cards, columns, panels
  - `Enter` to open/interact, `Esc` to close/back
  - Arrow keys within columns (up/down cards) and across columns (left/right)
  - `Cmd+1..9` for workspace tab switching
  - `Cmd+K` command palette for everything
- Keyboard shortcuts configurable in settings
- Focus ring visible on all interactive elements (2px accent color outline)

### Screen Reader Support
- ARIA roles on all interactive elements (listbox for columns, listitem for cards, tablist for workspace tabs)
- Live regions for agent status changes ("Task 1 moved to Review")
- Card details announced on focus (title, status, column, attention state)
- Terminal: xterm.js has built-in screen reader mode (a11y addon)

### Reduced Motion
- `prefers-reduced-motion` media query respected globally
- All spring animations → instant or crossfade only
- DnD: no fly animations, just snap to position
- Settings toggle for manual override
- Three levels: Full motion / Reduced / None

### Color & Contrast
- WCAG AA contrast ratios (4.5:1 minimum) for all text
- Status colors (green/yellow/red) paired with icon shapes, not color alone
- Attention indicators use both pulse animation AND icon/text
- High contrast mode option (P2)

### Typography
- Minimum body text: 14px, minimum controls: 12px
- Scalable: settings option for UI scale (90% / 100% / 110% / 120%)
- Monospace font (JetBrains Mono) bundled — no font loading issues

---

## Performance

### Memory Management
- Each xterm.js terminal instance uses ~10-30MB depending on scrollback
- **Terminal pooling**: Only keep active + 2 recently-viewed terminals in memory; destroy others, recreate on click
- **Scrollback limits**: Default 5000 lines, configurable (less = less memory)
- **Lazy rendering**: Columns outside viewport are virtualized (only DOM elements for visible cards)

### Startup Performance
- Target: app window visible in <1s, board interactive in <2s
- SQLite read is fast — no network dependency on startup
- Defer: whisper model loading, update checks, non-active workspace data
- Preload: active workspace board data, theme, settings

### Rendering
- xterm.js WebGL addon for GPU-accelerated terminal rendering (60fps scrolling)
- React concurrent mode for non-blocking board updates while terminal is active
- `useMemo` / `React.memo` on card components — re-render only on data change
- DnD overlays rendered in a portal to avoid layout thrash
- Virtualized card lists for columns with 50+ cards

### Agent Concurrency
- Default max concurrent agents: 5 (configurable)
- Each agent PTY is a separate OS process — Tauri backend manages via `tokio`
- IPC event channels per agent — no blocking between agents
- Git operations serialized per-repo to avoid lock contention

### Bundle Size
- Tauri produces 5-15MB app bundles (vs 200MB+ Electron)
- Frontend JS target: <500KB gzipped (React + Motion + xterm.js + Zustand + @dnd-kit + Shiki)
- Tree-shake aggressively — import only needed Motion features
- Whisper model downloaded separately (not bundled with app)

---

## Data & Backup

### Local-First
- All data in SQLite at `~/.bentoya/data.db`
- No cloud sync requirement — works fully offline (except agent API calls)
- Settings in `~/.bentoya/settings.json` (human-readable, version-controlled)

### Backup
- Auto-backup SQLite on schema migration (before applying changes)
- Manual backup: Settings → Data → "Export backup" (zip of DB + settings + column configs)
- Restore: Settings → Data → "Import backup"
- Backup retention: keep last 5 auto-backups

### Export / Import
- **Export workspace**: JSON bundle with columns, tasks (without terminal history), pipeline config
- **Import workspace**: Load JSON bundle into new tab
- **Export pipeline template**: Just column configs for sharing
- **Import pipeline template**: Apply column layout to existing workspace
- CSV export for task data (for reporting)

### Data Cleanup
- Archived tasks auto-purge after configurable days (default: 30)
- Terminal scrollback not persisted to DB (in-memory only, per session)
- Agent session logs stored in filesystem (`~/.bentoya/sessions/`), rotated by age

---

## Onboarding & First Run

### Setup Wizard (first launch)
1. **Welcome** — "Welcome to Bento-ya" with product tagline, one screenshot
2. **Agent setup** — Detect installed CLIs (claude-code, codex). If none found, show install instructions. Let user configure API keys
3. **Workspace** — Select first repo directory, auto-detect project name
4. **Pipeline** — Show default pipeline columns, explain what each does. "Customize later in settings"
5. **Theme** — Pick dark or light
6. **Done** — Drop into the board, ready to go

### Empty States
- Empty board: "No tasks yet. Type below or speak to create tasks." with subtle animated arrow pointing to input
- Empty column: Dotted border, "Tasks will appear here when they reach this stage"
- No workspaces: Single "+" tab with "Add your first project" tooltip

### Onboarding Tooltips
- First task created: "Click the card to see the agent working"
- First split view: "Esc to go back to the full board"
- First drag: "You can drag cards between columns, or drag columns to reorder"
- Dismiss individually or "Skip all" option
- Don't show again after first complete pass

---

## Code Quality Standards

### Frontend (TypeScript + React)
- **TypeScript**: Strict mode, no `any` (use `unknown` + type guards)
- **Linting**: ESLint with `@typescript-eslint`, React hooks rules, import ordering
- **Formatting**: Prettier (single quotes, no semicolons, 100 char width)
- **Components**: Functional only, named exports, props interface above component
- **Naming**: `kebab-case` files, `PascalCase` components, `camelCase` functions/variables
- **Imports**: Absolute imports via `@/` alias, grouped (react → external → internal → types)

### Backend (Rust)
- **Clippy**: `#[deny(clippy::all)]` — zero clippy warnings
- **Formatting**: `rustfmt` with default config
- **Error handling**: `thiserror` for typed errors, no `.unwrap()` in production code (use `?` propagation)
- **Naming**: Standard Rust conventions (`snake_case` everything, `PascalCase` types)
- **Documentation**: `///` doc comments on all public functions and structs

### CI/CD Pipeline
- **On PR**: lint + format check + type-check + unit tests + clippy
- **On merge to main**: full test suite + build all platforms
- **Release**: tag-based, builds macOS (aarch64 + x86_64), signs, uploads to GitHub Releases
- Platform: GitHub Actions

### Code Review
- PRs require 1 approval (when team grows)
- Auto-checks: no `any`, no `.unwrap()`, no `console.log` (only structured logging)
- Changelog entry required for user-facing changes

---

## Documentation

### User Documentation
- **In-app help**: `?` button → contextual help for current view
- **Command palette hints**: Each action shows keyboard shortcut
- **Settings descriptions**: Every setting has a one-line description below it
- **Website docs** (P1): Getting started, pipeline configuration, agent setup, troubleshooting

### Developer Documentation
- **README.md**: Setup instructions, architecture overview, contribution guide
- **ARCHITECTURE.md**: System diagram, data flow, module responsibilities
- **CONTRIBUTING.md**: PR process, code style, testing expectations
- **ADR (Architecture Decision Records)**: Key decisions documented (why Tauri, why xterm.js, why SQLite)
- **Inline comments**: Only for non-obvious logic — code should be self-documenting

### API Documentation
- Tauri IPC commands documented with input/output types
- SQLite schema documented with relationships
- Pipeline trigger interface documented for custom trigger authors

---

## Offline Support

### What Works Offline
- Board view, drag and drop, column management — all local
- Settings changes — all local
- Viewing existing task details, diffs, commit history — all local (git data)
- Voice input — whisper.cpp is fully local

### What Needs Network
- Agent API calls (Anthropic, OpenAI) — agents can't work without their API
- GitHub PR creation/updates — queued if offline, sent when back online
- MCP server connections — depends on server location
- App update checks

### Offline Indicators
- Status bar shows connection state: "Online" / "Offline"
- Agent spawn buttons disabled when offline (with tooltip: "API unreachable")
- Queued operations badge: "2 actions pending — will sync when online"

---

## Cost Controls

### Usage Tracking
- Track per-task: tokens in, tokens out, model used, estimated cost
- Track per-workspace: total spend (rolling 24h, 7d, 30d)
- Track per-model: breakdown by model (Opus vs Sonnet vs GPT-5)
- Displayed in task detail panel (usage section) and settings dashboard

### Budget Limits
- Set max spend per workspace (daily/monthly) — agent spawning paused when hit
- Set max tokens per task — agent warned/stopped at threshold
- Warning at 80% of budget: toast notification
- Hard stop at 100%: agents paused, user prompted

### Cost Estimation
- Before spawning agent: estimate cost based on task complexity + model pricing
- Show in task creation: "Estimated: ~$0.15 (Claude Sonnet)"
- History of actual vs estimated for calibration

---

## Internationalization (i18n)

### v1 Scope
- English only for all UI text
- But: architecture supports i18n from day one

### Architecture
- All user-facing strings extracted to locale files (`src/locales/en.json`)
- Use `react-i18next` or lightweight alternative
- No hardcoded strings in components
- Date/time formatting via `Intl` API (respects system locale even in English)
- Number formatting (token counts, costs) via `Intl.NumberFormat`

### Future
- Community-contributed translations (P2)
- RTL layout support (P2)

---

## Open Questions

1. **Orchestrator model** — Should the orchestrator be a persistent Claude Code instance, or a lighter API call (just for task decomposition)?
2. **Agent protocol** — Standard interface for different agents, or Claude Code only for v1?
3. **Remote repos** — SSH support for remote repos, or local-only for MVP?
4. **Collaboration** — Single user only, or multi-user from the start?
5. **Column marketplace** — Should custom columns/pipeline templates be shareable?
6. **Cost tracking** — Track API spend per task/workspace? Requires parsing agent output.
7. **Platform priority** — Mac-first then cross-platform, or all platforms from day one?
8. **Whisper model bundling** — Download on first use (current plan), or offer a smaller bundled model?
9. **Agent sandboxing** — Should each agent get a sandboxed environment, or just branch isolation?

---

## MVP Scope

### v0.1 - "It Works"
- Single workspace (one tab)
- Manual task creation (skip orchestrator)
- 4 default columns: Backlog | Working | Review | Done
- Columns are draggable + reorderable
- Cards are draggable between columns
- Spawn Claude Code per task on its own branch
- Click card -> full terminal view (xterm.js + portable-pty)
- Smart git: branch-per-task, change tracking
- Basic diff view on completion
- Dark theme only
- Text input only (skip voice)

### v0.2 - "Pipeline"
- Multi-workspace tabs (draggable)
- Add/remove/configure custom columns
- Column triggers and exit criteria
- Auto-advance between columns
- Orchestrator agent (chat -> tasks)
- Attention indicators

### v0.3 - "Voice & Config"
- Embedded whisper.cpp voice input
- Full settings panel (agents, MCP, skills, themes)
- Light theme
- Column + pipeline templates
- Production readiness checklists (templates, manual check-off, progress tracking)

### v0.4 - "Siege"
- PR creation from review column
- Comment-watch loop (siege column)
- Manual test checklist generation
- Notification column
- Checklist auto-detect (scan repo for completion signals)
- Checklist "Fix this" → task creation flow

### v1.0 - "Bento-ya"
- Pipeline templates library
- History & replay
- Metrics dashboard
- Community templates
- Polish and ship

---

## File Structure

```
bento-ya/
  src-tauri/                    # Rust backend (Tauri v2)
    src/
      main.rs                   # Tauri entry point
      lib.rs                    # Module exports
      commands/                 # Tauri IPC command handlers
        workspace.rs            # CRUD workspaces
        task.rs                 # CRUD tasks, move between columns
        column.rs               # CRUD columns, reorder
        agent.rs                # Start/stop/status agents
        terminal.rs             # PTY input/output streaming
        git.rs                  # Branch, diff, PR operations
        settings.rs             # Read/write settings
        voice.rs                # Whisper sidecar control
        checklist.rs            # CRUD checklists, items, auto-detect
      process/
        pty_manager.rs          # PTY pool (portable-pty)
        agent_runner.rs         # Agent lifecycle management
        sidecar.rs              # Whisper + other sidecars
      git/
        branch_manager.rs       # Create, switch, stash, track
        change_tracker.rs       # File-level change tracking
        conflict_detector.rs    # Cross-task overlap detection
        pr_creator.rs           # GitHub PR via gh CLI / octocrab
      pipeline/
        engine.rs               # Column trigger execution
        trigger_runner.rs       # Run triggers (agent, skill, script)
        advance_logic.rs        # Exit criteria evaluation
      db/
        mod.rs                  # SQLite connection (rusqlite)
        schema.rs               # Table definitions
        migrations/             # Schema migrations
      checklist/
        auto_detect.rs          # File/command-based auto-detection
        templates.rs            # Built-in checklist templates
      config/
        defaults.rs             # Default settings + pipeline template
    Cargo.toml
    tauri.conf.json
    capabilities/               # Tauri v2 capability files

  src/                          # Frontend (React + TypeScript)
    main.tsx                    # React entry
    app.tsx                     # Root component, routing
    components/
      layout/
        tab-bar.tsx             # Centered workspace tabs (DnD + swipe)
        board.tsx               # Main kanban board (full view)
        split-view.tsx          # Split layout: collapsed kanban + terminal
        chat-input.tsx          # Text + voice input bar (orchestrator)
      kanban/
        column.tsx              # Sortable column container (DnD)
        column-header.tsx       # Name, config menu, drag handle
        column-add.tsx          # "+" add column button/dialog
        task-card.tsx           # Bento tile card (DnD, compact)
        task-card-expanded.tsx  # Expanded card in split view (details, changes, commits)
        drag-overlay.tsx        # Ghost overlay during drag
        attention-badge.tsx     # Pulse indicator component
      terminal/
        terminal-view.tsx       # Terminal pane (xterm.js, right side of split)
        terminal-input.tsx      # Input bar: mode/model/thinking dropdowns, send, stop, attach, mic
        mode-selector.tsx       # Agent mode dropdown (Code, Architect, Debug, etc.)
        model-selector.tsx      # Model picker dropdown
        thinking-selector.tsx   # Thinking level dropdown
      task-detail/
        task-detail-panel.tsx   # Left panel in split view
        changes-section.tsx     # Files changed, +/- counts, expandable
        commits-section.tsx     # Commit list for this task
        usage-section.tsx       # Token usage, cost, duration, model info
      review/
        diff-viewer.tsx         # Syntax-highlighted diff (Shiki)
        review-actions.tsx      # Approve/reject buttons
      voice/
        voice-indicator.tsx     # Waveform / recording state
        voice-button.tsx        # Mic toggle (in chat input + terminal input)
      checklist/
        checklist-panel.tsx     # Slide-over panel with full checklist
        checklist-category.tsx  # Collapsible category section
        checklist-item.tsx      # Individual checkable item with actions
        checklist-progress.tsx  # Progress bar + percentage
        checklist-picker.tsx    # Template picker dialog (new workspace)
      settings/
        settings-panel.tsx      # Full-page settings container
        agent-settings.tsx      # Agent CLI config
        mode-settings.tsx       # Agent modes editor (built-in + custom)
        mcp-settings.tsx        # MCP server management
        skill-settings.tsx      # Custom skills editor
        voice-settings.tsx      # Whisper config
        git-settings.tsx        # Git preferences
        column-editor.tsx       # Visual pipeline editor (DnD)
        appearance-settings.tsx # Theme, fonts, density
        shortcuts-settings.tsx  # Keyboard shortcut editor
      shared/
        button.tsx
        input.tsx
        dialog.tsx
        dropdown.tsx
        badge.tsx
        tooltip.tsx
    stores/
      workspace-store.ts        # Active workspaces, tab order
      task-store.ts             # Tasks per workspace
      column-store.ts           # Column configs per workspace
      terminal-store.ts         # Terminal instances, active view
      settings-store.ts         # Global + per-workspace settings
      ui-store.ts               # Current view (board vs split), modals, active task
      mode-store.ts             # Agent modes (built-in + custom)
      checklist-store.ts        # Checklists, categories, items per workspace
    hooks/
      use-pipeline.ts           # Column trigger/advance logic
      use-git.ts                # Branch management
      use-voice.ts              # Whisper integration
      use-agent.ts              # Agent lifecycle
      use-dnd.ts                # Shared DnD handlers
      use-theme.ts              # Dark/light theme switching
      use-shortcuts.ts          # Keyboard shortcut handling
      use-swipe.ts              # Trackpad swipe gesture detection
      use-split-view.ts         # Split view open/close transitions
      use-checklist.ts          # Checklist state, auto-detect, fix-this flow
    lib/
      ipc.ts                    # Tauri invoke/listen wrappers
      agent-registry.ts         # Known agent types + configs
      mode-registry.ts          # Built-in + custom agent modes
      theme.ts                  # Theme definitions (dark/light)
      xterm-theme.ts            # xterm.js color schemes
    types/
      index.ts                  # Shared TypeScript types
      workspace.ts
      task.ts
      column.ts
      settings.ts
      agent.ts
      mode.ts                   # AgentMode, CustomMode types
      checklist.ts              # Checklist, ChecklistItem, AutoDetect types

  public/
    fonts/
      JetBrainsMono.woff2       # Bundled terminal font
    icons/

  package.json
  pnpm-lock.yaml
  tailwind.config.ts
  vite.config.ts
  tsconfig.json
```
