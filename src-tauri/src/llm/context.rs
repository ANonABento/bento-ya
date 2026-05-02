//! Context building for orchestrator LLM requests
//!
//! Builds system prompts and board context for the orchestrator agent.

use crate::db::{Column, Task, Workspace};
use serde_json::json;
use std::collections::HashMap;

fn ordered_columns(columns: &[Column]) -> Vec<&Column> {
    let mut ordered_columns = columns.iter().collect::<Vec<_>>();
    ordered_columns.sort_by(|left, right| {
        left.position
            .cmp(&right.position)
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.id.cmp(&right.id))
    });
    ordered_columns
}

const BOARD_SCHEMA_PROMPT: &str = r#"## Board Schema
The board is a Kanban workspace with ordered columns and tasks.

Column fields you will see:
- `id`: stable column identifier.
- `name`: user-facing column name. Column matching is case-insensitive, but prefer exact names from the current board.
- `position`: left-to-right board order.
- `triggers`: optional automation config with `on_entry`, `on_exit`, and `exit_criteria`.

Task fields you will see:
- `id`: stable task identifier. Use this for existing task operations.
- `title`: short task name.
- `description`: optional implementation details.
- `column_id` and `column`: current board location.
- `position`: order within the column.
- `priority`, `pipeline_state`, `agent_status`, `blocked`, `dependencies`, `trigger_prompt`, and PR fields: operational metadata. Do not invent values for fields you cannot update.

Available task operations:
- Create tasks with a concise title, optional description, and optional target column.
- Update an existing task's title and/or description.
- Move an existing task to another column.
- Delete an existing task only when the user clearly asks to remove it.
- Queue existing tasks for agent work.
- Configure column automation triggers with the `configure_triggers` operation.
"#;

const OPERATION_GUIDANCE_PROMPT: &str = r#"## Natural Language Parsing Rules
- Translate the user's request into the smallest set of board operations that satisfies it.
- For existing tasks, resolve references by task `id` first, then by exact or unambiguous title. Ask a clarifying question if multiple tasks match.
- Use the board's current column names. Do not create or refer to columns that are not listed.
- Preserve task information the user did not ask to change.
- If the user describes several tasks, create one task per distinct deliverable.
- Put acceptance criteria, implementation notes, links, or long instructions in `description`, not `title`.
- For "start", "work on", "do next", or similar requests, move the referenced task to the most appropriate in-progress column if one exists; otherwise ask.
- For "done", "complete", "finished", or similar requests, move the referenced task to the most appropriate done/completed column if one exists; otherwise ask.
- When creating and then immediately acting on the new task in CLI mode, reference it as `__LAST__`.
- Do not pretend an operation happened unless you used a tool or emitted an action for it.
"#;

const API_OPERATION_PROMPT: &str = r#"Use Anthropic tool calls for board changes. Do not emit JSON action blocks in API mode.
For each successful operation, briefly summarize what changed. If a tool returns an error, explain the error and ask for the missing correction."#;

const CLI_OPERATION_PROMPT: &str = r#"## Actions
To modify the board, output exactly one action block containing a JSON array:
```action
[
  {"action": "create_task", "title": "...", "column": "...", "description": "..."},
  {"action": "update_task", "task_id": "...", "title": "...", "description": "..."},
  {"action": "move_task", "task_id": "...", "column": "..."},
  {"action": "delete_task", "task_id": "..."},
  {"action": "queue_tasks", "task_ids": ["..."], "agent_type": "claude"},
  {"action": "configure_triggers", "column": "...", "on_entry": {}, "on_exit": {}, "exit_criteria": {}}
]
```

### configure_triggers action
Sets automation for a column. Action types for on_entry/on_exit:
- `{"type": "spawn_cli", "cli": "claude", "command": "/start-task", "prompt_template": "{task.title}\n\n{task.description}", "use_queue": true}`
- `{"type": "move_column", "target": "next"}`
- `{"type": "none"}`
Exit criteria: `{"type": "agent_complete", "auto_advance": true}`

Use task IDs from the board state. Column names are case-insensitive.
Use `"__LAST__"` as task_id to reference the last created task (e.g. create_task then move_task in the same block).
Put all actions in a single action block. Do not output multiple action blocks.
Briefly confirm actions taken."#;

