//! Tool execution for orchestrator
//!
//! Executes tool calls from the LLM against the database.

use crate::db::{self, Column, Task};
use crate::error::AppError;
use crate::llm::tools::{ToolResult, ToolUse};
use crate::pipeline;
use rusqlite::Connection;
use serde::Serialize;
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskCreatedPayload {
    workspace_id: String,
    task: Task,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskUpdatedPayload {
    workspace_id: String,
    task: Task,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskDeletedPayload {
    workspace_id: String,
    task_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QueueBatchRequestedPayload {
    workspace_id: String,
    task_ids: Vec<String>,
    agent_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ColumnUpdatedPayload {
    workspace_id: String,
    column_id: String,
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

    // Track the last created task ID for __LAST__ references
    let mut last_created_task_id: Option<String> = None;

    for tool_use in tool_uses {
        // Resolve __LAST__ placeholder in input (references last created task)
        let resolved_input =
            resolve_last_placeholder(&tool_use.input, last_created_task_id.as_deref());

        let result =
            execute_single_tool(conn, workspace_id, &tool_use.name, &resolved_input, columns);

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
                            content: format!(
                                "Created task: \"{}\" in {}",
                                task.title,
                                get_column_name(&task.column_id, columns)
                            ),
                            is_error: false,
                        });
                        // Emit event for frontend
                        let _ = app.emit(
                            "task:created",
                            TaskCreatedPayload {
                                workspace_id: workspace_id.to_string(),
                                task: task.clone(),
                            },
                        );
                        // Emit tasks:changed so frontend refreshes
                        pipeline::emit_tasks_changed(app, workspace_id, "orchestrator_tool");
                        last_created_task_id = Some(task.id.clone());
                        tasks_created.push(task);
                    }
                    ToolOutcome::TaskUpdated(task) => {
                        results.push(ToolResult {
                            tool_use_id: tool_use.id.clone(),
                            content: format!("Updated task: \"{}\"", task.title),
                            is_error: false,
                        });
                        let _ = app.emit(
                            "task:updated",
                            TaskUpdatedPayload {
                                workspace_id: workspace_id.to_string(),
                                task: task.clone(),
                            },
                        );
                        pipeline::emit_tasks_changed(app, workspace_id, "orchestrator_tool");
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
                            content: format!(
                                "Moved \"{}\" from {} to {}",
                                task.title, from_col, to_col
                            ),
                            is_error: false,
                        });
                        let _ = app.emit(
                            "task:updated",
                            TaskUpdatedPayload {
                                workspace_id: workspace_id.to_string(),
                                task: task.clone(),
                            },
                        );
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
                        let _ = app.emit(
                            "task:deleted",
                            TaskDeletedPayload {
                                workspace_id: workspace_id.to_string(),
                                task_id: task_id.clone(),
                            },
                        );
                        pipeline::emit_tasks_changed(app, workspace_id, "orchestrator_tool");
                        tasks_deleted.push(task_id);
                    }
                    ToolOutcome::TasksQueued(task_ids, agent_type) => {
                        results.push(ToolResult {
                            tool_use_id: tool_use.id.clone(),
                            content: format!(
                                "Queued {} task(s) for {} agent processing",
                                task_ids.len(),
                                agent_type
                            ),
                            is_error: false,
                        });
                        // Emit event for frontend to handle batch agent spawning
                        let _ = app.emit(
                            "queue:batch_requested",
                            QueueBatchRequestedPayload {
                                workspace_id: workspace_id.to_string(),
                                task_ids: task_ids.clone(),
                                agent_type: agent_type.clone(),
                            },
                        );
                    }
                    ToolOutcome::TriggersConfigured(column_id, column_name, triggers_json) => {
                        results.push(ToolResult {
                            tool_use_id: tool_use.id.clone(),
                            content: format!(
                                "Configured triggers for column \"{}\":\n{}",
                                column_name, triggers_json
                            ),
                            is_error: false,
                        });
                        let _ = app.emit(
                            "column:updated",
                            ColumnUpdatedPayload {
                                workspace_id: workspace_id.to_string(),
                                column_id: column_id.clone(),
                            },
                        );
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

/// Replace __LAST__ and PENDING placeholders in tool input with the actual task ID.
/// This allows chained actions like: create_task → move_task with task_id: "__LAST__"
fn resolve_last_placeholder(input: &serde_json::Value, last_id: Option<&str>) -> serde_json::Value {
    let Some(id) = last_id else {
        return input.clone();
    };

    match input {
        serde_json::Value::String(s) => {
            if s == "__LAST__" || s == "PENDING" || s == "__last__" {
                serde_json::Value::String(id.to_string())
            } else {
                input.clone()
            }
        }
        serde_json::Value::Object(map) => {
            let mut new_map = serde_json::Map::new();
            for (k, v) in map {
                new_map.insert(k.clone(), resolve_last_placeholder(v, Some(id)));
            }
            serde_json::Value::Object(new_map)
        }
        serde_json::Value::Array(arr) => serde_json::Value::Array(
            arr.iter()
                .map(|v| resolve_last_placeholder(v, Some(id)))
                .collect(),
        ),
        _ => input.clone(),
    }
}

/// Outcome of a single tool execution
enum ToolOutcome {
    TaskCreated(Task),
    TaskUpdated(Task),
    TaskMoved(Task, String, String),  // task, from_column, to_column
    TaskDeleted(String, String),      // task_id, title
    TasksQueued(Vec<String>, String), // task_ids, agent_type
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
            let title = title.trim();
            if title.is_empty() {
                return Err(AppError::InvalidInput(
                    "Task title cannot be empty".to_string(),
                ));
            }

            let description = input.get("description").and_then(|v| v.as_str());

            let column_id = if let Some(column_id) = input
                .get("column_id")
                .or_else(|| input.get("columnId"))
                .and_then(|v| v.as_str())
            {
                resolve_column_id(columns, column_id)?
            } else {
                find_column_id(columns, input.get("column").and_then(|v| v.as_str()))?
            };

            let task = db::insert_task(conn, workspace_id, &column_id, title, description)
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;

            Ok(ToolOutcome::TaskCreated(task))
        }

        "update_task" => {
            let task_id = input
                .get("task_id")
                .or_else(|| input.get("taskId"))
                .or_else(|| input.get("id"))
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidInput("Missing task_id".to_string()))?;

            let title = input.get("title").and_then(|v| v.as_str());
            let title = title
                .map(str::trim)
                .map(|title| {
                    if title.is_empty() {
                        Err(AppError::InvalidInput(
                            "Task title cannot be empty".to_string(),
                        ))
                    } else {
                        Ok(title)
                    }
                })
                .transpose()?;
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
                .or_else(|| input.get("taskId"))
                .or_else(|| input.get("id"))
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidInput("Missing task_id".to_string()))?;

            // Get current task to know the source column
            let current_task =
                db::get_task(conn, task_id).map_err(|e| AppError::DatabaseError(e.to_string()))?;
            let from_column = get_column_name(&current_task.column_id, columns);

            let target_column_id = if let Some(column_id) = input
                .get("column_id")
                .or_else(|| input.get("columnId"))
                .or_else(|| input.get("target_column_id"))
                .or_else(|| input.get("targetColumnId"))
                .and_then(|v| v.as_str())
            {
                resolve_column_id(columns, column_id)?
            } else {
                let column_name = input
                    .get("column")
                    .or_else(|| input.get("target_column"))
                    .or_else(|| input.get("targetColumn"))
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| AppError::InvalidInput("Missing column".to_string()))?;
                find_column_id(columns, Some(column_name))?
            };
            let to_column = get_column_name(&target_column_id, columns);

            let position = if let Some(value) = input.get("position") {
                let position = value.as_i64().ok_or_else(|| {
                    AppError::InvalidInput("Position must be an integer".to_string())
                })?;
                if position < 0 {
                    return Err(AppError::InvalidInput(
                        "Position must be non-negative".to_string(),
                    ));
                }
                position
            } else {
                conn.query_row(
                    "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
                    rusqlite::params![target_column_id],
                    |row| row.get::<_, i64>(0),
                )
                .map(|max_pos| max_pos + 1)
                .unwrap_or(0)
            };

            let task = move_task_to_column(
                conn,
                task_id,
                &current_task.column_id,
                &target_column_id,
                position,
            )?;

            Ok(ToolOutcome::TaskMoved(task, from_column, to_column))
        }

        "delete_task" => {
            let task_id = input
                .get("task_id")
                .or_else(|| input.get("taskId"))
                .or_else(|| input.get("id"))
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InvalidInput("Missing task_id".to_string()))?;

            // Get task title before deleting
            let task =
                db::get_task(conn, task_id).map_err(|e| AppError::DatabaseError(e.to_string()))?;
            let title = task.title.clone();

            db::delete_task(conn, task_id).map_err(|e| AppError::DatabaseError(e.to_string()))?;

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
                return Err(AppError::InvalidInput(
                    "task_ids array is empty".to_string(),
                ));
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
            let triggers_json = serde_json::to_string(&triggers).map_err(|e| {
                AppError::InvalidInput(format!("Failed to serialize triggers: {}", e))
            })?;

            // Save to database
            db::update_column(
                conn,
                &column_id,
                None,
                None,
                None,
                None,
                None,
                Some(&triggers_json),
            )
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;

            Ok(ToolOutcome::TriggersConfigured(
                column_id,
                col_name,
                triggers_json,
            ))
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

