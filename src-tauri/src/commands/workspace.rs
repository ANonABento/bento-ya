use crate::config::DEFAULT_BASE_BRANCH;
use crate::db::{self, AppState, Column, Workspace};
use crate::error::AppError;
use git2::{BranchType, Repository};
use rusqlite::Connection;
use serde_json::Value;
use std::path::Path;
use tauri::State;

struct DefaultColumn {
    name: &'static str,
    icon: &'static str,
    color: Option<&'static str>,
    trigger_config: &'static str,
    exit_config: &'static str,
    auto_advance: bool,
}

// Semantic column colors — keep in sync with COLUMN_COLORS in column-config-constants.ts
mod column_colors {
    pub const GRAY: &str = "#6B7280";
    pub const BLUE: &str = "#3B82F6";
    pub const AMBER: &str = "#F59E0B";
    pub const GREEN: &str = "#4ADE80";
}

const DEFAULT_COLUMNS: &[DefaultColumn] = &[
    DefaultColumn {
        name: "Backlog",
        icon: "inbox",
        color: Some(column_colors::GRAY),
        trigger_config: "",
        exit_config: "",
        auto_advance: false,
    },
    DefaultColumn {
        name: "Working",
        icon: "play",
        color: Some(column_colors::BLUE),
        trigger_config: "",
        exit_config: "",
        auto_advance: false,
    },
    DefaultColumn {
        name: "Review",
        icon: "eye",
        color: Some(column_colors::AMBER),
        trigger_config: "",
        exit_config: "",
        auto_advance: false,
    },
    DefaultColumn {
        name: "Done",
        icon: "check",
        color: Some(column_colors::GREEN),
        trigger_config: "",
        exit_config: "",
        auto_advance: false,
    },
];

const STANDARD_COLUMNS: &[DefaultColumn] = &[
    DefaultColumn {
        name: "Backlog",
        icon: "inbox",
        color: Some(column_colors::GRAY),
        trigger_config: "",
        exit_config: "",
        auto_advance: false,
    },
    DefaultColumn {
        name: "In Progress",
        icon: "play",
        color: Some(column_colors::BLUE),
        trigger_config: "",
        exit_config: "",
        auto_advance: false,
    },
    DefaultColumn {
        name: "Review",
        icon: "eye",
        color: Some(column_colors::AMBER),
        trigger_config: "",
        exit_config: "",
        auto_advance: false,
    },
    DefaultColumn {
        name: "Done",
        icon: "check",
        color: Some(column_colors::GREEN),
        trigger_config: "",
        exit_config: "",
        auto_advance: false,
    },
];

const FULL_CI_COLUMNS: &[DefaultColumn] = &[
    DefaultColumn {
        name: "Backlog",
        icon: "inbox",
        color: Some(column_colors::GRAY),
        trigger_config: "",
        exit_config: "",
        auto_advance: false,
    },
    DefaultColumn {
        name: "Spec",
        icon: "file-text",
        color: Some(column_colors::BLUE),
        trigger_config: "agent:plan",
        exit_config: "file:spec.md",
        auto_advance: true,
    },
    DefaultColumn {
        name: "Build",
        icon: "hammer",
        color: Some(column_colors::BLUE),
        trigger_config: "agent:code",
        exit_config: "cmd:npm run build",
        auto_advance: true,
    },
    DefaultColumn {
        name: "Test",
        icon: "flask-conical",
        color: Some(column_colors::AMBER),
        trigger_config: "cmd:npm test",
        exit_config: "exit:0",
        auto_advance: true,
    },
    DefaultColumn {
        name: "Review",
        icon: "eye",
        color: Some(column_colors::AMBER),
        trigger_config: "agent:review",
        exit_config: "pr:approved",
        auto_advance: true,
    },
    DefaultColumn {
        name: "Deploy",
        icon: "rocket",
        color: Some(column_colors::GREEN),
        trigger_config: "cmd:npm run deploy",
        exit_config: "exit:0",
        auto_advance: true,
    },
    DefaultColumn {
        name: "Notify",
        icon: "bell",
        color: Some("#FBBF24"),
        trigger_config: "",
        exit_config: "notification:sent",
        auto_advance: true,
    },
    DefaultColumn {
        name: "Done",
        icon: "check",
        color: Some(column_colors::GREEN),
        trigger_config: "",
        exit_config: "",
        auto_advance: false,
    },
];

