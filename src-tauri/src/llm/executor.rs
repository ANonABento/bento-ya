//! Tool execution for orchestrator
//!
//! Executes tool calls from the LLM against the database.

use crate::db::{self, Column, Task};
use crate::error::AppError;
use crate::llm::tools::{ToolResult, ToolUse};
use crate::pipeline;
use rusqlite::Connection;
use serde_json::json;
use tauri::{AppHandle, Emitter};

/// Result of executing multiple tools
#[derive(Debug, Clone)]
pub struct ExecutionResult {
    pub results: Vec<ToolResult>,
    pub tasks_created: Vec<Task>,
    pub tasks_updated: Vec<Task>,
    pub tasks_deleted: Vec<String>,
    pub summary: String,
}

/// Execute a list of tool uses and return results
pub fn execute_tools(
    conn: &Connection,
    app: &AppHandle,
    workspace_id: &str,
    tool_uses: &[ToolUse],
    columns: &[Column],
) -> Result<ExecutionResult, AppError> {
    let mut results = Vec::new();
    let mut tasks_created = Vec::new();
    let mut tasks_updated = Vec::new();
    let mut tasks_deleted = Vec::new();

    for tool_use in tool_uses {
        let result = execute_single_tool(conn, workspace_id, &tool_use.name, &tool_use.input, columns);

        match result {
            Ok(outcome) => {
                // Track what was done
                match outcome {
                    ToolOutcome::TaskCreated(task) => {
                        // Fire column trigger for the new task (on_entry)
                        let task = if !task.blocked {
                            let column = columns.iter().find(|c| c.id == task.column_id);
                            if let Some(col) = column {
                                pipeline::fire_trigger(conn, app, &task, col).unwrap_or(task)
                            } else {
                                task
                            }
                        } else {
                            task
                        };

                        results.push(ToolResult {
                            tool_use_id: tool_use.id.clone(),
                            content: format!("Created task: \"{}\" in {}", task.title, get_column_name(&task.column_id, columns)),
                            is_error: false,
                        });
                        // Emit event for frontend
                        let _ = app.emit("task:created", json!({
                            "workspace_id": workspace_id,
                            "task": &task
                        }));
                        // Emit tasks:changed so frontend refreshes
                        pipeline::emit_tasks_changed(app, workspace_id, "orchestrator_tool");
                        tasks_created.push(task);
                    }
                    ToolOutcome::TaskUpdated(task) => {
                        results.push(ToolResult {
                            tool_use_id: tool_use.id.clone(),
                            content: format!("Updated task: \"{}\"", task.title),
                            is_error: false,
                        });
                        let _ = app.emit("task:updated", json!({
                            "workspace_id": workspace_id,
                            "task": &task
                        }));
                        tasks_updated.push(task);
                    }
                    ToolOutcome::TaskMoved(task, from_col, to_col) => {
                        // Fire trigger on the new column (on_entry)
                        let task = if !task.blocked {
                            let new_column = columns.iter().find(|c| c.id == task.column_id);
                            if let Some(col) = new_column {
                                pipeline::fire_trigger(conn, app, &task, col).unwrap_or(task)
                            } else {
                                task
                            }
                        } else {
                            task
                        };

                        results.push(ToolResult {
                            tool_use_id: tool_use.id.clone(),
                            content: format!("Moved \"{}\" from {} to {}", task.title, from_col, to_col),
                            is_error: false,
                        });
                        let _ = app.emit("task:updated", json!({
                            "workspace_id": workspace_id,
                            "task": &task
                        }));
                        // Emit tasks:changed so frontend refreshes
                        pipeline::emit_tasks_changed(app, workspace_id, "orchestrator_tool");
                        tasks_updated.push(task);
                    }
                    ToolOutcome::TaskDeleted(task_id, title) => {
                        results.push(ToolResult {
                            tool_use_id: tool_use.id.clone(),
                            content: format!("Deleted task: \"{}\"", title),
                            is_error: false,
                        });
                        let _ = app.emit("task:deleted", json!({
                            "workspace_id": workspace_id,
                            "task_id": &task_id
                        }));
                        tasks_deleted.push(task_id);
                    }
                    ToolOutcome::TasksQueued(task_ids, agent_type) => {
                        results.push(ToolResult {
                            tool_use_id: tool_use.id.clone(),
                            content: format!("Queued {} task(s) for {} agent processing", task_ids.len(), agent_type),
                            is_error: false,
                        });
                        // Emit event for frontend to handle batch agent spawning
                        let _ = app.emit("queue:batch_requested", json!({
                            "workspace_id": workspace_id,
                            "task_ids": &task_ids,
                            "agent_type": &agent_type
                        }));
                    }
                    ToolOutcome::TriggersConfigured(column_id, column_name, triggers_json) => {
                        results.push(ToolResult {
                            tool_use_id: tool_use.id.clone(),
                            content: format!("Configured triggers for column \"{}\":\n{}", column_name, triggers_json),
                            is_error: false,
                        });
                        let _ = app.emit("column:updated", json!({
                            "workspace_id": workspace_id,
                            "column_id": &column_id
                        }));
                    }
                }
            }
            Err(e) => {
                results.push(ToolResult {
                    tool_use_id: tool_use.id.clone(),
                    content: format!("Error: {}", e),
                    is_error: true,
                });
            }
        }
    }

    // Build summary
    let mut summary_parts = Vec::new();
    if !tasks_created.is_empty() {
        summary_parts.push(format!("Created {} task(s)", tasks_created.len()));
    }
    if !tasks_updated.is_empty() {
        summary_parts.push(format!("Updated {} task(s)", tasks_updated.len()));
    }
    if !tasks_deleted.is_empty() {
        summary_parts.push(format!("Deleted {} task(s)", tasks_deleted.len()));
    }
    let summary = if summary_parts.is_empty() {
        "No changes made".to_string()
    } else {
        summary_parts.join(", ")
    };

    Ok(ExecutionResult {
        results,
        tasks_created,
        tasks_updated,
        tasks_deleted,
        summary,
    })
}

