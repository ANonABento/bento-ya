//! Context building for orchestrator LLM requests
//!
//! Builds system prompts and board context for the orchestrator agent.

use crate::db::{Column, Task, Workspace};
use serde_json::json;

/// Build the system prompt for the orchestrator (API mode with native tools)
pub fn build_system_prompt(workspace: &Workspace, columns: &[Column]) -> String {
    let column_names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
    let columns_str = column_names.join(", ");

    format!(
        r#"You are the orchestrator for "{workspace_name}", a Kanban board.

Columns: {columns}

## Style
- Be concise. Short answers.
- No emojis.
- Use markdown for formatting (bold, lists, code).
- Ask clarifying questions if the request is ambiguous.

Use the provided tools to modify the board. Briefly confirm actions taken."#,
        workspace_name = workspace.name,
        columns = columns_str
    )
}

/// Build the system prompt for CLI mode (with embedded action blocks)
pub fn build_cli_system_prompt(workspace: &Workspace, columns: &[Column]) -> String {
    let column_names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
    let columns_str = column_names.join(", ");

    format!(
        r#"You are the orchestrator for "{workspace_name}", a Kanban board.

Columns: {columns}

## Style
- Be concise. Short answers.
- No emojis.
- Use markdown for formatting (bold, lists, code).
- Ask clarifying questions if the request is ambiguous.

## Actions
To modify the board, output an action block:
```action
[
  {{"action": "create_task", "title": "...", "column": "...", "description": "..."}},
  {{"action": "update_task", "task_id": "...", "title": "...", "description": "..."}},
  {{"action": "move_task", "task_id": "...", "column": "..."}},
  {{"action": "delete_task", "task_id": "..."}}
]
```

Use task IDs from the board state. Column names are case-insensitive. Briefly confirm actions taken."#,
        workspace_name = workspace.name,
        columns = columns_str
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
        "columns": columns.iter().map(|c| json!({
            "id": c.id,
            "name": c.name,
            "position": c.position
        })).collect::<Vec<_>>(),
        "tasks": tasks.iter().map(|t| {
            let column_name = column_map.get(t.column_id.as_str()).unwrap_or(&"Unknown");
            json!({
                "id": t.id,
                "title": t.title,
                "column_id": t.column_id,
                "column": column_name,
                "description": t.description,
                "position": t.position
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
            config: "{}".to_string(),
            created_at: "2024-01-01".to_string(),
            updated_at: "2024-01-01".to_string(),
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
                trigger_config: "{}".to_string(),
                exit_config: "{}".to_string(),
                auto_advance: false,
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
                trigger_config: "{}".to_string(),
                exit_config: "{}".to_string(),
                auto_advance: false,
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
                trigger_config: "{}".to_string(),
                exit_config: "{}".to_string(),
                auto_advance: false,
                created_at: "2024-01-01".to_string(),
                updated_at: "2024-01-01".to_string(),
            },
        ]
    }

    fn mock_tasks() -> Vec<Task> {
        vec![
            Task {
                id: "task-1".to_string(),
                workspace_id: "ws-1".to_string(),
                column_id: "col-1".to_string(),
                title: "Fix login bug".to_string(),
                description: Some("Users can't log in".to_string()),
                position: 0,
                priority: "medium".to_string(),
                agent_mode: None,
                branch_name: None,
                files_touched: "[]".to_string(),
                checklist: None,
                pipeline_state: "idle".to_string(),
                pipeline_triggered_at: None,
                pipeline_error: None,
                created_at: "2024-01-01".to_string(),
                updated_at: "2024-01-01".to_string(),
            },
        ]
    }

    #[test]
    fn test_build_system_prompt() {
        let workspace = mock_workspace();
        let columns = mock_columns();
        let prompt = build_system_prompt(&workspace, &columns);

        assert!(prompt.contains("Test Project"));
        assert!(prompt.contains("Backlog, In Progress, Done"));
        assert!(prompt.contains("orchestrator"));
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
    }
}