const QUICK_FIX_COLUMNS: &[DefaultColumn] = &[
    DefaultColumn {
        name: "Todo",
        icon: "bug",
        color: Some(column_colors::GRAY),
        trigger_config: "",
        exit_config: "",
        auto_advance: false,
    },
    DefaultColumn {
        name: "Fixing",
        icon: "wrench",
        color: Some(column_colors::BLUE),
        trigger_config: "agent:code",
        exit_config: "cmd:npm test",
        auto_advance: true,
    },
    DefaultColumn {
        name: "Done",
        icon: "check",
        color: Some(column_colors::GREEN),
        trigger_config: "",
        exit_config: "",
        auto_advance: false,
    },
];

const SPIKE_COLUMNS: &[DefaultColumn] = &[
    DefaultColumn {
        name: "Questions",
        icon: "circle-help",
        color: Some(column_colors::GRAY),
        trigger_config: "",
        exit_config: "",
        auto_advance: false,
    },
    DefaultColumn {
        name: "Research",
        icon: "search",
        color: Some(column_colors::BLUE),
        trigger_config: "agent:research",
        exit_config: "",
        auto_advance: false,
    },
    DefaultColumn {
        name: "Prototype",
        icon: "flask-conical",
        color: Some(column_colors::AMBER),
        trigger_config: "agent:code",
        exit_config: "",
        auto_advance: false,
    },
    DefaultColumn {
        name: "Findings",
        icon: "lightbulb",
        color: Some("#FBBF24"),
        trigger_config: "",
        exit_config: "",
        auto_advance: false,
    },
];

fn columns_for_template(template_id: Option<&str>) -> &'static [DefaultColumn] {
    match template_id {
        Some("standard") | None => STANDARD_COLUMNS,
        Some("full-ci") => FULL_CI_COLUMNS,
        Some("quick-fix") => QUICK_FIX_COLUMNS,
        Some("spike") => SPIKE_COLUMNS,
        Some(_) => DEFAULT_COLUMNS,
    }
}

/// Shared workspace-creation core used by both the Tauri command and the HTTP
/// API. Validates the repo path, writes the workspace + config, and creates the
/// template's default columns — all in one transaction — so a workspace created
/// from the UI and from MCP are identical (the MCP path previously hardcoded 4
/// columns and skipped config + templates).
pub fn create_workspace_core(
    conn: &Connection,
    name: &str,
    repo_path: &str,
    template_id: Option<&str>,
    default_agent_cli: Option<&str>,
) -> Result<Workspace, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Workspace name cannot be empty".to_string(),
        ));
    }
    let repo_path = validate_workspace_repo_path(repo_path)?;
    let workspace_config = new_workspace_config(&repo_path, default_agent_cli.map(str::trim))?;

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut ws = db::insert_workspace(conn, name.trim(), &repo_path)?;
    if workspace_config != "{}" {
        ws = db::update_workspace(conn, &ws.id, None, None, None, None, Some(&workspace_config))?;
    }

    // Auto-create columns from the selected onboarding template.
    for (i, col) in columns_for_template(template_id).iter().enumerate() {
        let created =
            db::insert_column_with_style(conn, &ws.id, col.name, i as i64, col.icon, col.color)?;
        if !col.trigger_config.is_empty() || !col.exit_config.is_empty() || col.auto_advance {
            let triggers = serde_json::json!({
                "triggerConfig": col.trigger_config,
                "exitConfig": col.exit_config,
                "autoAdvance": col.auto_advance,
            })
            .to_string();
            db::update_column(conn, &created.id, None, None, None, None, None, Some(&triggers))?;
        }
    }

    tx.commit()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(ws)
}

