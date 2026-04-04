//! Task dependency checking and unblocking.
//!
//! When a task completes, this module finds tasks that depend on it
//! and checks if their dependency conditions are met. If all dependencies
//! are satisfied, the dependent task is unblocked and its `on_met` action fires.

use crate::db::{self, Task};
use crate::error::AppError;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::triggers::{self, TriggerActionV2};
use super::PipelineEvent;

/// A dependency from one task to another.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDependency {
    pub task_id: String,
    pub condition: String, // "completed", "moved_to_column", "agent_complete"
    #[serde(default)]
    pub target_column: Option<String>,
    pub on_met: TriggerActionV2,
}

/// Find all tasks whose `dependencies` JSON mentions the given task_id.
pub fn find_dependents(conn: &Connection, task_id: &str) -> Result<Vec<(Task, Vec<TaskDependency>)>, AppError> {
    // Use LIKE to find tasks that reference this task_id in their dependencies JSON
    let mut stmt = conn
        .prepare(
            "SELECT id FROM tasks WHERE dependencies IS NOT NULL AND dependencies != '[]' AND dependencies LIKE ?1",
        )
        .map_err(AppError::from)?;

    let pattern = format!("%{}%", task_id);
    let task_ids: Vec<String> = stmt
        .query_map(rusqlite::params![pattern], |row| row.get(0))
        .map_err(AppError::from)?
        .filter_map(|r| r.ok())
        .collect();

    let mut results = Vec::new();
    for id in task_ids {
        let task = db::get_task(conn, &id)?;
        if let Some(ref deps_json) = task.dependencies {
            if let Ok(deps) = serde_json::from_str::<Vec<TaskDependency>>(deps_json) {
                // Only include if this task actually depends on the target
                if deps.iter().any(|d| d.task_id == task_id) {
                    results.push((task, deps));
                }
            }
        }
    }

    Ok(results)
}

/// Check if a dependency condition is met based on the source task's state.
pub fn check_condition(dep: &TaskDependency, source_task: &Task, conn: &Connection) -> Result<bool, AppError> {
    match dep.condition.as_str() {
        "completed" => {
            // Task is "completed" if it's in the last column (no next column)
            let col = db::get_column(conn, &source_task.column_id)?;
            let has_next = db::get_next_column(conn, &source_task.workspace_id, col.position)?;
            Ok(has_next.is_none())
        }
        "moved_to_column" => {
            // Check if source task is in the specified target column
            if let Some(ref target_col_id) = dep.target_column {
                Ok(&source_task.column_id == target_col_id)
            } else {
                Ok(false)
            }
        }
        "agent_complete" => {
            // Check if the agent session is completed
            if let Some(ref session_id) = source_task.agent_session_id {
                match db::get_agent_session(conn, session_id) {
                    Ok(session) => Ok(session.status == "completed"),
                    Err(_) => Ok(false),
                }
            } else {
                // No agent session - check agent_status field
                Ok(source_task.agent_status.as_deref() == Some("completed"))
            }
        }
        _ => Ok(false),
    }
}

/// Process all tasks that depend on the given source task.
/// Called when a task completes, moves, or its agent finishes.
pub fn check_dependents(
    conn: &Connection,
    app: &AppHandle,
    source_task: &Task,
) -> Result<(), AppError> {
    let dependents = find_dependents(conn, &source_task.id)?;

    for (dependent_task, deps) in dependents {
        let mut all_met = true;

        for dep in &deps {
            if dep.task_id == source_task.id {
                // Check this specific dependency
                let met = check_condition(dep, source_task, conn)?;
                if met {
                    // Execute the on_met action
                    execute_on_met(conn, app, &dependent_task, &dep.on_met, source_task)?;
                } else {
                    all_met = false;
                }
            } else {
                // Check if other dependency is met by looking up the source task
                match db::get_task(conn, &dep.task_id) {
                    Ok(other_source) => {
                        if !check_condition(dep, &other_source, conn)? {
                            all_met = false;
                        }
                    }
                    Err(_) => {
                        all_met = false;
                    }
                }
            }
        }

        // Update blocked state
        if all_met && dependent_task.blocked {
            update_blocked(conn, &dependent_task.id, false)?;

            let _ = app.emit("pipeline:unblocked", &PipelineEvent {
                task_id: dependent_task.id.clone(),
                column_id: dependent_task.column_id.clone(),
                event_type: "unblocked".to_string(),
                state: "idle".to_string(),
                message: Some(format!("All dependencies met, unblocked by {}", source_task.title)),
            });
        }
    }

    Ok(())
}

/// Execute the on_met action for a dependency.
fn execute_on_met(
    conn: &Connection,
    app: &AppHandle,
    dependent_task: &Task,
    action: &TriggerActionV2,
    _source_task: &Task,
) -> Result<(), AppError> {
    match action {
        TriggerActionV2::MoveColumn { target } => {
            let target_col = resolve_column_target(conn, dependent_task, target)?;
            if let Some(col) = target_col {
                // Move the dependent task to the target column
                let ts = db::now();
                let max_pos: i64 = conn
                    .query_row(
                        "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
                        rusqlite::params![col.id],
                        |row| row.get(0),
                    )
                    .unwrap_or(-1);

                conn.execute(
                    "UPDATE tasks SET column_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
                    rusqlite::params![col.id, max_pos + 1, ts, dependent_task.id],
                )
                .map_err(AppError::from)?;

                let _ = app.emit("pipeline:dependency_moved", &PipelineEvent {
                    task_id: dependent_task.id.clone(),
                    column_id: col.id.clone(),
                    event_type: "dependency_moved".to_string(),
                    state: "idle".to_string(),
                    message: Some(format!("Moved to {} by dependency", col.name)),
                });

                // Fire on_entry trigger for the new column
                let updated_task = db::get_task(conn, &dependent_task.id)?;
                let _ = super::fire_trigger(conn, app, &updated_task, &col);
            }
        }
        TriggerActionV2::SpawnCli { .. } => {
            // For spawn_cli on_met, fire the trigger on the task's current column
            let col = db::get_column(conn, &dependent_task.column_id)?;
            let _ = super::fire_trigger(conn, app, dependent_task, &col);
        }
        TriggerActionV2::None => {}
        _ => {}
    }

    Ok(())
}

