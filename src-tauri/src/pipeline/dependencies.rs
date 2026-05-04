//! Task dependency checking and unblocking.
//!
//! When a task completes, this module finds tasks that depend on it
//! and checks if their dependency conditions are met. If all dependencies
//! are satisfied, the dependent task is unblocked and its `on_met` action fires.

use crate::db::{self, Task};
use crate::error::AppError;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::triggers::{self, TriggerActionV2};
use super::{emit_pipeline, fire_trigger, PipelineState, EVT_DEP_MOVED, EVT_UNBLOCKED};

/// A dependency from one task to another.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDependency {
    pub task_id: String,
    pub condition: String, // "completed", "moved_to_column", "at_or_past_column", "in_review", "agent_complete"
    #[serde(default)]
    pub target_column: Option<String>,
    pub on_met: TriggerActionV2,
}

/// Find all tasks whose `dependencies` JSON mentions the given task_id.
pub fn find_dependents(
    conn: &Connection,
    task_id: &str,
) -> Result<Vec<(Task, Vec<TaskDependency>)>, AppError> {
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

/// Find the branch a chained task should base its worktree off.
///
/// When a task has dependencies on other tasks that share its `batch_id`,
/// the new branch should be cut from the predecessor's HEAD rather than
/// `origin/main`, so that chained PRs don't cascade-conflict on shared
/// modules (e.g. db migrations, model structs, top-level UI files).
///
/// Returns `Some(branch_name)` when at least one same-batch predecessor
/// already has a branch, preferring the predecessor that has progressed
/// furthest along the pipeline (highest column position) — that's the
/// closest ancestor and contains all earlier predecessors' work too.
/// Returns `None` when there is no chain or no predecessor branch exists
/// yet; the caller should fall back to the workspace default base.
pub fn predecessor_branch_for_chain(
    conn: &Connection,
    task: &Task,
) -> Result<Option<String>, AppError> {
    let Some(batch_id) = task
        .batch_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    else {
        return Ok(None);
    };

    let Some(deps_json) = task.dependencies.as_deref() else {
        return Ok(None);
    };
    let trimmed = deps_json.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return Ok(None);
    }
    let Ok(deps) = serde_json::from_str::<Vec<TaskDependency>>(deps_json) else {
        return Ok(None);
    };
    if deps.is_empty() {
        return Ok(None);
    }

    let mut best: Option<(i64, String)> = None;

    for dep in &deps {
        let Ok(predecessor) = db::get_task(conn, &dep.task_id) else {
            continue;
        };
        if predecessor.batch_id.as_deref() != Some(batch_id) {
            continue;
        }
        let Some(branch) = predecessor
            .branch_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let position = db::get_column(conn, &predecessor.column_id)
            .map(|c| c.position)
            .unwrap_or(-1);
        match &best {
            Some((current_pos, _)) if *current_pos >= position => {}
            _ => best = Some((position, branch.to_string())),
        }
    }

    Ok(best.map(|(_, branch)| branch))
}

