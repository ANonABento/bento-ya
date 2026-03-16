# Column Triggers System

> **Status:** Design
> **Updated:** 2025-03-15

## Overview

A unified action system for task automation. Triggers fire at lifecycle points (entry/exit) and execute configurable actions. This is the **single routing layer** for all task automation - CLI spawning, task chaining, dependencies, and future integrations.

### Core Concepts

1. **Triggers**: Fire at `on_entry` (task lands in column) or `on_exit` (task leaves)
2. **Actions**: What happens when trigger fires (spawn CLI, move task, trigger another task)
3. **Hierarchy**: Column defines defaults → Task can override
4. **Chaining**: Task A completion can trigger Task B

---

## Trigger Lifecycle

```
Task enters column
       │
       ▼
┌─────────────┐
│  on_entry   │──► Action executes (spawn CLI, etc.)
└─────────────┘
       │
       ▼
  Task active
       │
       ▼
┌─────────────┐
│  on_exit    │──► Action executes (move, trigger dependents)
└─────────────┘
       │
       ▼
Task moves to next column (next column's on_entry fires)
```

---

## Action Types

### spawn_cli

Spawn a CLI process and feed it a command + prompt.

```typescript
{
  type: 'spawn_cli',
  cli: 'claude' | 'codex' | 'aider',
  command: '/start-task',           // slash command
  prompt_template: '{task.title}\n{task.trigger_prompt}',
  flags: ['--verbose'],
  use_queue: true                   // use agent queue (max 5)
}
```

### move_column

Move the task to another column.

```typescript
{
  type: 'move_column',
  target: 'next' | 'previous' | '<column_id>'
}
```

### trigger_task

Trigger another task to do something. Used for dependencies/chaining.

```typescript
{
  type: 'trigger_task',
  target_task: '<task_id>' | '{dependency.task_id}',
  action: 'move_column' | 'start' | 'unblock',
  target_column?: 'next' | '<column_id>',
  // Optional: pass data to triggered task
  inject_prompt?: 'Output from {task.title}: {task.output}'
}
```

### none

No-op. Explicitly disable inherited trigger.

```typescript
{
  type: 'none'
}
```

---

## Task Dependencies

Tasks can declare dependencies on other tasks. When a dependency completes, it can trigger the dependent task.

### Schema

```typescript
interface TaskDependency {
  /** Task ID this task depends on */
  task_id: string;
  /** What triggers this dependency as "met" */
  condition: 'completed' | 'moved_to_column' | 'agent_complete';
  /** Column the dependency must reach (for moved_to_column) */
  target_column?: string;
  /** What to do when dependency is met */
  on_met: TriggerAction;
}

interface Task {
  // ... existing fields

  /** Tasks this task depends on */
  dependencies?: TaskDependency[];

  /** Tasks that depend on this task (computed/cached) */
  dependents?: string[];

  /** Prompt/context for triggered CLI */
  trigger_prompt?: string;

  /** Output from last agent run (for chaining) */
  last_output?: string;
}
```

### Dependency Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Task A: "Build auth API"                                         │
│ Column: In Progress                                              │
│ dependents: [Task B, Task C]                                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           │ Task A completes (exits column)
                           │
           ┌───────────────┴───────────────┐
           ▼                               ▼
┌──────────────────────┐       ┌──────────────────────┐
│ Task B: "Build UI"   │       │ Task C: "Write docs" │
│ dependencies: [A]     │       │ dependencies: [A]     │
│ blocked: true        │       │ blocked: true        │
│                      │       │                      │
│ on_met:              │       │ on_met:              │
│   move to "Ready"    │       │   move to "Ready"    │
└──────────────────────┘       └──────────────────────┘
           │                               │
           ▼                               ▼
    Task B unblocked,              Task C unblocked,
    moved to "Ready"               moved to "Ready"
    column, on_entry               column, on_entry
    trigger fires                  trigger fires
```

### Chef Creates Dependent Tasks

```
User: "Build a login system with API, UI, and tests"

