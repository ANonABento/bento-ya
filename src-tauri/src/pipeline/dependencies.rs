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
use super::{
    emit_pipeline, emit_tasks_changed, fire_trigger, PipelineState, EVT_DEP_CLEARED, EVT_DEP_MOVED,
    EVT_UNBLOCKED,
};

fn default_on_met() -> TriggerActionV2 {
    TriggerActionV2::None
}

/// A dependency from one task to another.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDependency {
    pub task_id: String,
    pub condition: String, // "completed", "moved_to_column", "at_or_past_column", "in_review", "agent_complete"
    #[serde(default)]
    pub target_column: Option<String>,
    #[serde(default = "default_on_met")]
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

/// Return the best predecessor branch for a task in a dependency chain.
///
/// If a task has dependencies on other tasks in the same `batch_id`, setup
/// should base the task branch on the most-progressed predecessor branch
/// rather than the workspace default base branch. That keeps serial task
/// chains from all branching off the same old `main` SHA and producing
/// avoidable cascade conflicts.
pub fn predecessor_branch_for_chain(
    conn: &Connection,
    task: &Task,
) -> Result<Option<String>, AppError> {
    let Some(batch_id) = task
        .batch_id
        .as_deref()
        .map(str::trim)
        .filter(|batch_id| !batch_id.is_empty())
    else {
        return Ok(None);
    };

    let Some(deps_json) = task
        .dependencies
        .as_deref()
        .map(str::trim)
        .filter(|deps| !deps.is_empty() && *deps != "[]")
    else {
        return Ok(None);
    };

    let deps = match serde_json::from_str::<Vec<TaskDependency>>(deps_json) {
        Ok(deps) => deps,
        Err(_) => return Ok(None),
    };

    let mut best: Option<(i64, String)> = None;
    for dep in deps {
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
            .filter(|branch| !branch.is_empty())
        else {
            continue;
        };

        let position = db::get_column(conn, &predecessor.column_id)
            .map(|column| column.position)
            .unwrap_or(-1);

        match &best {
            Some((best_position, _)) if *best_position >= position => {}
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
            // Strict semantics: source must be in the terminal Done column AND have a
            // completed agent run. Falls back to "terminal column is enough" when no
            // agent ever attached (manual completion path), so dragging a checklist
            // task to Done still satisfies dependents.
            let col = db::get_column(conn, &source_task.column_id)?;
            let in_terminal =
                db::get_next_column(conn, &source_task.workspace_id, col.position)?.is_none();
            if !in_terminal {
                return Ok(false);
            }

            // Has an agent session — defer to its status
            if let Some(ref session_id) = source_task.agent_session_id {
                return match db::get_agent_session(conn, session_id) {
                    Ok(session) => Ok(session.status == "completed"),
                    Err(_) => Ok(false),
                };
            }

            // No session, but agent_status is set — must be "completed".
            // The schema defaults new/manual tasks to "idle", which still
            // represents "no agent in the picture" for dependency purposes.
            if let Some(status) = source_task.agent_status.as_deref() {
                if status == "idle" {
                    return Ok(true);
                }
                return Ok(status == "completed");
            }

            // Manual task that never ran an agent — terminal column is sufficient
            Ok(true)
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
        let mut moved_by_on_met = false;

        for dep in &deps {
            if dep.task_id == source_task.id {
                // Check this specific dependency
                let met = check_condition(dep, source_task, conn)?;
                if met {
                    // Execute the on_met action
                    if matches!(dep.on_met, TriggerActionV2::MoveColumn { .. }) {
                        moved_by_on_met = true;
                    }
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

            emit_pipeline(
                app,
                EVT_DEP_CLEARED,
                &dependent_task.id,
                &dependent_task.column_id,
                PipelineState::Idle,
                Some(format!("Cleared by {}", source_task.title)),
            );

            emit_tasks_changed(app, &dependent_task.workspace_id, "dependency_cleared");

            if !moved_by_on_met {
                let _ = auto_promote_if_eligible(conn, app, &dependent_task);
            }
        }
    }

    Ok(())
}

/// Re-evaluate every blocked task in the system and clear `blocked` for any whose
/// dependencies are all satisfied. Safety net for the case where the live call sites
/// (auto-advance / manual move / agent-complete) missed firing `check_dependents`.
///
/// Returns the number of tasks unblocked.
pub fn recheck_blocked_tasks(conn: &Connection, app: &AppHandle) -> Result<i64, AppError> {
    let task_ids: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM tasks WHERE blocked = 1 AND archived_at IS NULL")
            .map_err(AppError::from)?;
        let ids: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(AppError::from)?
            .filter_map(|r| r.ok())
            .collect();
        ids
    };

    let mut cleared = 0i64;
    let mut workspaces_to_notify = std::collections::HashSet::new();

    for task_id in task_ids {
        let task = match db::get_task(conn, &task_id) {
            Ok(t) => t,
            Err(_) => continue,
        };

        let Some(ref deps_json) = task.dependencies else {
            continue;
        };

        let deps: Vec<TaskDependency> = match serde_json::from_str(deps_json) {
            Ok(d) => d,
            Err(e) => {
                log::warn!(
                    "[deps-hygiene] Failed to parse dependencies for task {}: {}",
                    task_id,
                    e
                );
                continue;
            }
        };

        if deps.is_empty() {
            continue;
        }

        let mut all_met = true;
        for dep in &deps {
            let source = match db::get_task(conn, &dep.task_id) {
                Ok(s) => s,
                Err(_) => {
                    all_met = false;
                    break;
                }
            };
            if !check_condition(dep, &source, conn).unwrap_or(false) {
                all_met = false;
                break;
            }
        }

        if all_met {
            update_blocked(conn, &task.id, false)?;
            cleared += 1;
            workspaces_to_notify.insert(task.workspace_id.clone());
            emit_pipeline(
                app,
                EVT_DEP_CLEARED,
                &task.id,
                &task.column_id,
                PipelineState::Idle,
                Some("Cleared by hygiene recheck".to_string()),
            );
            let _ = auto_promote_if_eligible(conn, app, &task);
        }
    }

    for workspace_id in workspaces_to_notify {
        emit_tasks_changed(app, &workspace_id, "dependency_recheck");
    }

    Ok(cleared)
}

/// Auto-promote an unblocked task out of Icebox/Backlog into Setup if the workspace
/// has `dependencies.autoPromote` enabled (default true). Skips if the task is held
/// by the user, already past Icebox/Backlog, or no Setup-style column exists.
fn auto_promote_if_eligible(
    conn: &Connection,
    app: &AppHandle,
    task: &Task,
) -> Result<(), AppError> {
    if task.held_by_user {
        log::info!("[deps] auto-promote skipped for {}: held_by_user", task.id);
        return Ok(());
    }

    let workspace = db::get_workspace(conn, &task.workspace_id)?;
    let auto_promote = serde_json::from_str::<serde_json::Value>(&workspace.config)
        .ok()
        .and_then(|v| {
            v.get("dependencies")
                .and_then(|d| d.get("autoPromote"))
                .cloned()
        })
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    if !auto_promote {
        return Ok(());
    }

    let current_col = db::get_column(conn, &task.column_id)?;
    let current_name = current_col.name.to_lowercase();
    let is_inert = matches!(current_name.as_str(), "icebox" | "backlog");
    if !is_inert {
        return Ok(());
    }

    let cols = db::list_columns(conn, &task.workspace_id)?;
    let target = cols
        .iter()
        .find(|c| c.name.eq_ignore_ascii_case("setup"))
        .or_else(|| {
            cols.iter().find(|c| {
                let n = c.name.to_lowercase();
                n != "icebox" && n != "backlog"
            })
        })
        .cloned();

    let Some(target_col) = target else {
        log::warn!(
            "[deps] auto-promote: no eligible target column in workspace {}",
            task.workspace_id
        );
        return Ok(());
    };

    if target_col.id == current_col.id {
        return Ok(());
    }

    let ts = db::now();
    let max_pos: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) FROM tasks WHERE column_id = ?1",
            rusqlite::params![target_col.id],
            |row| row.get(0),
        )
        .unwrap_or(-1);
    conn.execute(
        "UPDATE tasks SET column_id = ?1, position = ?2, pipeline_state = 'idle', pipeline_triggered_at = NULL, updated_at = ?3 WHERE id = ?4",
        rusqlite::params![target_col.id, max_pos + 1, ts, task.id],
    )
    .map_err(AppError::from)?;

    emit_pipeline(
        app,
        EVT_DEP_MOVED,
        &task.id,
        &target_col.id,
        PipelineState::Idle,
        Some(format!(
            "Auto-promoted to {} after dependency cleared",
            target_col.name
        )),
    );
    emit_tasks_changed(app, &task.workspace_id, "dependency_auto_promoted");

    let promoted = db::get_task(conn, &task.id)?;
    let _ = fire_trigger(conn, app, &promoted, &target_col);

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
                emit_tasks_changed(app, &dependent_task.workspace_id, "dependency_moved");

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

/// The single validated path for replacing a task's full dependency list.
/// Every surface (Tauri command, HTTP API, MCP add/remove) funnels through here
/// so cycle/self-loop/existence validation, the derived `blocked` flag, and the
/// `tasks:changed` event are identical everywhere — closing the MCP gap where
/// dependencies were written directly with no validation and no UI refresh.
pub fn set_task_dependencies(
    conn: &Connection,
    app: &AppHandle,
    task_id: &str,
    deps: &[TaskDependency],
) -> Result<Task, AppError> {
    validate_dependencies(conn, task_id, deps)?;

    let deps_json = serde_json::to_string(deps)
        .map_err(|e| AppError::InvalidInput(format!("Invalid dependencies: {}", e)))?;
    let blocked = !deps.is_empty();
    let ts = db::now();
    conn.execute(
        "UPDATE tasks SET dependencies = ?1, blocked = ?2, updated_at = ?3 WHERE id = ?4",
        rusqlite::params![deps_json, blocked as i64, ts, task_id],
    )
    .map_err(AppError::from)?;

    let task = db::get_task(conn, task_id)?;
    emit_tasks_changed(app, &task.workspace_id, "dependencies_changed");
    Ok(task)
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

    fn set_deps(conn: &Connection, task_id: &str, deps: &[TaskDependency]) {
        let json = serde_json::to_string(deps).unwrap();
        conn.execute(
            "UPDATE tasks SET dependencies = ?1 WHERE id = ?2",
            rusqlite::params![json, task_id],
        )
        .unwrap();
    }

    fn dep_on(task_id: &str) -> TaskDependency {
        TaskDependency {
            task_id: task_id.to_string(),
            condition: "in_review".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        }
    }

    #[test]
    fn test_predecessor_branch_for_chain_requires_batch_id() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Setup", 0).unwrap();
        let pred = db::insert_task(&conn, &ws.id, &col.id, "Pred", None).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col.id, "Task", None).unwrap();

        db::update_task_branch(&conn, &pred.id, Some("kaitencode/pred")).unwrap();
        db::update_task_batch_id(&conn, &pred.id, Some("batch-1")).unwrap();
        set_deps(&conn, &task.id, &[dep_on(&pred.id)]);

        let task = db::get_task(&conn, &task.id).unwrap();
        assert_eq!(predecessor_branch_for_chain(&conn, &task).unwrap(), None);
    }

    #[test]
    fn test_predecessor_branch_for_chain_ignores_other_batches() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Setup", 0).unwrap();
        let pred = db::insert_task(&conn, &ws.id, &col.id, "Pred", None).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col.id, "Task", None).unwrap();

        db::update_task_branch(&conn, &pred.id, Some("kaitencode/pred")).unwrap();
        db::update_task_batch_id(&conn, &pred.id, Some("batch-A")).unwrap();
        db::update_task_batch_id(&conn, &task.id, Some("batch-B")).unwrap();
        set_deps(&conn, &task.id, &[dep_on(&pred.id)]);

        let task = db::get_task(&conn, &task.id).unwrap();
        assert_eq!(predecessor_branch_for_chain(&conn, &task).unwrap(), None);
    }

    #[test]
    fn test_predecessor_branch_for_chain_returns_same_batch_branch() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Setup", 0).unwrap();
        let pred = db::insert_task(&conn, &ws.id, &col.id, "Pred", None).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col.id, "Task", None).unwrap();

        db::update_task_branch(&conn, &pred.id, Some("kaitencode/pred")).unwrap();
        db::update_task_batch_id(&conn, &pred.id, Some("batch-1")).unwrap();
        db::update_task_batch_id(&conn, &task.id, Some("batch-1")).unwrap();
        set_deps(&conn, &task.id, &[dep_on(&pred.id)]);

        let task = db::get_task(&conn, &task.id).unwrap();
        assert_eq!(
            predecessor_branch_for_chain(&conn, &task).unwrap(),
            Some("kaitencode/pred".to_string())
        );
    }

    #[test]
    fn test_predecessor_branch_for_chain_prefers_furthest_column() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let setup = db::insert_column(&conn, &ws.id, "Setup", 0).unwrap();
        let implement = db::insert_column(&conn, &ws.id, "Implement", 1).unwrap();
        let review = db::insert_column(&conn, &ws.id, "Review", 2).unwrap();

        let early = db::insert_task(&conn, &ws.id, &implement.id, "Early", None).unwrap();
        let later = db::insert_task(&conn, &ws.id, &review.id, "Later", None).unwrap();
        let task = db::insert_task(&conn, &ws.id, &setup.id, "Task", None).unwrap();

        db::update_task_branch(&conn, &early.id, Some("kaitencode/early")).unwrap();
        db::update_task_branch(&conn, &later.id, Some("kaitencode/later")).unwrap();
        for id in [&early.id, &later.id, &task.id] {
            db::update_task_batch_id(&conn, id, Some("batch-1")).unwrap();
        }
        set_deps(&conn, &task.id, &[dep_on(&early.id), dep_on(&later.id)]);

        let task = db::get_task(&conn, &task.id).unwrap();
        assert_eq!(
            predecessor_branch_for_chain(&conn, &task).unwrap(),
            Some("kaitencode/later".to_string())
        );
    }

    #[test]
    fn test_predecessor_branch_for_chain_skips_unbranched_predecessors() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let setup = db::insert_column(&conn, &ws.id, "Setup", 0).unwrap();
        let review = db::insert_column(&conn, &ws.id, "Review", 2).unwrap();

        let unbranched = db::insert_task(&conn, &ws.id, &review.id, "Unbranched", None).unwrap();
        let branched = db::insert_task(&conn, &ws.id, &setup.id, "Branched", None).unwrap();
        let task = db::insert_task(&conn, &ws.id, &setup.id, "Task", None).unwrap();

        db::update_task_branch(&conn, &branched.id, Some("kaitencode/branched")).unwrap();
        for id in [&unbranched.id, &branched.id, &task.id] {
            db::update_task_batch_id(&conn, id, Some("batch-1")).unwrap();
        }
        set_deps(
            &conn,
            &task.id,
            &[dep_on(&unbranched.id), dep_on(&branched.id)],
        );

        let task = db::get_task(&conn, &task.id).unwrap();
        assert_eq!(
            predecessor_branch_for_chain(&conn, &task).unwrap(),
            Some("kaitencode/branched".to_string())
        );
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

    /// Bug A regression: deps written by the MCP server omit `on_met`. Before the
    /// `#[serde(default)]` fix, `serde_json::from_str::<Vec<TaskDependency>>` would
    /// fail and the entire dependency set was silently dropped by `find_dependents`,
    /// preventing `check_dependents` from ever seeing them.
    #[test]
    fn test_dep_deserializes_without_on_met() {
        let mcp_shape = r#"[{"task_id":"abc","condition":"completed"}]"#;
        let deps: Vec<TaskDependency> = serde_json::from_str(mcp_shape)
            .expect("MCP-shaped dep without on_met must deserialize");
        assert_eq!(deps.len(), 1);
        assert_eq!(deps[0].task_id, "abc");
        assert_eq!(deps[0].condition, "completed");
        assert!(matches!(deps[0].on_met, TriggerActionV2::None));
    }

    /// Bug A regression: a single MCP-shaped dep mixed with frontend-shaped deps
    /// must not poison the whole task. Before the fix, find_dependents wouldn't
    /// return this task at all because the parse failed.
    #[test]
    fn test_find_dependents_returns_mcp_shaped_deps() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let col = db::insert_column(&conn, &ws.id, "Backlog", 0).unwrap();
        let task_a = db::insert_task(&conn, &ws.id, &col.id, "A", None).unwrap();
        let task_b = db::insert_task(&conn, &ws.id, &col.id, "B", None).unwrap();

        // MCP-shaped dep: no on_met field, no target_column.
        let mcp_deps = format!(r#"[{{"task_id":"{}","condition":"completed"}}]"#, task_a.id);
        conn.execute(
            "UPDATE tasks SET dependencies = ?1, blocked = 1 WHERE id = ?2",
            rusqlite::params![mcp_deps, task_b.id],
        )
        .unwrap();

        let dependents = find_dependents(&conn, &task_a.id).unwrap();
        assert_eq!(dependents.len(), 1);
        assert_eq!(dependents[0].0.id, task_b.id);
        assert_eq!(dependents[0].1.len(), 1);
        assert_eq!(dependents[0].1[0].condition, "completed");
        assert!(matches!(dependents[0].1[0].on_met, TriggerActionV2::None));
    }

    /// Bug E: `completed` should require both terminal column AND a completed agent
    /// run. A task in Done with `agent_status='running'` does not satisfy the dep.
    #[test]
    fn test_check_condition_completed_strict_when_agent_running() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let _col1 = db::insert_column(&conn, &ws.id, "Working", 0).unwrap();
        let col2 = db::insert_column(&conn, &ws.id, "Done", 1).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col2.id, "Task", None).unwrap();
        db::update_task_agent_status(&conn, &task.id, Some("running"), None).unwrap();
        let task = db::get_task(&conn, &task.id).unwrap();

        let dep = TaskDependency {
            task_id: task.id.clone(),
            condition: "completed".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        };
        assert!(!check_condition(&dep, &task, &conn).unwrap());

        // Once agent_status flips to completed, the dep is satisfied.
        db::update_task_agent_status(&conn, &task.id, Some("completed"), None).unwrap();
        let task = db::get_task(&conn, &task.id).unwrap();
        assert!(check_condition(&dep, &task, &conn).unwrap());
    }

    /// Bug E fallback: a manually-completed task (no agent ever attached) in the
    /// terminal column still satisfies the `completed` condition. We must not
    /// require agent_status when there's no agent in the picture.
    #[test]
    fn test_check_condition_completed_manual_no_agent() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let _col1 = db::insert_column(&conn, &ws.id, "Working", 0).unwrap();
        let col2 = db::insert_column(&conn, &ws.id, "Done", 1).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col2.id, "Task", None).unwrap();
        // No agent_session_id; the schema defaults agent_status to idle.
        assert!(task.agent_session_id.is_none());
        assert_eq!(task.agent_status.as_deref(), Some("idle"));

        let dep = TaskDependency {
            task_id: task.id.clone(),
            condition: "completed".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        };
        assert!(check_condition(&dep, &task, &conn).unwrap());
    }

    /// Bug E: terminal column with a session whose status is not "completed"
    /// must not satisfy the dep. The session is the source of truth when set.
    #[test]
    fn test_check_condition_completed_with_failed_session() {
        let conn = setup_test_db();
        let ws = db::insert_workspace(&conn, "Test", "/tmp").unwrap();
        let _col1 = db::insert_column(&conn, &ws.id, "Working", 0).unwrap();
        let col2 = db::insert_column(&conn, &ws.id, "Done", 1).unwrap();
        let task = db::insert_task(&conn, &ws.id, &col2.id, "Task", None).unwrap();
        let session = db::insert_agent_session(&conn, &task.id, "claude", None).unwrap();
        db::update_task_agent_session(&conn, &task.id, Some(&session.id)).unwrap();
        db::update_agent_session(
            &conn,
            &session.id,
            None,
            Some("failed"),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let task = db::get_task(&conn, &task.id).unwrap();

        let dep = TaskDependency {
            task_id: task.id.clone(),
            condition: "completed".to_string(),
            target_column: None,
            on_met: TriggerActionV2::None,
        };
        assert!(!check_condition(&dep, &task, &conn).unwrap());
    }
}