#[tauri::command]
pub fn create_workspace(
    state: State<AppState>,
    name: String,
    repo_path: String,
    template_id: Option<String>,
    default_agent_cli: Option<String>,
) -> Result<Workspace, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    create_workspace_core(
        &conn,
        &name,
        &repo_path,
        template_id.as_deref(),
        default_agent_cli.as_deref(),
    )
}

fn new_workspace_config(
    repo_path: &str,
    default_agent_cli: Option<&str>,
) -> Result<String, AppError> {
    let mut config = Value::Object(Default::default());
    if let Some(cli) = default_agent_cli.filter(|cli| !cli.is_empty()) {
        if let Some(obj) = config.as_object_mut() {
            obj.insert(
                "defaultAgentCli".to_string(),
                Value::String(cli.to_string()),
            );
        }
    }

    workspace_config_with_detected_base_branch(&config.to_string(), repo_path)
}

#[tauri::command]
pub fn get_workspace(state: State<AppState>, id: String) -> Result<Workspace, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::get_workspace(&conn, &id)?)
}

#[tauri::command]
pub fn list_workspaces(state: State<AppState>) -> Result<Vec<Workspace>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_workspaces(&conn)?)
}

#[tauri::command]
pub fn update_workspace(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    repo_path: Option<String>,
    tab_order: Option<i64>,
    is_active: Option<bool>,
    config: Option<String>,
) -> Result<Workspace, AppError> {
    if let Some(ref n) = name {
        if n.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "Workspace name cannot be empty".to_string(),
            ));
        }
    }
    let repo_path = match repo_path.as_deref() {
        Some(path) => Some(validate_workspace_repo_path(path)?),
        None => None,
    };
    let config_update = match (repo_path.as_deref(), config.as_deref()) {
        (Some(path), Some(config)) => {
            Some(workspace_config_with_detected_base_branch(config, path)?)
        }
        (Some(path), None) => {
            let conn = state
                .db
                .lock()
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;
            let current = db::get_workspace(&conn, &id)?;
            drop(conn);
            Some(workspace_config_with_detected_base_branch(
                &current.config,
                path,
            )?)
        }
        (None, Some(config)) => Some(config.to_string()),
        (None, None) => None,
    };

    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::update_workspace(
        &conn,
        &id,
        name.as_deref(),
        repo_path.as_deref(),
        tab_order,
        is_active,
        config_update.as_deref(),
    )?)
}

fn validate_workspace_repo_path(repo_path: &str) -> Result<String, AppError> {
    let path = repo_path.trim();
    if path.is_empty() {
        return Err(AppError::InvalidInput(
            "Repository path cannot be empty".to_string(),
        ));
    }

    let path_ref = Path::new(path);
    if !path_ref.exists() {
        return Err(AppError::InvalidInput(format!(
            "Repository path does not exist: {}",
            path
        )));
    }
    if !path_ref.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Repository path is not a directory: {}",
            path
        )));
    }
    let repo = Repository::discover(path_ref).map_err(|_| {
        AppError::InvalidInput(format!(
            "Repository path is not inside a git repository: {}",
            path
        ))
    })?;
    let workdir = repo.workdir().ok_or_else(|| {
        AppError::InvalidInput(format!(
            "Repository path must be inside a non-bare git worktree: {}",
            path
        ))
    })?;
    let canonical = workdir.canonicalize().map_err(|e| {
        AppError::InvalidInput(format!(
            "Failed to canonicalize repository path {}: {}",
            workdir.display(),
            e
        ))
    })?;

    Ok(canonical.to_string_lossy().into_owned())
}