/// Outcome of a single tool execution
enum ToolOutcome {
    TaskCreated(Task),
    TaskUpdated(Task),
    TaskMoved(Task, String, String),          // task, from_column, to_column
    TaskDeleted(String, String),              // task_id, title
    TasksQueued(Vec<String>, String),         // task_ids, agent_type
    TriggersConfigured(String, String, String), // column_id, column_name, triggers_json
}

/// Execute a single tool
fn execute_single_tool(
    conn: &Connection,
    workspace_id: &str,
    tool_name: &str,
    input: &serde_json::Value,
    columns: &[Column],
) -> Result<ToolOutcome, AppError> {
    match tool_name {
        "create_task" => {
            let title = input
                .get("title")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidInput("Missing title".to_string()))?;

            let description = input.get("description").and_then(|v| v.as_str());

            // Find column by name, or use first column
            let column_name = input.get("column").and_then(|v| v.as_str());
            let column_id = find_column_id(columns, column_name)?;

            let task = db::insert_task(conn, workspace_id, &column_id, title, description)
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;

            Ok(ToolOutcome::TaskCreated(task))
        }

        "update_task" => {
            let task_id = input
                .get("task_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidInput("Missing task_id".to_string()))?;

            let title = input.get("title").and_then(|v| v.as_str());
            let description = input.get("description").and_then(|v| v.as_str());

            // Convert description to the expected Option<Option<&str>> format
            let desc_option = description.map(Some);

            let task = db::update_task(
                conn,
                task_id,
                title,
                desc_option,
                None, // column_id
                None, // position
                None, // agent_mode
                None, // priority
            )
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;

            Ok(ToolOutcome::TaskUpdated(task))
        }

        "move_task" => {
            let task_id = input
                .get("task_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidInput("Missing task_id".to_string()))?;

            let column_name = input
                .get("column")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidInput("Missing column".to_string()))?;

            // Get current task to know the source column
            let current_task = db::get_task(conn, task_id)
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;
            let from_column = get_column_name(&current_task.column_id, columns);

            // Find target column
            let target_column_id = find_column_id(columns, Some(column_name))?;
            let to_column = get_column_name(&target_column_id, columns);

            // Move to end of target column
            let max_pos: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
                    rusqlite::params![target_column_id],
                    |row| row.get(0),
                )
                .unwrap_or(-1);

            let task = db::update_task(
                conn,
                task_id,
                None,
                None,
                Some(&target_column_id),
                Some(max_pos + 1),
                None,
                None,
            )
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;

            Ok(ToolOutcome::TaskMoved(task, from_column, to_column))
        }

        "delete_task" => {
            let task_id = input
                .get("task_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidInput("Missing task_id".to_string()))?;

            // Get task title before deleting
            let task = db::get_task(conn, task_id)
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;
            let title = task.title.clone();

            db::delete_task(conn, task_id)
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;

            Ok(ToolOutcome::TaskDeleted(task_id.to_string(), title))
        }

        "queue_tasks" => {
            let task_ids = input
                .get("task_ids")
                .and_then(|v| v.as_array())
                .ok_or_else(|| AppError::InvalidInput("Missing task_ids array".to_string()))?
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>();

            if task_ids.is_empty() {
                return Err(AppError::InvalidInput("task_ids array is empty".to_string()));
            }

            let agent_type = input
                .get("agent_type")
                .and_then(|v| v.as_str())
                .unwrap_or("claude")
                .to_string();

            Ok(ToolOutcome::TasksQueued(task_ids, agent_type))
        }

        "configure_triggers" => {
            let column_name = input
                .get("column")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidInput("Missing column name".to_string()))?;

            // Find column by name
            let column_id = find_column_id(columns, Some(column_name))?;
            let col_name = get_column_name(&column_id, columns);

            // Build triggers JSON from structured input
            let triggers = json!({
                "on_entry": input.get("on_entry").cloned().unwrap_or(json!(null)),
                "on_exit": input.get("on_exit").cloned().unwrap_or(json!(null)),
                "exit_criteria": input.get("exit_criteria").cloned().unwrap_or(json!({"type": "manual", "auto_advance": false})),
            });
            let triggers_json = serde_json::to_string(&triggers)
                .map_err(|e| AppError::InvalidInput(format!("Failed to serialize triggers: {}", e)))?;

            // Save to database
            db::update_column(
                conn,
                &column_id,
                None, None, None, None, None,
                Some(&triggers_json), // triggers
                None, None, None,
            )
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;

            Ok(ToolOutcome::TriggersConfigured(column_id, col_name, triggers_json))
        }

        _ => Err(AppError::InvalidInput(format!(
            "Unknown tool: {}",
            tool_name
        ))),
    }
}

