//! Tool definitions for the orchestrator agent
//!
//! Defines the tools available to the LLM for task management operations.

use serde::{Deserialize, Serialize};
use serde_json::json;

/// Tool definition in Anthropic API format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// A tool use request from the LLM
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolUse {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
}

/// Result of executing a tool
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub tool_use_id: String,
    pub content: String,
    pub is_error: bool,
}

/// Get all orchestrator tool definitions
pub fn orchestrator_tools() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "create_task".to_string(),
            description: "Create a new task on the board. Tasks are placed in the specified column (or the first column if not specified).".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "The title of the task (required)"
                    },
                    "description": {
                        "type": "string",
                        "description": "Optional description with more details about the task"
                    },
                    "column": {
                        "type": "string",
                        "description": "The column name to place the task in. If not provided, uses the first column (usually Backlog)"
                    }
                },
                "required": ["title"]
            }),
        },
        ToolDefinition {
            name: "update_task".to_string(),
            description: "Update an existing task's title or description.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "The ID of the task to update"
                    },
                    "title": {
                        "type": "string",
                        "description": "New title for the task (optional)"
                    },
                    "description": {
                        "type": "string",
                        "description": "New description for the task (optional)"
                    }
                },
                "required": ["task_id"]
            }),
        },
        ToolDefinition {
            name: "move_task".to_string(),
            description: "Move a task to a different column.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "The ID of the task to move"
                    },
                    "column": {
                        "type": "string",
                        "description": "The target column name to move the task to"
                    }
                },
                "required": ["task_id", "column"]
            }),
        },
        ToolDefinition {
            name: "delete_task".to_string(),
            description: "Delete a task from the board. This action cannot be undone.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "The ID of the task to delete"
                    }
                },
                "required": ["task_id"]
            }),
        },
        ToolDefinition {
            name: "queue_tasks".to_string(),
            description: "Queue multiple tasks for batch agent processing. The tasks will be processed concurrently by agents (up to 5 at a time).".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "task_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Array of task IDs to queue for processing"
                    },
                    "agent_type": {
                        "type": "string",
                        "description": "The type of agent to use (e.g., 'claude', 'codex'). Defaults to 'claude'"
                    }
                },
                "required": ["task_ids"]
            }),
        },
        ToolDefinition {
            name: "configure_triggers".to_string(),
            description: r#"Configure automation triggers for a column. Set what happens when tasks enter/exit a column.

Action types for on_entry/on_exit:
- {"type": "spawn_cli", "cli": "claude"|"codex"|"aider", "command": "/start-task", "prompt_template": "{task.title}\n\n{task.description}", "use_queue": true}
- {"type": "move_column", "target": "next"|"previous"}
- {"type": "none"}

Exit criteria types: "manual", "agent_complete", "script_success", "checklist_done", "time_elapsed", "pr_approved"

Template variables: {task.title}, {task.description}, {task.trigger_prompt}, {column.name}, {workspace.path}

Default: spawn_cli with claude and /start-task. Set auto_advance: true for automatic progression."#.to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "column": {
                        "type": "string",
                        "description": "The column name to configure triggers for"
                    },
                    "on_entry": {
                        "type": "object",
                        "description": "Action to fire when a task enters this column (or null for no action)"
                    },
                    "on_exit": {
                        "type": "object",
                        "description": "Action to fire when exit criteria are met (or null for no action)"
                    },
                    "exit_criteria": {
                        "type": "object",
                        "description": "When the on_exit trigger should fire. Object with 'type' (string), 'auto_advance' (bool), optional 'timeout' (seconds)"
                    }
                },
                "required": ["column"]
            }),
        },
    ]
}

/// Convert tool definitions to the format expected by Anthropic API
pub fn tools_to_api_format(tools: &[ToolDefinition]) -> Vec<serde_json::Value> {
    tools
        .iter()
        .map(|t| {
            json!({
                "name": t.name,
                "description": t.description,
                "input_schema": t.input_schema
            })
        })
        .collect()
}