fn detect_workspace_default_base_branch(repo_path: &str) -> Result<String, AppError> {
    let repo = Repository::discover(Path::new(repo_path))
        .map_err(|e| AppError::CommandError(format!("Failed to open git repository: {}", e)))?;

    if let Ok(remote_head) = repo.find_reference("refs/remotes/origin/HEAD") {
        if let Some(target) = remote_head.symbolic_target() {
            if let Some(branch) = target.strip_prefix("refs/remotes/origin/") {
                let branch = branch.trim();
                if !branch.is_empty() && branch != "HEAD" {
                    return Ok(branch.to_string());
                }
            }
        }
    }

    for name in ["main", "master"] {
        if repo.find_branch(name, BranchType::Local).is_ok() {
            return Ok(name.to_string());
        }
    }

    if let Ok(head) = repo.head() {
        if let Some(branch) = head.shorthand().map(str::trim) {
            if !branch.is_empty() && branch != "HEAD" {
                return Ok(branch.to_string());
            }
        }
    }

    Ok(DEFAULT_BASE_BRANCH.to_string())
}

fn workspace_config_has_base_branch(config: &Value) -> bool {
    let has_non_empty_string = |value: Option<&Value>| {
        value
            .and_then(Value::as_str)
            .map(str::trim)
            .is_some_and(|value| !value.is_empty())
    };

    has_non_empty_string(config.get("defaultBaseBranch"))
        || has_non_empty_string(config.get("default_base_branch"))
        || config.get("git").is_some_and(|git| {
            has_non_empty_string(git.get("defaultBaseBranch"))
                || has_non_empty_string(git.get("default_base_branch"))
        })
}

fn workspace_config_with_detected_base_branch(
    config_json: &str,
    repo_path: &str,
) -> Result<String, AppError> {
    let mut config = serde_json::from_str::<Value>(config_json)
        .unwrap_or_else(|_| Value::Object(Default::default()));
    if !config.is_object() {
        config = Value::Object(Default::default());
    }

    if workspace_config_has_base_branch(&config) {
        return serde_json::to_string(&config).map_err(|e| {
            AppError::CommandError(format!("Failed to encode workspace config: {}", e))
        });
    }

    let detected = detect_workspace_default_base_branch(repo_path)?;
    if detected == DEFAULT_BASE_BRANCH {
        return serde_json::to_string(&config).map_err(|e| {
            AppError::CommandError(format!("Failed to encode workspace config: {}", e))
        });
    }

    if let Some(obj) = config.as_object_mut() {
        obj.insert("defaultBaseBranch".to_string(), Value::String(detected));
    }

    serde_json::to_string(&config)
        .map_err(|e| AppError::CommandError(format!("Failed to encode workspace config: {}", e)))
}

#[tauri::command]
pub fn delete_workspace(state: State<AppState>, id: String) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    // CASCADE handles associated columns/tasks
    db::delete_workspace(&conn, &id)?;
    Ok(())
}

/// List columns for a workspace (used internally, also exposed as command).
pub fn get_default_columns(
    state: &State<AppState>,
    workspace_id: &str,
) -> Result<Vec<Column>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_columns(&conn, workspace_id)?)
}

