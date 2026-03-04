# T039: Orchestrator Intelligence (Tool Use & Task Creation)

> **Status**: Ready for Implementation
>
> **Priority**: HIGH — Makes orchestrator actually useful
>
> **Depends on**: T033 (LLM streaming infrastructure)

## Summary

Add the intelligence layer that makes the orchestrator useful:
1. **System prompt**: Tell LLM about board structure and capabilities
2. **Tool use**: Structured output via Anthropic tool_use
3. **Task actions**: Create, update, move, delete tasks from chat
4. **Context injection**: Include board state in each request

Without this, the orchestrator is just a chatbot. With this, it becomes a task management assistant.

## Current State (after T033)

- ✅ LLM streaming works (API + CLI modes)
- ✅ Messages stored and displayed
- ❌ **No system prompt** — LLM doesn't know about the board
- ❌ **No tools** — Can't create tasks, just chat
- ❌ **No context** — Doesn't see current columns/tasks

## Acceptance Criteria

- [ ] System prompt describes board structure and orchestrator role
- [ ] Board context (columns, tasks) injected into each request
- [ ] Tool definitions for task operations
- [ ] Tool calls parsed and executed (create/update/move tasks)
- [ ] Task changes reflected immediately on board
- [ ] Conversation history maintained for context
- [ ] Works with both API mode (native tool_use) and CLI mode (parse JSON)

---

## Technical Design

### System Prompt

```
You are the orchestrator for a Kanban task board called "bento-ya".

Your role is to help the user manage their tasks:
- Create new tasks when asked
- Update existing tasks (title, description, column)
- Organize and prioritize work
- Answer questions about current board state

Current board state will be provided with each message.

When taking actions, use the provided tools. Always confirm what you did.
```

### Board Context (injected per request)

```json
{
  "workspace": "My Project",
  "columns": [
    { "id": "col-1", "name": "Backlog", "position": 0 },
    { "id": "col-2", "name": "In Progress", "position": 1 },
    { "id": "col-3", "name": "Done", "position": 2 }
  ],
  "tasks": [
    { "id": "task-1", "title": "Fix login bug", "column": "In Progress" },
    { "id": "task-2", "title": "Add dark mode", "column": "Backlog" }
  ]
}
```

### Tool Definitions

```typescript
const ORCHESTRATOR_TOOLS = [
  {
    name: 'create_task',
    description: 'Create a new task on the board',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description (optional)' },
        column: { type: 'string', description: 'Column name to place task in (default: first column)' }
      },
      required: ['title']
    }
  },
  {
    name: 'update_task',
    description: 'Update an existing task',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID to update' },
        title: { type: 'string', description: 'New title (optional)' },
        description: { type: 'string', description: 'New description (optional)' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'move_task',
    description: 'Move a task to a different column',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID to move' },
        column: { type: 'string', description: 'Target column name' }
      },
      required: ['task_id', 'column']
    }
  },
  {
    name: 'delete_task',
    description: 'Delete a task from the board',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID to delete' }
      },
      required: ['task_id']
    }
  }
]
```

### Architecture

```
User: "Create 3 tasks for auth system"
           │
           ▼
┌─────────────────────────────────┐
│ Build Request                   │
│ - System prompt                 │
│ - Board context (columns/tasks) │
│ - Conversation history          │
│ - User message                  │
│ - Tool definitions              │
└─────────────────────────────────┘
           │
           ▼
    LLM (T033 streaming)
           │
           ▼
┌─────────────────────────────────┐
│ Response with tool_use          │
│ [                               │
│   { tool: "create_task",        │
│     input: { title: "..." } },  │
│   { tool: "create_task", ... }, │
│   { tool: "create_task", ... }  │
│ ]                               │
└─────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│ Execute Tools                   │
│ - Parse tool_use blocks         │
│ - Call existing IPC (createTask)│
│ - Emit task:created events      │
│ - Build confirmation message    │
└─────────────────────────────────┘
           │
           ▼
Board updates + "Created 3 tasks: ..."
```

### API Mode: Native tool_use

```rust
// Request includes tools array
let request = json!({
    "model": model,
    "max_tokens": 4096,
    "system": system_prompt,
    "messages": messages,
    "tools": tools,  // Native Anthropic tool_use
});

// Response contains tool_use blocks
// {
//   "content": [
//     { "type": "text", "text": "I'll create those tasks..." },
//     { "type": "tool_use", "name": "create_task", "input": {...} }
//   ]
// }
```

### CLI Mode: JSON Output Parsing

```bash
# Claude CLI with system prompt and tools context
claude chat --print --system "..." --message "..."
```

For CLI mode, include tool instructions in system prompt:
```
When you need to take actions, output JSON in this format:
{"action": "create_task", "title": "...", "column": "..."}

Output one action per line. After actions, explain what you did.
```

Parse stdout for JSON lines, execute actions.

---

## Implementation Steps

### Step 1: System Prompt + Context Builder