/// Build the system prompt for the orchestrator (API mode with native tools)
pub fn build_system_prompt(workspace: &Workspace, columns: &[Column], tasks: &[Task]) -> String {
    let ordered_columns = ordered_columns(columns);
    let column_names: Vec<&str> = ordered_columns.iter().map(|c| c.name.as_str()).collect();
    let columns_str = column_names.join(", ");
    let tasks_str = format_task_snapshot(&ordered_columns, tasks);

    format!(
        r#"You are the orchestrator for "{workspace_name}", a Kanban board.

Columns: {columns}

Current tasks:
{tasks}

{board_schema}

{operation_guidance}

## Style
- Be concise. Short answers.
- No emojis.
- Use markdown for formatting (bold, lists, code).
- Ask clarifying questions if the request is ambiguous.

{api_operation_prompt}"#,
        workspace_name = workspace.name,
        columns = columns_str,
        tasks = tasks_str,
        board_schema = BOARD_SCHEMA_PROMPT,
        operation_guidance = OPERATION_GUIDANCE_PROMPT,
        api_operation_prompt = API_OPERATION_PROMPT
    )
}

/// Build the system prompt for CLI mode (with embedded action blocks)
pub fn build_cli_system_prompt(
    workspace: &Workspace,
    columns: &[Column],
    tasks: &[Task],
) -> String {
    let ordered_columns = ordered_columns(columns);
    let column_names: Vec<&str> = ordered_columns.iter().map(|c| c.name.as_str()).collect();
    let columns_str = column_names.join(", ");
    let tasks_str = format_task_snapshot(&ordered_columns, tasks);

    format!(
        r#"You are the orchestrator for "{workspace_name}", a Kanban board.

Columns: {columns}

Current tasks:
{tasks}

{board_schema}

{operation_guidance}

## Style
- Be concise. Short answers.
- No emojis.
- Use markdown for formatting (bold, lists, code).
- Ask clarifying questions if the request is ambiguous.

{cli_operation_prompt}"#,
        workspace_name = workspace.name,
        columns = columns_str,
        tasks = tasks_str,
        board_schema = BOARD_SCHEMA_PROMPT,
        operation_guidance = OPERATION_GUIDANCE_PROMPT,
        cli_operation_prompt = CLI_OPERATION_PROMPT
    )
}

/// Build board context JSON to inject into the conversation
pub fn build_board_context(
    workspace: &Workspace,
    columns: &[Column],
    tasks: &[Task],
) -> serde_json::Value {
    // Map tasks to their column names for readability
    let column_map: std::collections::HashMap<&str, &str> = columns
        .iter()
        .map(|c| (c.id.as_str(), c.name.as_str()))
        .collect();

    json!({
        "workspace": workspace.name,
        "columns": columns.iter().map(|c| {
            let mut col = json!({
                "id": c.id,
                "name": c.name,
                "position": c.position
            });
            if let Some(triggers) = &c.triggers {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(triggers) {
                    col["triggers"] = parsed;
                }
            }
            col
        }).collect::<Vec<_>>(),
        "tasks": tasks.iter().map(|t| {
            let column_name = column_map.get(t.column_id.as_str()).unwrap_or(&"Unknown");
            json!({
                "id": t.id,
                "title": t.title,
                "column_id": t.column_id,
                "column": column_name,
                "description": t.description,
                "position": t.position,
                "priority": t.priority,
                "pipeline_state": t.pipeline_state,
                "agent_status": t.agent_status,
                "blocked": t.blocked,
                "dependencies": t.dependencies,
                "trigger_prompt": t.trigger_prompt,
                "pr_number": t.pr_number,
                "pr_url": t.pr_url,
                "pr_ci_status": t.pr_ci_status,
                "pr_review_decision": t.pr_review_decision
            })
        }).collect::<Vec<_>>(),
        "task_count": tasks.len()
    })
}

/// Format board context as a user-friendly string for inclusion in messages
pub fn format_board_context_message(context: &serde_json::Value) -> String {
    format!(
        "Current board state:\n```json\n{}\n```",
        serde_json::to_string_pretty(context).unwrap_or_else(|_| "{}".to_string())
    )
}