/// Clone an existing workspace with all its columns and tasks
#[tauri::command]
pub fn clone_workspace(
    state: State<AppState>,
    source_id: String,
    new_name: String,
) -> Result<Workspace, AppError> {
    if new_name.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "New workspace name cannot be empty".to_string(),
        ));
    }

    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Get source workspace
    let source = db::get_workspace(&conn, &source_id)?;

    // Create new workspace with same repo path
    let new_ws = db::insert_workspace(&conn, new_name.trim(), &source.repo_path)?;

    // Copy columns
    let columns = db::list_columns(&conn, &source_id)?;
    let mut column_id_map = std::collections::HashMap::new();

    for col in &columns {
        let new_col = db::insert_column_with_style(
            &conn,
            &new_ws.id,
            &col.name,
            col.position,
            &col.icon,
            col.color.as_deref(),
        )?;
        // Apply remaining properties (visibility, triggers)
        if !col.visible || col.triggers.is_some() {
            db::update_column(
                &conn,
                &new_col.id,
                None,
                None,
                None,
                None,
                Some(col.visible),
                col.triggers.as_deref(),
            )?;
        }
        column_id_map.insert(col.id.clone(), new_col.id);
    }

    // Copy tasks
    for col in &columns {
        let tasks = db::list_tasks_by_column(&conn, &col.id)?;
        let new_col_id = column_id_map.get(&col.id).unwrap();

        for task in tasks {
            let new_task = db::insert_task(
                &conn,
                &new_ws.id,
                new_col_id,
                &task.title,
                task.description.as_deref(),
            )?;
            // Update task position and priority
            db::update_task(
                &conn,
                &new_task.id,
                Some(&task.title),
                Some(task.description.as_deref()),
                None, // column_id stays the same
                Some(task.position),
                Some(task.agent_mode.as_deref()),
                Some(&task.priority),
            )?;
        }
    }

    tx.commit()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::get_workspace(&conn, &new_ws.id)?)
}

/// Reorder workspaces by updating their tab_order
#[tauri::command]
pub fn reorder_workspaces(state: State<AppState>, ids: Vec<String>) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    for (i, id) in ids.iter().enumerate() {
        db::update_workspace(&conn, id, None, None, Some(i as i64), None, None)?;
    }

    tx.commit()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

/// Seed a sample workspace for local development.
#[cfg(debug_assertions)]
#[tauri::command]
pub fn seed_demo_data(state: State<AppState>, repo_path: String) -> Result<Workspace, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Create demo workspace
    let ws = db::insert_workspace(&conn, "Demo Workspace", &repo_path)?;

    // Create default columns with icons and colors
    let mut columns = Vec::new();
    for (i, col) in DEFAULT_COLUMNS.iter().enumerate() {
        let c =
            db::insert_column_with_style(&conn, &ws.id, col.name, i as i64, col.icon, col.color)?;
        columns.push(c);
    }

    // Sample tasks for Backlog
    let backlog_id = &columns[0].id;
    db::insert_task(
        &conn,
        &ws.id,
        backlog_id,
        "Add dark mode toggle",
        Some("Implement theme switching in settings"),
    )?;
    db::insert_task(
        &conn,
        &ws.id,
        backlog_id,
        "Refactor auth flow",
        Some("Simplify the authentication logic"),
    )?;

    // Task with draft PR
    let draft_task = db::insert_task(
        &conn,
        &ws.id,
        backlog_id,
        "Write unit tests",
        Some("Add tests for core utilities - WIP draft PR"),
    )?;
    db::update_task_branch(&conn, &draft_task.id, Some("feat/unit-tests"))?;
    db::update_task_pr_info(
        &conn,
        &draft_task.id,
        Some(101),
        Some("https://github.com/demo/repo/pull/101"),
    )?;
    db::update_task_pr_status(
        &conn,
        &draft_task.id,
        Some("unknown"),
        Some("pending"),
        None,
        Some(0),
        Some(true),
        Some("[]"),
        Some("abc123"),
    )?;

    // Sample tasks for Working - with CI failure and merge conflict
    let working_id = &columns[1].id;
    let ci_fail_task = db::insert_task(
        &conn,
        &ws.id,
        working_id,
        "Implement CLI agent spawning",
        Some("Wire up settings to spawn correct CLI - CI failing"),
    )?;
    db::update_task_branch(&conn, &ci_fail_task.id, Some("feat/cli-agent"))?;
    db::update_task_pr_info(
        &conn,
        &ci_fail_task.id,
        Some(102),
        Some("https://github.com/demo/repo/pull/102"),
    )?;
    db::update_task_pr_status(
        &conn,
        &ci_fail_task.id,
        Some("conflicted"),
        Some("failure"),
        Some("changes_requested"),
        Some(5),
        Some(false),
        Some("[\"bug\",\"needs-work\"]"),
        Some("def456"),
    )?;

    let working_task = db::insert_task(
        &conn,
        &ws.id,
        working_id,
        "Fix terminal scrolling",
        Some("Terminal output should auto-scroll"),
    )?;
    db::update_task_branch(&conn, &working_task.id, Some("fix/terminal-scroll"))?;

    // Sample tasks for Review - with approved PR
    let review_id = &columns[2].id;
    let approved_task = db::insert_task(
        &conn,
        &ws.id,
        review_id,
        "PR: Add keyboard shortcuts",
        Some("Review PR #12 for hotkey support - ready to merge!"),
    )?;
    db::update_task_branch(&conn, &approved_task.id, Some("feat/keyboard-shortcuts"))?;
    db::update_task_pr_info(
        &conn,
        &approved_task.id,
        Some(103),
        Some("https://github.com/demo/repo/pull/103"),
    )?;
    db::update_task_pr_status(
        &conn,
        &approved_task.id,
        Some("mergeable"),
        Some("success"),
        Some("approved"),
        Some(3),
        Some(false),
        Some("[\"enhancement\",\"ready\"]"),
        Some("ghi789"),
    )?;

    // Sample tasks for Done
    let done_id = &columns[3].id;
    let done_task1 = db::insert_task(
        &conn,
        &ws.id,
        done_id,
        "Setup project structure",
        Some("Initial Tauri + React setup complete"),
    )?;
    db::update_task_branch(&conn, &done_task1.id, Some("feat/initial-setup"))?;
    db::update_task_pr_info(
        &conn,
        &done_task1.id,
        Some(99),
        Some("https://github.com/demo/repo/pull/99"),
    )?;
    db::update_task_pr_status(
        &conn,
        &done_task1.id,
        Some("mergeable"),
        Some("success"),
        Some("approved"),
        Some(2),
        Some(false),
        Some("[\"merged\"]"),
        Some("xyz000"),
    )?;

    db::insert_task(
        &conn,
        &ws.id,
        done_id,
        "Design settings UI",
        Some("Settings panel with tabs working"),
    )?;

    tx.commit()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::get_workspace(&conn, &ws.id)?)
}