Chef (orchestrator):
  1. create_task({
       id: "task-a",
       title: "Build auth API",
       column: "Backlog"
     })

  2. create_task({
       id: "task-b",
       title: "Build login UI",
       column: "Blocked",
       dependencies: [{
         task_id: "task-a",
         condition: "completed",
         on_met: { type: "move_column", target: "Ready" }
       }],
       trigger_prompt: "Use the auth API from task-a. Endpoints: {dep.task-a.last_output}"
     })

  3. create_task({
       id: "task-c",
       title: "Write auth tests",
       column: "Blocked",
       dependencies: [{
         task_id: "task-a",
         condition: "completed",
         on_met: { type: "move_column", target: "Ready" }
       }]
     })

Now:
- Task A in Backlog, no dependencies
- Task B in Blocked, waiting on A
- Task C in Blocked, waiting on A

User moves Task A to "In Progress" → agent works → completes

On Task A completion:
- System finds dependents [B, C]
- Executes on_met for each
- Task B moves to "Ready" → on_entry fires → agent starts
- Task C moves to "Ready" → on_entry fires → agent starts
```

---

## Template Variables

Prompts support variable interpolation:

| Variable | Description |
|----------|-------------|
| `{task.id}` | Task UUID |
| `{task.title}` | Task title |
| `{task.description}` | Task description |
| `{task.trigger_prompt}` | Chef-provided prompt |
| `{task.last_output}` | Output from last agent run |
| `{task.pr_number}` | PR number if exists |
| `{task.pr_url}` | PR URL |
| `{column.name}` | Current column name |
| `{prev_column.name}` | Previous column (on_entry) |
| `{next_column.name}` | Next column (on_exit) |
| `{workspace.path}` | Workspace repo path |
| `{dep.<task_id>.title}` | Dependency task's title |
| `{dep.<task_id>.last_output}` | Dependency task's output |

---

## Config Hierarchy

```
COLUMN CONFIG (defaults)
│
│  triggers: {
│    on_entry: { type: "spawn_cli", command: "/start-task" }
│    on_exit:  { type: "move_column", target: "next" }
│  }
│
└──► TASK OVERRIDES (wins)
     │
     │  trigger_overrides: {
     │    on_entry: { prompt: "Custom prompt..." }
     │    skip_triggers: false
     │  }
     │
     └──► RESOLVED = merged config
```

### Resolution Algorithm

```typescript
function resolveTrigger(column, task, hook) {
  // Skip if task says so
  if (task.trigger_overrides?.skip_triggers) return null;

  // Get column default
  const base = column.triggers?.[hook];
  if (!base || base.type === 'none') return null;

  // Merge task overrides (task wins)
  const override = task.trigger_overrides?.[hook];
  return override ? { ...base, ...override } : base;
}
```

---

## Data Model

### columns table

```sql
-- New unified triggers column (replaces trigger_config + exit_config)
ALTER TABLE columns ADD COLUMN triggers TEXT DEFAULT '{}';

-- JSON structure:
-- {
--   "on_entry": { "type": "spawn_cli", "cli": "claude", "command": "/start-task", ... },
--   "on_exit": { "type": "move_column", "target": "next" },
--   "exit_criteria": { "type": "agent_complete", "auto_advance": true }
-- }
```

### tasks table

```sql
-- Task-level trigger config
ALTER TABLE tasks ADD COLUMN trigger_overrides TEXT DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN trigger_prompt TEXT;
ALTER TABLE tasks ADD COLUMN last_output TEXT;

-- Dependencies
ALTER TABLE tasks ADD COLUMN dependencies TEXT DEFAULT '[]';
-- JSON array of TaskDependency objects

-- Blocked state (computed from unmet dependencies)
ALTER TABLE tasks ADD COLUMN blocked INTEGER DEFAULT 0;
```

### TypeScript Types

```typescript
// ─── Actions ────────────────────────────────────────────────────

type ActionType = 'spawn_cli' | 'move_column' | 'trigger_task' | 'none';

interface SpawnCliAction {
  type: 'spawn_cli';
  cli?: 'claude' | 'codex' | 'aider';
  command?: string;
  prompt_template?: string;
  prompt?: string;  // Direct prompt (overrides template)
  flags?: string[];
  use_queue?: boolean;
}

interface MoveColumnAction {
  type: 'move_column';
  target: 'next' | 'previous' | string;
}

interface TriggerTaskAction {
  type: 'trigger_task';
  target_task: string;  // task_id or template like {dependency.task_id}
  action: 'move_column' | 'start' | 'unblock';
  target_column?: string;
  inject_prompt?: string;
}