/// Resolve an explicit column ID, accepting a column name as a fallback.
fn resolve_column_id(columns: &[Column], id_or_name: &str) -> Result<String, AppError> {
    if let Some(col) = columns.iter().find(|c| c.id == id_or_name) {
        return Ok(col.id.clone());
    }

    find_column_id(columns, Some(id_or_name))
}

fn move_task_to_column(
    conn: &Connection,
    task_id: &str,
    old_column_id: &str,
    target_column_id: &str,
    position: i64,
) -> Result<Task, AppError> {
    let ts = db::now();
    if old_column_id == target_column_id {
        conn.execute(
            "UPDATE tasks SET column_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![target_column_id, position, ts, task_id],
        )
    } else {
        conn.execute(
            "UPDATE tasks SET column_id = ?1, position = ?2, pipeline_state = 'idle', pipeline_triggered_at = NULL, pipeline_error = NULL, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![target_column_id, position, ts, task_id],
        )
    }
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    db::get_task(conn, task_id).map_err(|e| AppError::DatabaseError(e.to_string()))
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
    use serde_json::json;

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

    fn setup_db_with_columns() -> (rusqlite::Connection, String, Vec<Column>) {
        let conn = db::init_test().unwrap();
        let workspace = db::insert_workspace(&conn, "Test", "/tmp/test").unwrap();
        let backlog = db::insert_column(&conn, &workspace.id, "Backlog", 0).unwrap();
        let done = db::insert_column(&conn, &workspace.id, "Done", 1).unwrap();
        (conn, workspace.id, vec![backlog, done])
    }

    #[test]
    fn test_create_task_rejects_blank_title() {
        let (conn, workspace_id, columns) = setup_db_with_columns();
        let result = execute_single_tool(
            &conn,
            &workspace_id,
            "create_task",
            &json!({ "title": "   ", "column": "Backlog" }),
            &columns,
        );

        assert!(
            matches!(result, Err(AppError::InvalidInput(message)) if message == "Task title cannot be empty")
        );
    }

    #[test]
    fn test_move_task_resets_pipeline_state_when_column_changes() {
        let (conn, workspace_id, columns) = setup_db_with_columns();
        let task = db::insert_task(&conn, &workspace_id, &columns[0].id, "Task", None).unwrap();
        db::update_task_pipeline_state(
            &conn,
            &task.id,
            "error",
            Some("2024-01-01T00:00:00Z"),
            Some("failed"),
        )
        .unwrap();

        let outcome = execute_single_tool(
            &conn,
            &workspace_id,
            "move_task",
            &json!({ "task_id": task.id, "column_id": columns[1].id }),
            &columns,
        )
        .unwrap();

        let ToolOutcome::TaskMoved(moved, _, _) = outcome else {
            panic!("expected task move");
        };
        assert_eq!(moved.column_id, columns[1].id);
        assert_eq!(moved.pipeline_state, "idle");
        assert!(moved.pipeline_triggered_at.is_none());
        assert!(moved.pipeline_error.is_none());
    }

    #[test]
    fn test_move_task_rejects_non_integer_position() {
        let (conn, workspace_id, columns) = setup_db_with_columns();
        let task = db::insert_task(&conn, &workspace_id, &columns[0].id, "Task", None).unwrap();

        let result = execute_single_tool(
            &conn,
            &workspace_id,
            "move_task",
            &json!({ "task_id": task.id, "column_id": columns[1].id, "position": "first" }),
            &columns,
        );

        assert!(
            matches!(result, Err(AppError::InvalidInput(message)) if message == "Position must be an integer")
        );
    }
}
