//! Template variable interpolation for trigger prompts.
//!
//! Replaces `{task.title}`, `{column.name}`, `{workspace.path}`, etc.
//! in prompt_template strings with actual values.

use crate::db::{Column, Task, Workspace};
use std::collections::HashMap;

/// Context passed to the template interpolator.
pub struct TemplateContext<'a> {
    pub task: &'a Task,
    pub column: &'a Column,
    pub workspace: &'a Workspace,
    pub prev_column: Option<&'a Column>,
    pub next_column: Option<&'a Column>,
    /// Dependency tasks keyed by task ID
    pub dep_tasks: HashMap<String, &'a Task>,
}

/// Interpolate template variables in a string.
///
/// Supported variables:
/// - `{task.id}`, `{task.title}`, `{task.description}`, `{task.trigger_prompt}`
/// - `{task.last_output}`, `{task.pr_number}`, `{task.pr_url}`
/// - `{column.name}`, `{prev_column.name}`, `{next_column.name}`
/// - `{workspace.path}`
/// - `{dep.<task_id>.title}`, `{dep.<task_id>.last_output}`
pub fn interpolate(template: &str, ctx: &TemplateContext) -> String {
    let mut result = template.to_string();

    // Task variables
    result = result.replace("{task.id}", &ctx.task.id);
    result = result.replace("{task.title}", &ctx.task.title);
    result = result.replace(
        "{task.description}",
        ctx.task.description.as_deref().unwrap_or(""),
    );
    result = result.replace(
        "{task.trigger_prompt}",
        ctx.task.trigger_prompt.as_deref().unwrap_or(""),
    );
    result = result.replace(
        "{task.last_output}",
        ctx.task.last_output.as_deref().unwrap_or(""),
    );
    result = result.replace(
        "{task.pr_number}",
        &ctx.task.pr_number.map(|n| n.to_string()).unwrap_or_default(),
    );
    result = result.replace(
        "{task.pr_url}",
        ctx.task.pr_url.as_deref().unwrap_or(""),
    );
    result = result.replace(
        "{task.worktree_path}",
        ctx.task.worktree_path.as_deref().unwrap_or(""),
    );

    // Column variables
    result = result.replace("{column.name}", &ctx.column.name);
    result = result.replace(
        "{prev_column.name}",
        ctx.prev_column.map(|c| c.name.as_str()).unwrap_or(""),
    );
    result = result.replace(
        "{next_column.name}",
        ctx.next_column.map(|c| c.name.as_str()).unwrap_or(""),
    );

    // Workspace variables
    result = result.replace("{workspace.path}", &ctx.workspace.repo_path);

    // Dependency variables: {dep.<task_id>.title}, {dep.<task_id>.last_output}
    for (dep_id, dep_task) in &ctx.dep_tasks {
        let title_key = format!("{{dep.{}.title}}", dep_id);
        let output_key = format!("{{dep.{}.last_output}}", dep_id);
        let desc_key = format!("{{dep.{}.description}}", dep_id);

        result = result.replace(&title_key, &dep_task.title);
        result = result.replace(
            &output_key,
            dep_task.last_output.as_deref().unwrap_or(""),
        );
        result = result.replace(
            &desc_key,
            dep_task.description.as_deref().unwrap_or(""),
        );
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_task() -> Task {
        Task {
            id: "task-123".to_string(),
            workspace_id: "ws-1".to_string(),
            column_id: "col-1".to_string(),
            title: "Build auth API".to_string(),
            description: Some("JWT auth implementation".to_string()),
            position: 0,
            priority: "medium".to_string(),
            agent_mode: None,
            agent_status: None,
            queued_at: None,
            branch_name: None,
            files_touched: "[]".to_string(),
            checklist: None,
            pipeline_state: "idle".to_string(),
            pipeline_triggered_at: None,
            pipeline_error: None,
            retry_count: 0,
            model: None,
            agent_session_id: None,
            last_script_exit_code: None,
            review_status: None,
            pr_number: Some(42),
            pr_url: Some("https://github.com/test/repo/pull/42".to_string()),
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
            pr_last_fetched: None,
            pr_head_sha: None,
            notify_stakeholders: None,
            notification_sent_at: None,
            trigger_overrides: None,
            trigger_prompt: Some("Use refresh tokens".to_string()),
            last_output: Some("API endpoints: /login, /refresh".to_string()),
            dependencies: None,
            blocked: false,
            worktree_path: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    fn mock_column(name: &str) -> Column {
        Column {
            id: "col-1".to_string(),
            workspace_id: "ws-1".to_string(),
            name: name.to_string(),
            icon: "code".to_string(),
            position: 0,
            color: None,
            visible: true,
            triggers: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    fn mock_workspace() -> Workspace {
        Workspace {
            id: "ws-1".to_string(),
            name: "Test Workspace".to_string(),
            repo_path: "/home/user/project".to_string(),
            tab_order: 0,
            is_active: true,
            active_task_count: 0,
            config: "{}".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            discord_guild_id: None,
            discord_category_id: None,
            discord_chef_channel_id: None,
            discord_notifications_channel_id: None,
            discord_enabled: None,
        }
    }

    #[test]
    fn test_basic_interpolation() {
        let task = mock_task();
        let col = mock_column("In Progress");
        let ws = mock_workspace();
        let ctx = TemplateContext {
            task: &task,
            column: &col,
            workspace: &ws,
            prev_column: None,
            next_column: None,
            dep_tasks: HashMap::new(),
        };

        let result = interpolate("{task.title}\n\n{task.description}\n\n{task.trigger_prompt}", &ctx);
        assert_eq!(result, "Build auth API\n\nJWT auth implementation\n\nUse refresh tokens");
    }

    #[test]
    fn test_column_and_workspace() {
        let task = mock_task();
        let col = mock_column("Working");
        let ws = mock_workspace();
        let prev = mock_column("Backlog");
        let ctx = TemplateContext {
            task: &task,
            column: &col,
            workspace: &ws,
            prev_column: Some(&prev),
            next_column: None,
            dep_tasks: HashMap::new(),
        };

        let result = interpolate("Column: {column.name}, from: {prev_column.name}, path: {workspace.path}", &ctx);
        assert_eq!(result, "Column: Working, from: Backlog, path: /home/user/project");
    }

    #[test]
    fn test_dependency_interpolation() {
        let task = mock_task();
        let col = mock_column("Ready");
        let ws = mock_workspace();
        let dep_task = mock_task();

        let mut dep_tasks = HashMap::new();
        dep_tasks.insert("task-123".to_string(), &dep_task);

        let ctx = TemplateContext {
            task: &task,
            column: &col,
            workspace: &ws,
            prev_column: None,
            next_column: None,
            dep_tasks,
        };

        let result = interpolate("From {dep.task-123.title}: {dep.task-123.last_output}", &ctx);
        assert_eq!(result, "From Build auth API: API endpoints: /login, /refresh");
    }
}