fn format_task_snapshot(columns: &[&Column], tasks: &[Task]) -> String {
    if tasks.is_empty() {
        return "- No tasks on the board.".to_string();
    }

    let mut tasks_by_column: HashMap<&str, Vec<&Task>> = HashMap::new();
    for task in tasks {
        tasks_by_column
            .entry(task.column_id.as_str())
            .or_default()
            .push(task);
    }

    let mut lines = Vec::new();
    for column in columns {
        lines.push(format!("- {}:", column.name));
        match tasks_by_column.get(column.id.as_str()) {
            Some(column_tasks) if !column_tasks.is_empty() => {
                let mut ordered_tasks = column_tasks.clone();
                ordered_tasks.sort_by(|left, right| {
                    left.position
                        .cmp(&right.position)
                        .then_with(|| left.title.cmp(&right.title))
                        .then_with(|| left.id.cmp(&right.id))
                });

                for task in ordered_tasks {
                    let description = task
                        .description
                        .as_deref()
                        .map(str::trim)
                        .filter(|d| !d.is_empty());
                    let detail = description
                        .map(|d| truncate_for_prompt(d, 120))
                        .map(|d| format!(" - {}", d))
                        .unwrap_or_default();
                    lines.push(format!("  - [{}] {}{}", task.id, task.title, detail));
                }
            }
            _ => lines.push("  - (empty)".to_string()),
        }
    }

    lines.join("\n")
}