interface NoneAction {
  type: 'none';
}

type TriggerAction = SpawnCliAction | MoveColumnAction | TriggerTaskAction | NoneAction;

// ─── Triggers ───────────────────────────────────────────────────

interface ColumnTriggers {
  on_entry?: TriggerAction;
  on_exit?: TriggerAction;
  exit_criteria?: ExitCriteria;
}

interface TaskTriggerOverrides {
  on_entry?: Partial<SpawnCliAction>;
  on_exit?: Partial<TriggerAction>;
  skip_triggers?: boolean;
}

// ─── Dependencies ───────────────────────────────────────────────

interface TaskDependency {
  task_id: string;
  condition: 'completed' | 'moved_to_column' | 'agent_complete';
  target_column?: string;
  on_met: TriggerAction;
}

// ─── Task ───────────────────────────────────────────────────────

interface Task {
  // ... existing fields
  trigger_overrides?: TaskTriggerOverrides;
  trigger_prompt?: string;
  last_output?: string;
  dependencies?: TaskDependency[];
  blocked?: boolean;
}
```

---

## Execution Engine

### on_entry Execution

```typescript
async function executeOnEntry(task: Task, column: Column, prevColumn?: Column) {
  const action = resolveTrigger(column, task, 'on_entry');
  if (!action) return;

  const context = {
    task,
    column,
    prev_column: prevColumn,
    workspace: await getWorkspace(task.workspaceId),
  };

  await executeAction(action, context);
}
```

### on_exit Execution

```typescript
async function executeOnExit(task: Task, column: Column, nextColumn: Column) {
  const action = resolveTrigger(column, task, 'on_exit');
  if (!action) return;

  const context = { task, column, next_column: nextColumn, workspace };
  await executeAction(action, context);

  // After exit, check if any tasks depend on this one
  await checkDependents(task);
}
```

### Dependency Check

```typescript
async function checkDependents(completedTask: Task) {
  // Find tasks that depend on this one
  const dependents = await db.query(
    `SELECT * FROM tasks
     WHERE json_extract(dependencies, '$[*].task_id') LIKE ?`,
    [`%${completedTask.id}%`]
  );

  for (const dependent of dependents) {
    for (const dep of dependent.dependencies) {
      if (dep.task_id !== completedTask.id) continue;

      // Check if condition is met
      const met = await checkDependencyCondition(dep, completedTask);
      if (!met) continue;

      // Execute on_met action
      const context = {
        task: dependent,
        dependency: completedTask,
        dep: { [completedTask.id]: completedTask },
      };

      await executeAction(dep.on_met, context);
    }
  }
}
```

---

## UI Components

### Column Settings → Triggers Tab

```
┌─────────────────────────────────────────────────────────────────┐
│ Column: In Progress                                              │
├───────────┬───────────┬──────────┐                              │
│ General   │ Triggers  │ Advanced │                              │
└───────────┴─────┬─────┴──────────┘                              │
                  │                                                │
│  ON ENTRY                                                        │
│  ─────────                                                       │
│  Action:  [Spawn CLI ▼]                                         │
│  CLI:     [Claude    ▼]                                         │
│  Command: /start-task                                            │
│  Prompt:  ┌──────────────────────────────────────┐              │
│           │ {task.title}                          │              │
│           │ {task.description}                    │              │
│           │ {task.trigger_prompt}                 │              │
│           └──────────────────────────────────────┘              │
│                                                                  │
│  ON EXIT                                                         │
│  ───────                                                         │
│  Action:  [Move column ▼]                                       │
│  Target:  [Next        ▼]                                       │
│                                                                  │
│  EXIT CRITERIA                                                   │
│  ─────────────                                                   │
│  When:    [Agent complete ▼]                                    │
│  ☑ Auto-advance                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Task Settings Modal

Access: Task card 3-dot menu → "Configure"

```
┌─────────────────────────────────────────────────────────────────┐
│ Task: Build auth API                                             │
├───────────┬──────────────┐                                      │
│ Triggers  │ Dependencies │                                      │
└─────┬─────┴──────────────┘                                      │
      │                                                            │
│  ☐ Skip all triggers                                            │
│                                                                  │
│  PROMPT OVERRIDE                                                 │
│  ────────────────                                                │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ Custom prompt from chef goes here...                  │       │
│  │                                                       │       │
│  │ Use existing patterns in src/auth/                    │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  ℹ️ Command "/start-task" inherited from column                  │
└─────────────────────────────────────────────────────────────────┘
```