```rust
// src-tauri/src/llm/context.rs

pub fn build_system_prompt(workspace: &Workspace) -> String {
    format!(r#"
You are the orchestrator for "{}" in bento-ya, a Kanban task board.
...
"#, workspace.name)
}

pub fn build_board_context(
    columns: &[Column],
    tasks: &[Task],
) -> serde_json::Value {
    json!({
        "columns": columns.iter().map(|c| json!({
            "id": c.id,
            "name": c.name,
            "position": c.position
        })).collect::<Vec<_>>(),
        "tasks": tasks.iter().map(|t| json!({
            "id": t.id,
            "title": t.title,
            "column_id": t.column_id,
            "description": t.description
        })).collect::<Vec<_>>()
    })
}
```

### Step 2: Tool Definitions

```rust
// src-tauri/src/llm/tools.rs

pub fn orchestrator_tools() -> Vec<serde_json::Value> {
    vec![
        json!({
            "name": "create_task",
            "description": "Create a new task on the board",
            "input_schema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "description": { "type": "string" },
                    "column": { "type": "string" }
                },
                "required": ["title"]
            }
        }),
        // ... other tools
    ]
}
```

### Step 3: Tool Executor

```rust
// src-tauri/src/llm/executor.rs

pub async fn execute_tool(
    conn: &Connection,
    workspace_id: &str,
    tool_name: &str,
    input: &serde_json::Value,
) -> Result<String, AppError> {
    match tool_name {
        "create_task" => {
            let title = input["title"].as_str().unwrap();
            let column = input["column"].as_str();
            let description = input["description"].as_str();

            // Find column by name or use first column
            let column_id = find_column_id(conn, workspace_id, column)?;

            let task = db::insert_task(conn, workspace_id, &column_id, title, description)?;
            Ok(format!("Created task: {}", task.title))
        }
        "move_task" => { /* ... */ }
        "update_task" => { /* ... */ }
        "delete_task" => { /* ... */ }
        _ => Err(AppError::InvalidInput(format!("Unknown tool: {}", tool_name)))
    }
}
```

### Step 4: Update Stream Command

```rust
// Modify stream_orchestrator_chat to:
// 1. Build context before calling LLM
// 2. Include tools in request
// 3. Parse tool_use from response
// 4. Execute tools
// 5. Emit results
```

### Step 5: Conversation History

```rust
// Load recent messages for context
let history = db::list_chat_messages(conn, workspace_id, Some(20))?;

// Convert to API format
let messages: Vec<_> = history.iter().map(|m| json!({
    "role": m.role,
    "content": m.content
})).collect();
```

---

## Files to Modify/Create

| File | Action | Lines |
|------|--------|-------|
| `src-tauri/src/llm/context.rs` | CREATE - system prompt + board context | ~80 |
| `src-tauri/src/llm/tools.rs` | CREATE - tool definitions | ~60 |
| `src-tauri/src/llm/executor.rs` | CREATE - tool execution | ~120 |
| `src-tauri/src/llm/mod.rs` | Add exports | ~5 |
| `src-tauri/src/commands/orchestrator.rs` | Integrate context/tools | ~80 |
| `src/components/panel/chat-history.tsx` | Show tool results nicely | ~30 |

**Total: ~375 lines**

---

## Example Interactions

### Create Tasks
```
User: Create 3 tasks for implementing user auth
Orchestrator: I'll create 3 tasks for the auth system.
[tool_use: create_task {title: "Set up OAuth providers", column: "Backlog"}]
[tool_use: create_task {title: "Implement login/logout routes", column: "Backlog"}]
[tool_use: create_task {title: "Add session management", column: "Backlog"}]

Created 3 tasks in Backlog:
1. Set up OAuth providers
2. Implement login/logout routes
3. Add session management
```

### Move Task
```
User: Move the OAuth task to In Progress

Orchestrator: Moving "Set up OAuth providers" to In Progress.
[tool_use: move_task {task_id: "task-123", column: "In Progress"}]

Done! "Set up OAuth providers" is now in In Progress.
```

### Query Board
```
User: What's in progress right now?

Orchestrator: Looking at your board, you have 2 tasks in progress:
1. **Fix login bug** - No description
2. **Set up OAuth providers** - Just moved here

Would you like me to add descriptions or make any changes?
```

---

## Testing

```bash
pnpm tauri dev

# Test 1: Create task
Type: "Create a task called 'Test task' in Backlog"
Verify: Task appears on board

# Test 2: Move task
Type: "Move 'Test task' to In Progress"
Verify: Task moves on board

# Test 3: Multiple tasks
Type: "Create 3 tasks for setting up a CI/CD pipeline"
Verify: 3 tasks created

# Test 4: Query
Type: "What tasks are in the Backlog?"
Verify: Accurate list returned
```

---

## Edge Cases

- **Ambiguous column name**: "Move to done" when column is "Done" or "Completed"
  - Solution: Fuzzy match, ask for clarification if multiple matches
- **Task not found**: "Update the login task" when multiple match
  - Solution: Ask for clarification, list matching tasks
- **No tasks**: "What's in progress?" when board is empty
  - Solution: Respond helpfully, suggest creating tasks

---

## Dependencies

- **T033**: LLM streaming infrastructure (must be complete)

## Enables

- Full orchestrator functionality
- Natural language task management
- T017: Orchestrator becomes truly functional
- Future: Agent assignment, time estimates, prioritization

## Complexity

**M** — Clear scope, builds on T033 foundation