#[cfg(test)]
mod tests {
    use super::{
        columns_for_template, detect_workspace_default_base_branch, new_workspace_config,
        validate_workspace_repo_path, workspace_config_with_detected_base_branch,
    };
    use git2::Repository;
    use std::path::Path;
    use std::process::Command;
    use tempfile::tempdir;

    fn git(repo: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo)
            .output()
            .expect("git command");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn init_repo_with_branch(repo: &Path, branch: &str) {
        git(repo, &["init", "-q", "-b", branch]);
        git(repo, &["config", "user.email", "test@example.com"]);
        git(repo, &["config", "user.name", "Test User"]);
        std::fs::write(repo.join("README.md"), "test\n").expect("write readme");
        git(repo, &["add", "README.md"]);
        git(repo, &["commit", "-q", "-m", "initial"]);
    }

    #[test]
    fn columns_for_template_uses_selected_onboarding_template() {
        let quick_fix = columns_for_template(Some("quick-fix"));

        assert_eq!(quick_fix.len(), 3);
        assert_eq!(quick_fix[0].name, "Todo");
        assert_eq!(quick_fix[1].trigger_config, "agent:code");
        assert_eq!(quick_fix[1].exit_config, "cmd:npm test");
        assert!(quick_fix[1].auto_advance);
    }

    #[test]
    fn new_workspace_config_stores_default_agent_cli() {
        let dir = tempdir().expect("tempdir");
        init_repo_with_branch(dir.path(), "main");

        let config = new_workspace_config(dir.path().to_str().expect("utf8"), Some("codex"))
            .expect("workspace config");

        let parsed: serde_json::Value = serde_json::from_str(&config).expect("json");
        assert_eq!(
            parsed
                .get("defaultAgentCli")
                .and_then(serde_json::Value::as_str),
            Some("codex")
        );
    }

