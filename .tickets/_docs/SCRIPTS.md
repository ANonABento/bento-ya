# Scripts — Reusable Automation Recipes

## Overview

Scripts are step-by-step automation recipes that plug into column triggers. They replace raw trigger JSON with human-readable, agent-editable, shareable automation blocks.

A script is a YAML-like definition with named steps. Each step is either a shell command, an agent prompt, or a check. Template variables (`{task.title}`, `{workspace.path}`, etc.) are interpolated at runtime.

## Data Model

```typescript
type Script = {
  id: string
  name: string
  description: string
  steps: Step[]
  isBuiltIn: boolean
  createdAt: string
  updatedAt: string
}

type Step = BashStep | AgentStep | CheckStep

type BashStep = {
  type: 'bash'
  name?: string                // human label, e.g. "Create branch"
  command: string              // shell command with template vars
  workDir?: string             // default: {workspace.path}
  continueOnError?: boolean    // default: false
}

type AgentStep = {
  type: 'agent'
  name?: string                // human label, e.g. "Write PR description"
  prompt: string               // agent prompt with template vars
  model?: string               // opus/sonnet/haiku (default: task.model or column default)
  command?: string             // slash command, e.g. /start-task, /code-check
}

type CheckStep = {
  type: 'check'
  name?: string                // human label, e.g. "Tests pass"
  command: string              // shell command — exit 0 = pass, non-zero = fail
  failMessage?: string         // shown if check fails
}
```

## Storage

Scripts stored in `scripts` DB table:

```sql
CREATE TABLE scripts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  steps TEXT NOT NULL,           -- JSON array of steps
  is_built_in INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Steps stored as JSON string — simple, flexible, no schema migrations for new step types.

## Built-In Scripts

Ship with the app, read-only:

### 1. Code Check
```json
{
  "name": "Code Check",
  "description": "Run type-check and linter",
  "steps": [
    { "type": "bash", "name": "Type check", "command": "npm run type-check" },
    { "type": "bash", "name": "Lint", "command": "npm run lint" }
  ]
}
```

### 2. Run Tests
```json
{
  "name": "Run Tests",
  "description": "Run the test suite",
  "steps": [
    { "type": "bash", "name": "Run tests", "command": "npm test" }
  ]
}
```

### 3. Create PR
```json
{
  "name": "Create PR",
  "description": "Create a pull request from the task branch",
  "steps": [
    { "type": "bash", "name": "Push branch", "command": "git push -u origin HEAD" },
    { "type": "bash", "name": "Create PR", "command": "gh pr create --title '{task.title}' --fill" }
  ]
}
```

### 4. AI Code Review
```json
{
  "name": "AI Code Review",
  "description": "Agent reviews the diff and suggests improvements",
  "steps": [
    { "type": "agent", "name": "Review code", "prompt": "Review the changes on this branch. Check for bugs, security issues, and code quality. Suggest improvements.\n\nTask: {task.title}\n{task.description}", "model": "sonnet" }
  ]
}
```

### 5. Full Pipeline
```json
{
  "name": "Full Pipeline",
  "description": "Implement, test, review, and create PR",
  "steps": [
    { "type": "agent", "name": "Implement", "prompt": "{task.title}\n\n{task.description}", "command": "/start-task" },
    { "type": "bash", "name": "Type check", "command": "npm run type-check" },
    { "type": "bash", "name": "Tests", "command": "npm test" },
    { "type": "check", "name": "All green", "command": "npm run lint", "failMessage": "Lint errors found" },
    { "type": "bash", "name": "Create PR", "command": "gh pr create --title '{task.title}' --fill" }
  ]
}
```

## Trigger Integration

### Column Config

In the column trigger editor, replace the raw SpawnCli config with a script picker:

```
on_entry: [Select Script v]
  - None
  - Code Check
  - Run Tests
  - Create PR
  - AI Code Review
  - Full Pipeline
  - Custom...          <- opens script editor

exit_criteria: [Select Script v]  (for script_success type)
  - Code Check passes
  - Run Tests pass
  - Custom check...
```

### How it maps to existing TriggerAction

A script is syntactic sugar over SpawnCli + bash execution:

```
Script selected as on_entry trigger
  -> stored in column.triggers.on_entry as:
     { type: "run_script", script_id: "code-check" }

At runtime:
  fire_trigger() sees run_script
  -> loads script from DB
  -> executes steps sequentially
  -> bash steps: run via std::process::Command
  -> agent steps: spawn CLI via spawn_cli_trigger_task
  -> check steps: run command, fail pipeline if non-zero