/// Find column ID by name (case-insensitive fuzzy match)
fn find_column_id(columns: &[Column], name: Option<&str>) -> Result<String, AppError> {
    // If no name provided, use first column
    let search = match name {
        None => {
            return columns
                .first()
                .map(|c| c.id.clone())
                .ok_or_else(|| AppError::InvalidInput("No columns in workspace".to_string()));
        }
        Some(n) => n.to_lowercase(),
    };

    // Exact match first
    if let Some(col) = columns.iter().find(|c| c.name.to_lowercase() == search) {
        return Ok(col.id.clone());
    }

    // Partial/fuzzy match
    if let Some(col) = columns
        .iter()
        .find(|c| c.name.to_lowercase().contains(&search))
    {
        return Ok(col.id.clone());
    }

    // Common aliases
    let normalized = match search.as_str() {
        "todo" | "to do" | "to-do" => "backlog",
        "wip" | "doing" | "working" => "in progress",
        "complete" | "completed" | "finished" => "done",
        _ => &search,
    };

    if let Some(col) = columns
        .iter()
        .find(|c| c.name.to_lowercase().contains(normalized))
    {
        return Ok(col.id.clone());
    }

    Err(AppError::InvalidInput(format!(
        "Column not found: '{}'. Available columns: {}",
        name.unwrap_or(""),
        columns
            .iter()
            .map(|c| c.name.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    )))
}

/// Get column name by ID
fn get_column_name(column_id: &str, columns: &[Column]) -> String {
    columns
        .iter()
        .find(|c| c.id == column_id)
        .map(|c| c.name.clone())
        .unwrap_or_else(|| "Unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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
                triggers: None,
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
                triggers: None,
                trigger_config: "{}".to_string(),
                exit_config: "{}".to_string(),
                auto_advance: false,
                created_at: "2024-01-01".to_string(),
                updated_at: "2024-01-01".to_string(),
            },
        ]
    }

    #[test]
    fn test_find_column_exact_match() {
        let columns = mock_columns();
        let id = find_column_id(&columns, Some("Backlog")).unwrap();
        assert_eq!(id, "col-1");
    }

    #[test]
    fn test_find_column_case_insensitive() {
        let columns = mock_columns();
        let id = find_column_id(&columns, Some("backlog")).unwrap();
        assert_eq!(id, "col-1");
    }

    #[test]
    fn test_find_column_partial_match() {
        let columns = mock_columns();
        let id = find_column_id(&columns, Some("progress")).unwrap();
        assert_eq!(id, "col-2");
    }

    #[test]
    fn test_find_column_alias() {
        let columns = mock_columns();
        let id = find_column_id(&columns, Some("todo")).unwrap();
        assert_eq!(id, "col-1");
    }

    #[test]
    fn test_find_column_default() {
        let columns = mock_columns();
        let id = find_column_id(&columns, None).unwrap();
        assert_eq!(id, "col-1"); // First column
    }

    #[test]
    fn test_find_column_not_found() {
        let columns = mock_columns();
        let result = find_column_id(&columns, Some("nonexistent"));
        assert!(result.is_err());
    }
}