fn truncate_for_prompt(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }

    value.chars().take(max_chars).collect::<String>() + "..."
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_workspace() -> Workspace {
        Workspace {
            id: "ws-1".to_string(),
            name: "Test Project".to_string(),
            repo_path: "/test/path".to_string(),
            tab_order: 0,
            is_active: true,
            active_task_count: 0,
            config: "{}".to_string(),
            created_at: "2024-01-01".to_string(),
            updated_at: "2024-01-01".to_string(),
            discord_guild_id: None,
            discord_category_id: None,
            discord_chef_channel_id: None,
            discord_notifications_channel_id: None,
            discord_enabled: None,
        }
    }

    fn mock_columns() -> Vec<Column> {
        vec![
            Column {
                id: "col-1".to_string(),
                workspace_id: "ws-1".to_string(),
                name: "Backlog".to_string(),
                icon: "📋".to_string(),
                position: 0,
                color: None,
                visible: true,
                triggers: None,
                created_at: "2024-01-01".to_string(),
                updated_at: "2024-01-01".to_string(),
            },
            Column {
                id: "col-2".to_string(),
                workspace_id: "ws-1".to_string(),
                name: "In Progress".to_string(),
                icon: "🔧".to_string(),
                position: 1,
                color: None,
                visible: true,
                triggers: None,
                created_at: "2024-01-01".to_string(),
                updated_at: "2024-01-01".to_string(),
            },
            Column {
                id: "col-3".to_string(),
                workspace_id: "ws-1".to_string(),
                name: "Done".to_string(),
                icon: "✅".to_string(),
                position: 2,
                color: None,
                visible: true,
                triggers: None,
                created_at: "2024-01-01".to_string(),
                updated_at: "2024-01-01".to_string(),
            },
        ]
    }

    fn mock_tasks() -> Vec<Task> {
        vec![Task {
            id: "task-1".to_string(),
            workspace_id: "ws-1".to_string(),
            column_id: "col-1".to_string(),
            title: "Fix login bug".to_string(),
            description: Some("Users can't log in".to_string()),
            position: 0,
            priority: "medium".to_string(),
            agent_mode: None,
            branch_name: None,
            batch_id: None,
            files_touched: "[]".to_string(),
            checklist: None,
            estimated_hours: None,
            actual_hours: 0.0,
            pipeline_state: "idle".to_string(),
            pipeline_triggered_at: None,
            pipeline_error: None,
            retry_count: 0,
            model: None,
            agent_session_id: None,
            last_script_exit_code: None,
            review_status: None,
            pr_number: None,
            pr_url: None,
            siege_iteration: 0,
            siege_active: false,
            siege_max_iterations: 5,
            siege_last_checked: None,
            pr_mergeable: None,
            pr_ci_status: None,
            pr_review_decision: None,
            pr_comment_count: 0,
            pr_is_draft: false,
            pr_labels: "[]".to_string(),
            labels: Vec::new(),
            pr_last_fetched: None,
            pr_head_sha: None,
            notify_stakeholders: None,
            notification_sent_at: None,
            trigger_overrides: None,
            trigger_prompt: None,
            last_output: None,
            dependencies: None,
            blocked: false,
            worktree_path: None,
            github_issue_number: None,
            github_issue_commented: false,
            github_issue_pr_linked: false,
            archived_at: None,
            agent_status: None,
            queued_at: None,
            created_at: "2024-01-01".to_string(),
            updated_at: "2024-01-01".to_string(),
        }]
    }

    #[test]
    fn test_build_system_prompt() {
        let workspace = mock_workspace();
        let columns = mock_columns();
        let tasks = mock_tasks();
        let prompt = build_system_prompt(&workspace, &columns, &tasks);

        assert!(prompt.contains("Test Project"));
        assert!(prompt.contains("Backlog, In Progress, Done"));
        assert!(prompt.contains("orchestrator"));
        assert!(prompt.contains("[task-1] Fix login bug"));
    }

    #[test]
    fn test_build_board_context() {
        let workspace = mock_workspace();
        let columns = mock_columns();
        let tasks = mock_tasks();
        let context = build_board_context(&workspace, &columns, &tasks);

        assert_eq!(context["workspace"], "Test Project");
        assert_eq!(context["columns"].as_array().unwrap().len(), 3);
        assert_eq!(context["tasks"].as_array().unwrap().len(), 1);
        assert_eq!(context["tasks"][0]["title"], "Fix login bug");
        assert_eq!(context["tasks"][0]["column"], "Backlog");
        assert_eq!(context["tasks"][0]["priority"], "medium");
        assert_eq!(context["tasks"][0]["pipeline_state"], "idle");
        assert_eq!(context["tasks"][0]["blocked"], false);
    }

    #[test]
    fn test_build_board_context_includes_triggers() {
        let workspace = mock_workspace();
        let mut columns = mock_columns();
        // Set triggers on the second column
        columns[1].triggers = Some(r#"{"on_entry":{"type":"spawn_cli","cli":"claude"},"exit_criteria":{"type":"agent_complete","auto_advance":true}}"#.to_string());
        let tasks = mock_tasks();
        let context = build_board_context(&workspace, &columns, &tasks);

        let col_with_triggers = &context["columns"][1];
        assert_eq!(col_with_triggers["name"], "In Progress");
        assert_eq!(
            col_with_triggers["triggers"]["on_entry"]["type"],
            "spawn_cli"
        );
        assert_eq!(
            col_with_triggers["triggers"]["exit_criteria"]["auto_advance"],
            true
        );

        // Column without triggers should not have triggers field
        assert!(context["columns"][0]["triggers"].is_null());
    }

    #[test]
    fn test_system_prompt_mentions_configure_triggers() {
        let workspace = mock_workspace();
        let columns = mock_columns();
        let tasks = mock_tasks();

        let api_prompt = build_system_prompt(&workspace, &columns, &tasks);
        assert!(api_prompt.contains("configure_triggers"));

        let cli_prompt = build_cli_system_prompt(&workspace, &columns, &tasks);
        assert!(cli_prompt.contains("configure_triggers"));
    }

    #[test]
    fn test_system_prompts_include_schema_and_parsing_contract() {
        let workspace = mock_workspace();
        let columns = mock_columns();
        let tasks = mock_tasks();

        let api_prompt = build_system_prompt(&workspace, &columns, &tasks);
        assert!(api_prompt.contains("## Board Schema"));
        assert!(api_prompt.contains("Task fields you will see"));
        assert!(api_prompt.contains("Use Anthropic tool calls"));
        assert!(api_prompt.contains("Do not emit JSON action blocks in API mode"));
        assert!(api_prompt.contains("resolve references by task `id` first"));

        let cli_prompt = build_cli_system_prompt(&workspace, &columns, &tasks);
        assert!(cli_prompt.contains("## Natural Language Parsing Rules"));
        assert!(cli_prompt.contains(r#""action": "queue_tasks""#));
        assert!(cli_prompt.contains("Put all actions in a single action block"));
        assert!(cli_prompt.contains("__LAST__"));
    }

    #[test]
    fn test_task_snapshot_is_ordered_by_column_and_position() {
        let workspace = mock_workspace();
        let mut columns = mock_columns();
        columns.swap(0, 1);

        let mut tasks = vec![
            Task {
                id: "task-2".to_string(),
                title: "Second task".to_string(),
                position: 2,
                ..mock_tasks()[0].clone()
            },
            Task {
                id: "task-0".to_string(),
                title: "First task".to_string(),
                position: 0,
                ..mock_tasks()[0].clone()
            },
        ];
        tasks[1].description = Some("Needs sorting".to_string());

        let prompt = build_system_prompt(&workspace, &columns, &tasks);
        let backlog_index = prompt.find("- Backlog:").unwrap();
        let in_progress_index = prompt.find("- In Progress:").unwrap();
        let first_task_index = prompt.find("[task-0] First task - Needs sorting").unwrap();
        let second_task_index = prompt.find("[task-2] Second task").unwrap();

        assert!(backlog_index < in_progress_index);
        assert!(first_task_index < second_task_index);
    }
}