/// Resolve a column target string — delegates to triggers::resolve_column_target.
fn resolve_column_target(
    conn: &Connection,
    task: &Task,
    target: &str,
) -> Result<Option<db::Column>, AppError> {
    triggers::resolve_column_target(conn, task, target)
}

/// Validate that adding these dependencies won't create a cycle.
/// Uses DFS to detect cycles in the dependency graph.
pub fn validate_dependencies(
    conn: &Connection,
    task_id: &str,
    new_deps: &[TaskDependency],
) -> Result<(), AppError> {
    // 1. Self-loop check
    for dep in new_deps {
        if dep.task_id == task_id {
            return Err(AppError::InvalidInput(
                "Task cannot depend on itself".to_string()
            ));
        }
    }

    // 2. Validate referenced tasks exist
    for dep in new_deps {
        db::get_task(conn, &dep.task_id).map_err(|_| {
            AppError::InvalidInput(format!("Dependency task not found: {}", dep.task_id))
        })?;
    }

    // 3. Build adjacency list from all tasks in the same workspace
    let task = db::get_task(conn, task_id)?;
    let all_tasks = db::list_tasks(conn, &task.workspace_id)?;

    let mut graph: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();

    for t in &all_tasks {
        if let Some(ref deps_json) = t.dependencies {
            if let Ok(deps) = serde_json::from_str::<Vec<TaskDependency>>(deps_json) {
                for d in &deps {
                    graph.entry(t.id.clone()).or_default().push(d.task_id.clone());
                }
            }
        }
    }

    // 4. Add proposed new deps to graph
    for dep in new_deps {
        graph.entry(task_id.to_string()).or_default().push(dep.task_id.clone());
    }

    // 5. DFS cycle detection from task_id
    let mut visited = std::collections::HashSet::new();
    let mut stack = std::collections::HashSet::new();

    fn has_cycle(
        node: &str,
        graph: &std::collections::HashMap<String, Vec<String>>,
        visited: &mut std::collections::HashSet<String>,
        stack: &mut std::collections::HashSet<String>,
    ) -> bool {
        if stack.contains(node) {
            return true; // cycle!
        }
        if visited.contains(node) {
            return false; // already fully explored
        }

        visited.insert(node.to_string());
        stack.insert(node.to_string());

        if let Some(neighbors) = graph.get(node) {
            for neighbor in neighbors {
                if has_cycle(neighbor, graph, visited, stack) {
                    return true;
                }
            }
        }

        stack.remove(node);
        false
    }

    if has_cycle(task_id, &graph, &mut visited, &mut stack) {
        return Err(AppError::InvalidInput(
            "Adding this dependency would create a cycle".to_string()
        ));
    }

    Ok(())
}

/// Update a task's blocked state.
fn update_blocked(conn: &Connection, task_id: &str, blocked: bool) -> Result<(), AppError> {
    let ts = db::now();
    conn.execute(
        "UPDATE tasks SET blocked = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![blocked as i64, ts, task_id],
    )
    .map_err(AppError::from)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn setup_test_db() -> Connection {
        db::init_test().unwrap()
    }

    #[test]
    fn test_validate_no_cycle() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Backlog", 0).unwrap();
        let task_a = db::insert_task(&conn, &ws.id, &col.id, "A", None).unwrap();
        let task_b = db::insert_task(&conn, &ws.id, &col.id, "B", None).unwrap();

        let deps = vec![TaskDependency {
            task_id: task_b.id.clone(),
            condition: "completed".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        }];

        assert!(validate_dependencies(&conn, &task_a.id, &deps).is_ok());
    }

    #[test]
    fn test_validate_self_loop() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Backlog", 0).unwrap();
        let task_a = db::insert_task(&conn, &ws.id, &col.id, "A", None).unwrap();

        let deps = vec![TaskDependency {
            task_id: task_a.id.clone(),
            condition: "completed".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        }];

        let result = validate_dependencies(&conn, &task_a.id, &deps);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("itself"));
    }

    #[test]
    fn test_validate_direct_cycle() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Backlog", 0).unwrap();
        let task_a = db::insert_task(&conn, &ws.id, &col.id, "A", None).unwrap();
        let task_b = db::insert_task(&conn, &ws.id, &col.id, "B", None).unwrap();

        // B already depends on A
        let b_deps = serde_json::to_string(&vec![TaskDependency {
            task_id: task_a.id.clone(),
            condition: "completed".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        }]).unwrap();
        conn.execute(
            "UPDATE tasks SET dependencies = ?1 WHERE id = ?2",
            rusqlite::params![b_deps, task_b.id],
        ).unwrap();

        // Now try to make A depend on B — should be cycle
        let deps = vec![TaskDependency {
            task_id: task_b.id.clone(),
            condition: "completed".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        }];

        let result = validate_dependencies(&conn, &task_a.id, &deps);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("cycle"));
    }

    #[test]
    fn test_validate_nonexistent_task() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Backlog", 0).unwrap();
        let task_a = db::insert_task(&conn, &ws.id, &col.id, "A", None).unwrap();

        let deps = vec![TaskDependency {
            task_id: "nonexistent-id".to_string(),
            condition: "completed".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        }];

        let result = validate_dependencies(&conn, &task_a.id, &deps);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }
}