/// Parse tool_use blocks from Anthropic API response content
pub fn parse_tool_uses(content: &[serde_json::Value]) -> Vec<ToolUse> {
    content
        .iter()
        .filter_map(|block| {
            if block.get("type")?.as_str()? == "tool_use" {
                Some(ToolUse {
                    id: block.get("id")?.as_str()?.to_string(),
                    name: block.get("name")?.as_str()?.to_string(),
                    input: block.get("input")?.clone(),
                })
            } else {
                None
            }
        })
        .collect()
}

/// Extract text content from Anthropic API response
pub fn extract_text_content(content: &[serde_json::Value]) -> String {
    content
        .iter()
        .filter_map(|block| {
            if block.get("type")?.as_str()? == "text" {
                Some(block.get("text")?.as_str()?.to_string())
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("")
}

/// Parse structured tool uses from response text.
///
/// Supports Anthropic-style `tool_use` content blocks, arrays of tool uses,
/// wrapper objects with `tool_use`, `tool_uses`, `actions`, or `content`
/// fields, and direct action objects.
pub fn parse_structured_tool_uses(response: &str) -> Vec<ToolUse> {
    parse_json_candidates(response)
        .into_iter()
        .flat_map(|value| tool_uses_from_value(&value))
        .enumerate()
        .map(|(index, mut tool_use)| {
            if tool_use.id.is_empty() {
                tool_use.id = format!("structured_tool_use_{}", index);
            }
            tool_use
        })
        .collect()
}

/// Parse action blocks from CLI response text.
/// Looks for ```action ... ``` blocks containing JSON arrays of actions, and
/// also accepts structured JSON tool_use/action payloads.
pub fn parse_cli_action_blocks(response: &str) -> Vec<ToolUse> {
    let mut tool_uses = Vec::new();
    let mut counter = 0;

    // Find all ```action blocks
    let mut remaining = response;
    while let Some(start_idx) = remaining.find("```action") {
        let after_marker = &remaining[start_idx + 9..]; // Skip "```action"

        // Find the closing ```
        if let Some(end_idx) = after_marker.find("```") {
            let json_content = after_marker[..end_idx].trim();

            if let Ok(value) = serde_json::from_str::<serde_json::Value>(json_content) {
                for mut tool_use in tool_uses_from_value(&value) {
                    if tool_use.id.is_empty() {
                        tool_use.id = format!("cli_action_{}", counter);
                    }
                    tool_uses.push(tool_use);
                    counter += 1;
                }
            }

            remaining = &after_marker[end_idx + 3..];
        } else {
            break;
        }
    }

    tool_uses.extend(parse_structured_tool_uses(response));

    tool_uses
}

fn parse_json_candidates(response: &str) -> Vec<serde_json::Value> {
    let mut candidates = Vec::new();
    let trimmed = response.trim();

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        candidates.push(value);
    }

    candidates.extend(parse_fenced_json_blocks(response));
    candidates
}

fn parse_fenced_json_blocks(response: &str) -> Vec<serde_json::Value> {
    let mut values = Vec::new();
    let mut remaining = response;

    while let Some(start_idx) = remaining.find("```") {
        let after_fence = &remaining[start_idx + 3..];
        let Some(end_idx) = after_fence.find("```") else {
            break;
        };

        let block = &after_fence[..end_idx];
        let trimmed = block.trim_start();
        let (language, content) = trimmed
            .split_once('\n')
            .map(|(language, content)| (language.trim(), content.trim()))
            .unwrap_or(("", trimmed.trim()));

        if language.eq_ignore_ascii_case("action") {
            remaining = &after_fence[end_idx + 3..];
            continue;
        }

        let content = if language.eq_ignore_ascii_case("json") {
            content
        } else {
            trimmed.trim()
        };

        if let Ok(value) = serde_json::from_str::<serde_json::Value>(content) {
            values.push(value);
        }

        remaining = &after_fence[end_idx + 3..];
    }

    values
}

fn tool_uses_from_value(value: &serde_json::Value) -> Vec<ToolUse> {
    match value {
        serde_json::Value::Array(items) => items
            .iter()
            .flat_map(tool_uses_from_value)
            .collect::<Vec<_>>(),
        serde_json::Value::Object(map) => {
            if let Some(tool_use) = tool_use_from_object(map) {
                return vec![tool_use];
            }

            for key in [
                "tool_use",
                "toolUse",
                "tool_uses",
                "toolUses",
                "actions",
                "content",
            ] {
                if let Some(nested) = map.get(key) {
                    let parsed = tool_uses_from_value(nested);
                    if !parsed.is_empty() {
                        return parsed;
                    }
                }
            }

            Vec::new()
        }
        _ => Vec::new(),
    }
}

fn tool_use_from_object(map: &serde_json::Map<String, serde_json::Value>) -> Option<ToolUse> {
    if let Some(block_type) = map.get("type").and_then(|v| v.as_str()) {
        if block_type != "tool_use"
            && map.get("action").is_none()
            && map.get("action_type").is_none()
            && map.get("actionType").is_none()
        {
            return None;
        }
    }

    let name = map
        .get("name")
        .or_else(|| map.get("tool_name"))
        .or_else(|| map.get("toolName"))
        .or_else(|| map.get("action"))
        .or_else(|| map.get("action_type"))
        .or_else(|| map.get("actionType"))
        .and_then(|v| v.as_str())
        .and_then(normalize_tool_name)?;

    let is_action_object = map.get("action").is_some()
        || map.get("action_type").is_some()
        || map.get("actionType").is_some();
    let id = if is_action_object {
        String::new()
    } else {
        map.get("id")
            .or_else(|| map.get("tool_use_id"))
            .or_else(|| map.get("toolUseId"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };

    let input = map.get("input").cloned().unwrap_or_else(|| {
        let mut input = serde_json::Map::new();
        for (key, value) in map {
            if !matches!(
                key.as_str(),
                "type"
                    | "name"
                    | "tool_name"
                    | "toolName"
                    | "tool_use_id"
                    | "toolUseId"
                    | "action"
                    | "action_type"
                    | "actionType"
            ) {
                if key == "id" && !is_action_object {
                    continue;
                }
                input.insert(key.clone(), value.clone());
            }
        }
        serde_json::Value::Object(input)
    });

    Some(ToolUse {
        id,
        name: name.to_string(),
        input,
    })
}

pub fn normalize_tool_name(name: &str) -> Option<&'static str> {
    let normalized = name.trim().to_ascii_lowercase().replace([' ', '-'], "_");
    match normalized.as_str() {
        "create_task" | "create" => Some("create_task"),
        "update_task" | "edit_task" | "edit" | "update" => Some("update_task"),
        "move_task" | "move" => Some("move_task"),
        "delete_task" | "remove_task" | "delete" | "remove" => Some("delete_task"),
        "queue_tasks" | "queue" => Some("queue_tasks"),
        "configure_triggers" => Some("configure_triggers"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_orchestrator_tools_count() {
        let tools = orchestrator_tools();
        assert_eq!(tools.len(), 6);
    }

    #[test]
    fn test_tool_names() {
        let tools = orchestrator_tools();
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"create_task"));
        assert!(names.contains(&"update_task"));
        assert!(names.contains(&"move_task"));
        assert!(names.contains(&"delete_task"));
        assert!(names.contains(&"queue_tasks"));
        assert!(names.contains(&"configure_triggers"));
    }

    #[test]
    fn test_parse_tool_uses() {
        let content = vec![
            json!({"type": "text", "text": "Creating a task..."}),
            json!({
                "type": "tool_use",
                "id": "toolu_123",
                "name": "create_task",
                "input": {"title": "Test task", "column": "Backlog"}
            }),
        ];

        let tool_uses = parse_tool_uses(&content);
        assert_eq!(tool_uses.len(), 1);
        assert_eq!(tool_uses[0].name, "create_task");
        assert_eq!(tool_uses[0].input["title"], "Test task");
    }

    #[test]
    fn test_extract_text_content() {
        let content = vec![
            json!({"type": "text", "text": "Hello "}),
            json!({"type": "tool_use", "id": "123", "name": "test", "input": {}}),
            json!({"type": "text", "text": "world!"}),
        ];

        let text = extract_text_content(&content);
        assert_eq!(text, "Hello world!");
    }

    #[test]
    fn test_parse_cli_action_blocks() {
        let response = r#"I'll create that task for you.

```action
[
  {"action": "create_task", "title": "Buy groceries", "column": "Backlog"}
]
```

Done! I've added "Buy groceries" to your Backlog."#;

        let tool_uses = parse_cli_action_blocks(response);
        assert_eq!(tool_uses.len(), 1);
        assert_eq!(tool_uses[0].name, "create_task");
        assert_eq!(tool_uses[0].input["title"], "Buy groceries");
        assert_eq!(tool_uses[0].input["column"], "Backlog");
    }

    #[test]
    fn test_parse_cli_action_blocks_multiple() {
        let response = r#"I'll move those tasks.

```action
[
  {"action": "move_task", "task_id": "task-1", "column": "Done"},
  {"action": "delete_task", "task_id": "task-2"}
]
```

Moved task-1 to Done and deleted task-2."#;

        let tool_uses = parse_cli_action_blocks(response);
        assert_eq!(tool_uses.len(), 2);
        assert_eq!(tool_uses[0].name, "move_task");
        assert_eq!(tool_uses[1].name, "delete_task");
    }

    #[test]
    fn test_parse_cli_action_blocks_no_actions() {
        let response = "Just a regular response with no action blocks.";
        let tool_uses = parse_cli_action_blocks(response);
        assert!(tool_uses.is_empty());
    }

    #[test]
    fn test_parse_cli_action_blocks_configure_triggers() {
        let response = r#"I'll set up the triggers for that column.

```action
[
  {"action": "configure_triggers", "column": "In Progress", "on_entry": {"type": "spawn_cli", "cli": "claude", "command": "/start-task", "use_queue": true}, "exit_criteria": {"type": "agent_complete", "auto_advance": true}}
]
```

Done! Triggers configured for "In Progress"."#;

        let tool_uses = parse_cli_action_blocks(response);
        assert_eq!(tool_uses.len(), 1);
        assert_eq!(tool_uses[0].name, "configure_triggers");
        assert_eq!(tool_uses[0].input["column"], "In Progress");
        assert_eq!(tool_uses[0].input["on_entry"]["type"], "spawn_cli");
        assert_eq!(tool_uses[0].input["exit_criteria"]["auto_advance"], true);
    }

    #[test]
    fn test_parse_structured_tool_uses_content_blocks() {
        let response = r#"{
            "content": [
                {"type": "text", "text": "Updating the task."},
                {"type": "tool_use", "id": "toolu_1", "name": "edit_task", "input": {"task_id": "task-1", "title": "New title"}}
            ]
        }"#;

        let tool_uses = parse_structured_tool_uses(response);
        assert_eq!(tool_uses.len(), 1);
        assert_eq!(tool_uses[0].id, "toolu_1");
        assert_eq!(tool_uses[0].name, "update_task");
        assert_eq!(tool_uses[0].input["task_id"], "task-1");
    }

    #[test]
    fn test_parse_structured_tool_uses_actions_array() {
        let response = r#"{
            "actions": [
                {"action": "move", "task_id": "task-1", "column": "Done"},
                {"action": "remove_task", "id": "task-2"}
            ]
        }"#;

        let tool_uses = parse_structured_tool_uses(response);
        assert_eq!(tool_uses.len(), 2);
        assert_eq!(tool_uses[0].name, "move_task");
        assert_eq!(tool_uses[0].input["column"], "Done");
        assert_eq!(tool_uses[1].name, "delete_task");
        assert_eq!(tool_uses[1].input["id"], "task-2");
    }

    #[test]
    fn test_parse_structured_tool_uses_ignores_named_text_blocks() {
        let response = r#"{
            "content": [
                {"type": "text", "name": "create_task", "text": "This is only an example."},
                {"type": "tool_use", "id": "toolu_1", "name": "Create Task", "input": {"title": "Real task"}}
            ]
        }"#;

        let tool_uses = parse_structured_tool_uses(response);
        assert_eq!(tool_uses.len(), 1);
        assert_eq!(tool_uses[0].name, "create_task");
        assert_eq!(tool_uses[0].input["title"], "Real task");
    }

    #[test]
    fn test_parse_cli_action_blocks_does_not_duplicate_action_fence() {
        let response = r#"```action
[
  {"action": "create_task", "title": "One"}
]
```"#;

        let tool_uses = parse_cli_action_blocks(response);
        assert_eq!(tool_uses.len(), 1);
        assert_eq!(tool_uses[0].name, "create_task");
    }
}