```

### New TriggerAction variant

```rust
// In triggers.rs, add to TriggerActionV2:
RunScript {
    script_id: String,
    overrides: Option<HashMap<String, String>>,  // override template vars
}
```

## Script Editor UI

### In Settings (Board tab or new Scripts tab)

```
┌─────────────────────────────────────────┐
│ Scripts                          [+ New]│
│                                         │
│ Built-in:                               │
│ ┌─────────────────────────────────────┐ │
│ │ Code Check        type-check + lint │ │
│ │ Run Tests         test suite        │ │
│ │ Create PR         push + gh pr      │ │
│ │ AI Code Review    agent reviews diff│ │
│ │ Full Pipeline     implement to PR   │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Custom:                                 │
│ ┌─────────────────────────────────────┐ │
│ │ My Deploy Script          [Edit]    │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### Script Editor (modal)

```
┌─────────────────────────────────────────┐
│ Edit Script                        [x]  │
│                                         │
│ Name: [My Deploy Script          ]      │
│ Desc: [Deploy to staging         ]      │
│                                         │
│ Steps:                                  │
│ ┌─ 1. bash ────────────────────── [x] ┐ │
│ │ Name: Build                         │ │
│ │ Command: npm run build              │ │
│ └─────────────────────────────────────┘ │
│ ┌─ 2. check ───────────────────── [x] ┐ │
│ │ Name: Build succeeded               │ │
│ │ Command: test -d dist               │ │
│ └─────────────────────────────────────┘ │
│ ┌─ 3. bash ────────────────────── [x] ┐ │
│ │ Name: Deploy                        │ │
│ │ Command: rsync -av dist/ server:/   │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [+ Add Step]                            │
│                                         │
│ Available variables:                    │
│ {task.title}  {task.description}        │
│ {workspace.path}  {column.name}         │
│                                         │
│            [Cancel]    [Save]           │
└─────────────────────────────────────────┘
```

Steps are drag-reorderable. Each step has a type badge (bash/agent/check) and a delete button.

## MCP Integration

Add to bento-mcp:

```
list_scripts       -> list all scripts
create_script      -> create custom script (name, steps JSON)
run_script         -> execute script on a task
```

An external agent can create scripts programmatically:
```
create_script({
  name: "My Custom Flow",
  steps: [
    { type: "bash", command: "npm test" },
    { type: "agent", prompt: "Fix any failing tests" }
  ]
})
```

## Execution Engine

### In pipeline/mod.rs (new)

```rust
pub fn execute_script(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
    script_id: &str,
) -> Result<Task, AppError> {
    let script = db::get_script(conn, script_id)?;
    let steps: Vec<Step> = serde_json::from_str(&script.steps)?;

    for (i, step) in steps.iter().enumerate() {
        // Update task status: "Running step 2/5: Build"
        emit_step_progress(app, task, i, steps.len(), &step.name);

        match step {
            Step::Bash { command, work_dir, continue_on_error } => {
                let output = execute_bash(command, work_dir, task)?;
                if !output.status.success() && !continue_on_error {
                    return handle_step_failure(conn, app, task, &step.name, &output);
                }
            }
            Step::Agent { prompt, model, command } => {
                // Spawn CLI and wait for completion
                spawn_and_wait(app, task, prompt, model, command)?;
            }
            Step::Check { command, fail_message } => {
                let output = execute_bash(command, None, task)?;
                if !output.status.success() {
                    return handle_check_failure(conn, app, task, fail_message);
                }
            }
        }
    }

    // All steps passed
    mark_complete(conn, app, &task.id, true)
}
```

## Implementation Phases

### Phase 1: Data Model + Built-ins (1-2 hrs)
- Migration: create scripts table
- Seed 5 built-in scripts
- Rust: Script struct, CRUD functions
- Frontend: Script type

### Phase 2: Script Picker in Column Config (1-2 hrs)
- Replace raw SpawnCli editor with script dropdown
- Add RunScript trigger variant
- Column config shows script name instead of JSON

### Phase 3: Script Editor UI (2-3 hrs)
- Script list in Settings
- Editor modal (create/edit custom scripts)
- Step builder with type selector
- Drag to reorder steps

### Phase 4: Execution Engine (2-3 hrs)
- Sequential step execution
- Bash step runner
- Agent step runner (reuse spawn_cli_trigger_task)
- Check step runner
- Progress events per step
- Error handling + retry per step

### Phase 5: MCP + Polish (1 hr)
- list_scripts, create_script, run_script tools
- Import/export scripts as JSON

Total: ~8-10 hours across 5 phases