/// Check if a dependency condition is met based on the source task's state.
pub fn check_condition(
    dep: &TaskDependency,
    source_task: &Task,
    conn: &Connection,
) -> Result<bool, AppError> {
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
        // "at_or_past_column" / "in_review": source has reached target column or any column after it.
        // Use when chaining with batch_wait so dependents unblock as soon as the source enters the
        // review/PR stage rather than waiting for it to reach Done (which never happens while the
        // batch is still filling).
        "at_or_past_column" | "in_review" => {
            let Some(ref target_col_id) = dep.target_column else {
                return Ok(false);
            };
            let target_col = match db::get_column(conn, target_col_id) {
                Ok(c) => c,
                Err(_) => return Ok(false),
            };
            let source_col = db::get_column(conn, &source_task.column_id)?;
            Ok(source_col.workspace_id == target_col.workspace_id
                && source_col.position >= target_col.position)
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

            emit_pipeline(
                app,
                EVT_UNBLOCKED,
                &dependent_task.id,
                &dependent_task.column_id,
                PipelineState::Idle,
                Some(format!(
                    "All dependencies met, unblocked by {}",
                    source_task.title
                )),
            );
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

                emit_pipeline(
                    app,
                    EVT_DEP_MOVED,
                    &dependent_task.id,
                    &col.id,
                    PipelineState::Idle,
                    Some(format!("Moved to {} by dependency", col.name)),
                );

                // Fire on_entry trigger for the new column
                let updated_task = db::get_task(conn, &dependent_task.id)?;
                let _ = fire_trigger(conn, app, &updated_task, &col);
            }
        }
        TriggerActionV2::SpawnCli { .. } => {
            // For spawn_cli on_met, fire the trigger on the task's current column
            let col = db::get_column(conn, &dependent_task.column_id)?;
            let _ = fire_trigger(conn, app, dependent_task, &col);
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
                "Task cannot depend on itself".to_string(),
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

    let mut graph: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();

    for t in &all_tasks {
        if let Some(ref deps_json) = t.dependencies {
            if let Ok(deps) = serde_json::from_str::<Vec<TaskDependency>>(deps_json) {
                for d in &deps {
                    graph
                        .entry(t.id.clone())
                        .or_default()
                        .push(d.task_id.clone());
                }
            }
        }
    }

    // 4. Add proposed new deps to graph
    for dep in new_deps {
        graph
            .entry(task_id.to_string())
            .or_default()
            .push(dep.task_id.clone());
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
            "Adding this dependency would create a cycle".to_string(),
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
        }])
        .unwrap();
        conn.execute(
            "UPDATE tasks SET dependencies = ?1 WHERE id = ?2",
            rusqlite::params![b_deps, task_b.id],
        )
        .unwrap();

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

    #[test]
    fn test_validate_transitive_cycle() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Backlog", 0).unwrap();
        let task_a = db::insert_task(&conn, &ws.id, &col.id, "A", None).unwrap();
        let task_b = db::insert_task(&conn, &ws.id, &col.id, "B", None).unwrap();
        let task_c = db::insert_task(&conn, &ws.id, &col.id, "C", None).unwrap();

        // A → B (A depends on B)
        let a_deps = serde_json::to_string(&vec![TaskDependency {
            task_id: task_b.id.clone(),
            condition: "completed".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        }])
        .unwrap();
        conn.execute(
            "UPDATE tasks SET dependencies = ?1 WHERE id = ?2",
            rusqlite::params![a_deps, task_a.id],
        )
        .unwrap();

        // B → C (B depends on C)
        let b_deps = serde_json::to_string(&vec![TaskDependency {
            task_id: task_c.id.clone(),
            condition: "completed".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        }])
        .unwrap();
        conn.execute(
            "UPDATE tasks SET dependencies = ?1 WHERE id = ?2",
            rusqlite::params![b_deps, task_b.id],
        )
        .unwrap();

        // Try C → A — should detect transitive cycle (C→A→B→C)
        let deps = vec![TaskDependency {
            task_id: task_a.id.clone(),
            condition: "completed".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        }];

        let result = validate_dependencies(&conn, &task_c.id, &deps);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("cycle"));
    }

    #[test]
    fn test_validate_diamond_no_cycle() {
        // Diamond: A→C, B→C, D→A, D→B — no cycle
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Backlog", 0).unwrap();
        let task_a = db::insert_task(&conn, &ws.id, &col.id, "A", None).unwrap();
        let task_b = db::insert_task(&conn, &ws.id, &col.id, "B", None).unwrap();
        let task_c = db::insert_task(&conn, &ws.id, &col.id, "C", None).unwrap();
        let task_d = db::insert_task(&conn, &ws.id, &col.id, "D", None).unwrap();

        // A depends on C
        let a_deps = serde_json::to_string(&vec![TaskDependency {
            task_id: task_c.id.clone(),
            condition: "completed".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        }])
        .unwrap();
        conn.execute(
            "UPDATE tasks SET dependencies = ?1 WHERE id = ?2",
            rusqlite::params![a_deps, task_a.id],
        )
        .unwrap();

        // B depends on C
        let b_deps = serde_json::to_string(&vec![TaskDependency {
            task_id: task_c.id.clone(),
            condition: "completed".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        }])
        .unwrap();
        conn.execute(
            "UPDATE tasks SET dependencies = ?1 WHERE id = ?2",
            rusqlite::params![b_deps, task_b.id],
        )
        .unwrap();

        // D depends on both A and B — should be fine (diamond, no cycle)
        let deps = vec![
            TaskDependency {
                task_id: task_a.id.clone(),
                condition: "completed".to_string(),
                target_column: None,
                on_met: TriggerActionV2::None,
            },
            TaskDependency {
                task_id: task_b.id.clone(),
                condition: "completed".to_string(),
                target_column: None,
                on_met: TriggerActionV2::None,
            },
        ];

        assert!(validate_dependencies(&conn, &task_d.id, &deps).is_ok());
    }

    #[test]
    fn test_find_dependents_returns_matching_tasks() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Backlog", 0).unwrap();
        let task_a = db::insert_task(&conn, &ws.id, &col.id, "A", None).unwrap();
        let task_b = db::insert_task(&conn, &ws.id, &col.id, "B", None).unwrap();
        let task_c = db::insert_task(&conn, &ws.id, &col.id, "C", None).unwrap();

        // B depends on A
        let b_deps = serde_json::to_string(&vec![TaskDependency {
            task_id: task_a.id.clone(),
            condition: "completed".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        }])
        .unwrap();
        conn.execute(
            "UPDATE tasks SET dependencies = ?1 WHERE id = ?2",
            rusqlite::params![b_deps, task_b.id],
        )
        .unwrap();

        // C depends on A
        let c_deps = serde_json::to_string(&vec![TaskDependency {
            task_id: task_a.id.clone(),
            condition: "completed".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        }])
        .unwrap();
        conn.execute(
            "UPDATE tasks SET dependencies = ?1 WHERE id = ?2",
            rusqlite::params![c_deps, task_c.id],
        )
        .unwrap();

        let dependents = find_dependents(&conn, &task_a.id).unwrap();
        assert_eq!(dependents.len(), 2);
        let dep_ids: Vec<&str> = dependents.iter().map(|(t, _)| t.id.as_str()).collect();
        assert!(dep_ids.contains(&task_b.id.as_str()));
        assert!(dep_ids.contains(&task_c.id.as_str()));
    }

    #[test]
    fn test_find_dependents_empty_when_no_deps() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Backlog", 0).unwrap();
        let task_a = db::insert_task(&conn, &ws.id, &col.id, "A", None).unwrap();
        let _task_b = db::insert_task(&conn, &ws.id, &col.id, "B", None).unwrap();

        let dependents = find_dependents(&conn, &task_a.id).unwrap();
        assert!(dependents.is_empty());
    }

    #[test]
    fn test_check_condition_completed_in_last_column() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let _col1 = db::insert_column(&conn, &ws.id, "Working", 0).unwrap();
        let col2 = db::insert_column(&conn, &ws.id, "Done", 1).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col2.id, "Task", None).unwrap();

        let dep = TaskDependency {
            task_id: task.id.clone(),
            condition: "completed".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        };

        // Task is in last column (Done, position 1) — completed
        assert!(check_condition(&dep, &task, &conn).unwrap());
    }

    #[test]
    fn test_check_condition_completed_not_in_last_column() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col1 = db::insert_column(&conn, &ws.id, "Working", 0).unwrap();
        let _col2 = db::insert_column(&conn, &ws.id, "Done", 1).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col1.id, "Task", None).unwrap();

        let dep = TaskDependency {
            task_id: task.id.clone(),
            condition: "completed".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        };

        // Task is in first column (Working, position 0) — not completed
        assert!(!check_condition(&dep, &task, &conn).unwrap());
    }

    #[test]
    fn test_check_condition_moved_to_column() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col1 = db::insert_column(&conn, &ws.id, "Working", 0).unwrap();
        let col2 = db::insert_column(&conn, &ws.id, "Review", 1).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col2.id, "Task", None).unwrap();

        // Condition: moved_to_column targeting col2 — task IS in col2
        let dep_met = TaskDependency {
            task_id: task.id.clone(),
            condition: "moved_to_column".to_string(),
            target_column: Some(col2.id.clone()),
            on_met: TriggerActionV2::None,
        };
        assert!(check_condition(&dep_met, &task, &conn).unwrap());

        // Condition: moved_to_column targeting col1 — task is NOT in col1
        let dep_not_met = TaskDependency {
            task_id: task.id.clone(),
            condition: "moved_to_column".to_string(),
            target_column: Some(col1.id.clone()),
            on_met: TriggerActionV2::None,
        };
        assert!(!check_condition(&dep_not_met, &task, &conn).unwrap());
    }

    #[test]
    fn test_check_condition_moved_to_column_no_target() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Working", 0).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col.id, "Task", None).unwrap();

        // moved_to_column with no target_column — always false
        let dep = TaskDependency {
            task_id: task.id.clone(),
            condition: "moved_to_column".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        };
        assert!(!check_condition(&dep, &task, &conn).unwrap());
    }

    #[test]
    fn test_check_condition_agent_complete_via_status() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Working", 0).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col.id, "Task", None).unwrap();

        let dep = TaskDependency {
            task_id: task.id.clone(),
            condition: "agent_complete".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        };

        // No agent session, no agent_status — not complete
        assert!(!check_condition(&dep, &task, &conn).unwrap());

        // Set agent_status to completed
        db::update_task_agent_status(&conn, &task.id, Some("completed"), None).unwrap();
        let task = db::get_task(&conn, &task.id).unwrap();
        assert!(check_condition(&dep, &task, &conn).unwrap());
    }

    #[test]
    fn test_check_condition_agent_complete_via_session() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Working", 0).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col.id, "Task", None).unwrap();

        // Create an agent session and link to task
        let session = db::insert_agent_session(&conn, &task.id, "claude", None).unwrap();
        db::update_task_agent_session(&conn, &task.id, Some(&session.id)).unwrap();
        let task = db::get_task(&conn, &task.id).unwrap();

        let dep = TaskDependency {
            task_id: task.id.clone(),
            condition: "agent_complete".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        };

        // Session is idle — not complete
        assert!(!check_condition(&dep, &task, &conn).unwrap());

        // Set session status to completed
        db::update_agent_session(
            &conn,
            &session.id,
            None,
            Some("completed"),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert!(check_condition(&dep, &task, &conn).unwrap());
    }

    #[test]
    fn test_check_condition_unknown_type_returns_false() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Working", 0).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col.id, "Task", None).unwrap();

        let dep = TaskDependency {
            task_id: task.id.clone(),
            condition: "unknown_condition".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        };
        assert!(!check_condition(&dep, &task, &conn).unwrap());
    }

    fn set_deps(conn: &Connection, task_id: &str, deps: &[TaskDependency]) {
        let json = serde_json::to_string(deps).unwrap();
        conn.execute(
            "UPDATE tasks SET dependencies = ?1 WHERE id = ?2",
            rusqlite::params![json, task_id],
        )
        .unwrap();
    }

    #[test]
    fn test_predecessor_branch_no_batch_id() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Setup", 0).unwrap();
        let pred = db::insert_task(&conn, &ws.id, &col.id, "Pred", None).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col.id, "Task", None).unwrap();

        db::update_task_branch(&conn, &pred.id, Some("bentoya/pred")).unwrap();
        db::update_task_batch_id(&conn, &pred.id, Some("batch-1")).unwrap();
        // task has dep on pred but no batch_id of its own
        set_deps(
            &conn,
            &task.id,
            &[TaskDependency {
                task_id: pred.id.clone(),
                condition: "in_review".to_string(),
                target_column: None,
                on_met: TriggerActionV2::None,
            }],
        );

        let task = db::get_task(&conn, &task.id).unwrap();
        assert_eq!(predecessor_branch_for_chain(&conn, &task).unwrap(), None);
    }

    #[test]
    fn test_predecessor_branch_no_dependencies() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Setup", 0).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col.id, "Task", None).unwrap();
        db::update_task_batch_id(&conn, &task.id, Some("batch-1")).unwrap();

        let task = db::get_task(&conn, &task.id).unwrap();
        assert_eq!(predecessor_branch_for_chain(&conn, &task).unwrap(), None);
    }

    #[test]
    fn test_predecessor_branch_different_batch() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Setup", 0).unwrap();
        let pred = db::insert_task(&conn, &ws.id, &col.id, "Pred", None).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col.id, "Task", None).unwrap();

        db::update_task_branch(&conn, &pred.id, Some("bentoya/pred")).unwrap();
        db::update_task_batch_id(&conn, &pred.id, Some("batch-A")).unwrap();
        db::update_task_batch_id(&conn, &task.id, Some("batch-B")).unwrap();
        set_deps(
            &conn,
            &task.id,
            &[TaskDependency {
                task_id: pred.id.clone(),
                condition: "in_review".to_string(),
                target_column: None,
                on_met: TriggerActionV2::None,
            }],
        );

        let task = db::get_task(&conn, &task.id).unwrap();
        assert_eq!(predecessor_branch_for_chain(&conn, &task).unwrap(), None);
    }

    #[test]
    fn test_predecessor_branch_no_branch_yet() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Setup", 0).unwrap();
        let pred = db::insert_task(&conn, &ws.id, &col.id, "Pred", None).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col.id, "Task", None).unwrap();

        db::update_task_batch_id(&conn, &pred.id, Some("batch-1")).unwrap();
        db::update_task_batch_id(&conn, &task.id, Some("batch-1")).unwrap();
        set_deps(
            &conn,
            &task.id,
            &[TaskDependency {
                task_id: pred.id.clone(),
                condition: "in_review".to_string(),
                target_column: None,
                on_met: TriggerActionV2::None,
            }],
        );

        let task = db::get_task(&conn, &task.id).unwrap();
        assert_eq!(predecessor_branch_for_chain(&conn, &task).unwrap(), None);
    }

    #[test]
    fn test_predecessor_branch_same_batch_returns_branch() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Setup", 0).unwrap();
        let pred = db::insert_task(&conn, &ws.id, &col.id, "Pred", None).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col.id, "Task", None).unwrap();

        db::update_task_branch(&conn, &pred.id, Some("bentoya/pred")).unwrap();
        db::update_task_batch_id(&conn, &pred.id, Some("batch-1")).unwrap();
        db::update_task_batch_id(&conn, &task.id, Some("batch-1")).unwrap();
        set_deps(
            &conn,
            &task.id,
            &[TaskDependency {
                task_id: pred.id.clone(),
                condition: "in_review".to_string(),
                target_column: None,
                on_met: TriggerActionV2::None,
            }],
        );

        let task = db::get_task(&conn, &task.id).unwrap();
        assert_eq!(
            predecessor_branch_for_chain(&conn, &task).unwrap(),
            Some("bentoya/pred".to_string())
        );
    }

    #[test]
    fn test_predecessor_branch_prefers_furthest_along() {
        // Chain: A, B → C, all in batch-1. C depends on both A and B.
        // C should branch off A (further along the pipeline) not B.
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col_setup = db::insert_column(&conn, &ws.id, "Setup", 0).unwrap();
        let col_implement = db::insert_column(&conn, &ws.id, "Implement", 1).unwrap();
        let col_review = db::insert_column(&conn, &ws.id, "Review", 2).unwrap();

        // A is in Review (furthest along among predecessors)
        let task_a = db::insert_task(&conn, &ws.id, &col_review.id, "A", None).unwrap();
        // B is in Implement (less progress than A)
        let task_b = db::insert_task(&conn, &ws.id, &col_implement.id, "B", None).unwrap();
        // C is the new task being set up
        let task_c = db::insert_task(&conn, &ws.id, &col_setup.id, "C", None).unwrap();

        db::update_task_branch(&conn, &task_a.id, Some("bentoya/a")).unwrap();
        db::update_task_branch(&conn, &task_b.id, Some("bentoya/b")).unwrap();
        db::update_task_batch_id(&conn, &task_a.id, Some("batch-1")).unwrap();
        db::update_task_batch_id(&conn, &task_b.id, Some("batch-1")).unwrap();
        db::update_task_batch_id(&conn, &task_c.id, Some("batch-1")).unwrap();

        set_deps(
            &conn,
            &task_c.id,
            &[
                TaskDependency {
                    task_id: task_a.id.clone(),
                    condition: "in_review".to_string(),
                    target_column: None,
                    on_met: TriggerActionV2::None,
                },
                TaskDependency {
                    task_id: task_b.id.clone(),
                    condition: "in_review".to_string(),
                    target_column: None,
                    on_met: TriggerActionV2::None,
                },
            ],
        );

        let task_c = db::get_task(&conn, &task_c.id).unwrap();
        assert_eq!(
            predecessor_branch_for_chain(&conn, &task_c).unwrap(),
            Some("bentoya/a".to_string())
        );
    }

    #[test]
    fn test_predecessor_branch_skips_same_batch_pred_without_branch() {
        // A (batch-1, no branch yet) and B (batch-1, has branch). C depends on both.
        // C should pick B's branch even though A is later in pipeline but unbranched.
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col_setup = db::insert_column(&conn, &ws.id, "Setup", 0).unwrap();
        let col_review = db::insert_column(&conn, &ws.id, "Review", 2).unwrap();

        let task_a = db::insert_task(&conn, &ws.id, &col_review.id, "A", None).unwrap();
        let task_b = db::insert_task(&conn, &ws.id, &col_setup.id, "B", None).unwrap();
        let task_c = db::insert_task(&conn, &ws.id, &col_setup.id, "C", None).unwrap();

        db::update_task_branch(&conn, &task_b.id, Some("bentoya/b")).unwrap();
        db::update_task_batch_id(&conn, &task_a.id, Some("batch-1")).unwrap();
        db::update_task_batch_id(&conn, &task_b.id, Some("batch-1")).unwrap();
        db::update_task_batch_id(&conn, &task_c.id, Some("batch-1")).unwrap();

        set_deps(
            &conn,
            &task_c.id,
            &[
                TaskDependency {
                    task_id: task_a.id.clone(),
                    condition: "in_review".to_string(),
                    target_column: None,
                    on_met: TriggerActionV2::None,
                },
                TaskDependency {
                    task_id: task_b.id.clone(),
                    condition: "in_review".to_string(),
                    target_column: None,
                    on_met: TriggerActionV2::None,
                },
            ],
        );

        let task_c = db::get_task(&conn, &task_c.id).unwrap();
        assert_eq!(
            predecessor_branch_for_chain(&conn, &task_c).unwrap(),
            Some("bentoya/b".to_string())
        );
    }

    #[test]
    fn test_update_blocked() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Backlog", 0).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col.id, "Task", None).unwrap();
        assert!(!task.blocked);

        // Block
        update_blocked(&conn, &task.id, true).unwrap();
        let task = db::get_task(&conn, &task.id).unwrap();
        assert!(task.blocked);

        // Unblock
        update_blocked(&conn, &task.id, false).unwrap();
        let task = db::get_task(&conn, &task.id).unwrap();
        assert!(!task.blocked);
    }
}