    #[test]
    fn validate_workspace_repo_path_requires_existing_directory() {
        let dir = tempdir().expect("tempdir");
        let missing = dir.path().join("missing");

        let err = validate_workspace_repo_path(missing.to_str().expect("utf8"))
            .expect_err("missing path should fail");

        assert!(err.to_string().contains("does not exist"));
    }

    #[test]
    fn validate_workspace_repo_path_requires_git_repository() {
        let dir = tempdir().expect("tempdir");

        let err = validate_workspace_repo_path(dir.path().to_str().expect("utf8"))
            .expect_err("plain directory should fail");

        assert!(err.to_string().contains("not inside a git repository"));
    }

    #[test]
    fn validate_workspace_repo_path_normalizes_git_subdirectory_to_worktree_root() {
        let dir = tempdir().expect("tempdir");
        Repository::init(dir.path()).expect("init repo");
        let nested = dir.path().join("nested");
        std::fs::create_dir_all(&nested).expect("nested");

        let validated = validate_workspace_repo_path(nested.to_str().expect("utf8"))
            .expect("repo subdirectory should pass");

        assert_eq!(
            validated,
            dir.path()
                .canonicalize()
                .expect("canonical root")
                .to_string_lossy()
                .into_owned()
        );
    }

    #[test]
    fn detect_workspace_default_base_branch_uses_current_branch_when_main_missing() {
        let dir = tempdir().expect("tempdir");
        init_repo_with_branch(dir.path(), "develop");

        let detected = detect_workspace_default_base_branch(dir.path().to_str().expect("utf8"))
            .expect("detect branch");

        assert_eq!(detected, "develop");
    }

    #[test]
    fn workspace_config_sets_detected_non_main_base_branch() {
        let dir = tempdir().expect("tempdir");
        init_repo_with_branch(dir.path(), "master");

        let config =
            workspace_config_with_detected_base_branch("{}", dir.path().to_str().expect("utf8"))
                .expect("workspace config");

        let parsed: serde_json::Value = serde_json::from_str(&config).expect("json");
        assert_eq!(
            parsed
                .get("defaultBaseBranch")
                .and_then(serde_json::Value::as_str),
            Some("master")
        );
    }

    #[test]
    fn detect_workspace_default_base_branch_prefers_origin_head() {
        let dir = tempdir().expect("tempdir");
        init_repo_with_branch(dir.path(), "main");
        git(dir.path(), &["branch", "develop"]);
        git(
            dir.path(),
            &["update-ref", "refs/remotes/origin/develop", "HEAD"],
        );
        git(
            dir.path(),
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/develop",
            ],
        );

        let detected = detect_workspace_default_base_branch(dir.path().to_str().expect("utf8"))
            .expect("detect branch");

        assert_eq!(detected, "develop");
    }

    #[test]
    fn workspace_config_leaves_main_as_implicit_default() {
        let dir = tempdir().expect("tempdir");
        init_repo_with_branch(dir.path(), "main");

        let config =
            workspace_config_with_detected_base_branch("{}", dir.path().to_str().expect("utf8"))
                .expect("workspace config");

        assert_eq!(config, "{}");
    }

    #[test]
    fn workspace_config_preserves_explicit_base_branch() {
        let dir = tempdir().expect("tempdir");
        init_repo_with_branch(dir.path(), "master");

        let config = workspace_config_with_detected_base_branch(
            r#"{"defaultBaseBranch":"release"}"#,
            dir.path().to_str().expect("utf8"),
        )
        .expect("workspace config");

        let parsed: serde_json::Value = serde_json::from_str(&config).expect("json");
        assert_eq!(
            parsed
                .get("defaultBaseBranch")
                .and_then(serde_json::Value::as_str),
            Some("release")
        );
    }
}