### Task Settings → Dependencies Tab

```
┌─────────────────────────────────────────────────────────────────┐
│ Task: Build login UI                                             │
├───────────┬──────────────┐                                      │
│ Triggers  │ Dependencies │                                      │
└───────────┴──────┬───────┘                                      │
                   │                                               │
│  DEPENDS ON                                                      │
│  ──────────                                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ ☑ Build auth API                                         │    │
│  │   Condition: [Completed        ▼]                        │    │
│  │   On met:    [Move to "Ready"  ▼]                        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  [+ Add dependency]                                              │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  BLOCKS (tasks waiting on this one)                             │
│  ──────                                                          │
│  • Write auth tests                                              │
│  • Update API docs                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Chef Tool Updates

### create_task

```typescript
interface CreateTaskInput {
  title: string;
  description?: string;
  column_id?: string;

  // Trigger config
  trigger_prompt?: string;
  trigger_overrides?: TaskTriggerOverrides;

  // Dependencies
  dependencies?: TaskDependency[];
}
```

### Example: Chef Creates Task Chain

```typescript
// Chef creates a multi-task workflow
await create_task({
  id: "auth-api",
  title: "Build auth API",
  trigger_prompt: "Build JWT-based auth with refresh tokens..."
});

await create_task({
  id: "auth-ui",
  title: "Build login UI",
  dependencies: [{
    task_id: "auth-api",
    condition: "completed",
    on_met: { type: "move_column", target: "ready" }
  }],
  trigger_prompt: "Create login form using auth API. Endpoints: {dep.auth-api.last_output}"
});

await create_task({
  id: "auth-tests",
  title: "Write auth tests",
  dependencies: [{
    task_id: "auth-api",
    condition: "completed",
    on_met: { type: "move_column", target: "ready" }
  }]
});
```

---

## Migration

### From Old trigger_config

```sql
UPDATE columns SET triggers = json_object(
  'on_entry', CASE json_extract(trigger_config, '$.type')
    WHEN 'agent' THEN json_object(
      'type', 'spawn_cli',
      'cli', coalesce(json_extract(trigger_config, '$.config.agent'), 'claude'),
      'command', '/start-task',
      'prompt_template', '{task.title}\n\n{task.description}'
    )
    WHEN 'skill' THEN json_object(
      'type', 'spawn_cli',
      'cli', 'claude',
      'command', '/' || coalesce(json_extract(trigger_config, '$.config.skill'), 'code-check')
    )
    ELSE json_object('type', 'none')
  END,
  'on_exit', json_object('type', 'move_column', 'target', 'next'),
  'exit_criteria', exit_config
);
```

---

## Files to Modify

| Layer | File | Changes |
|-------|------|---------|
| DB | `migrations/024_triggers.sql` | New columns |
| DB | `src-tauri/src/db/mod.rs` | Types + queries |
| Engine | `src-tauri/src/pipeline/mod.rs` | New execution logic |
| Engine | `src-tauri/src/pipeline/template.rs` | Variable interpolation |
| Engine | `src-tauri/src/pipeline/dependencies.rs` | Dependency resolution |
| Commands | `src-tauri/src/commands/task.rs` | trigger_overrides, dependencies |
| Commands | `src-tauri/src/commands/column.rs` | New triggers format |
| Frontend | `src/types/index.ts` | New types |
| Frontend | `src/components/kanban/task-settings-modal.tsx` | NEW |
| Frontend | `src/components/kanban/task-context-menu.tsx` | Add Configure |
| Frontend | `src/components/settings/column-triggers-tab.tsx` | Extend |
| Stores | `src/stores/task-store.ts` | Handle new fields |

---

## Future (V2+)

| Feature | Description |
|---------|-------------|
| `before_entry` hook | Validation, can block entry |
| `during_task` hook | React to git/file events |
| Webhooks | HTTP POST to external URLs |
| Conditional triggers | `if: task.pr_number` guards |
| Parallel actions | Multiple actions per hook |
| DAG visualization | Show task dependency graph |
| Cross-workspace deps | Task in workspace A triggers task in B |
