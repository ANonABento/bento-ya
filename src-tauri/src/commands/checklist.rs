use crate::db::{self, AppState, Checklist, ChecklistCategory, ChecklistItem};
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use tauri::State;

/// Response containing the full checklist with categories and items
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistWithData {
    pub checklist: Option<Checklist>,
    pub categories: Vec<ChecklistCategory>,
    pub items: std::collections::HashMap<String, Vec<ChecklistItem>>,
}

fn validate_detect_type(detect_type: Option<&str>) -> Result<(), AppError> {
    match detect_type {
        None
        | Some("none" | "file-exists" | "file-contains" | "file-absent" | "command-succeeds") => {
            Ok(())
        }
        Some(value) => Err(AppError::InvalidInput(format!(
            "Unknown checklist detection type: {}",
            value
        ))),
    }
}

fn validate_detect_config(
    detect_type: Option<&str>,
    detect_config: Option<&str>,
) -> Result<(), AppError> {
    if let Some(config) = detect_config {
        let value = serde_json::from_str::<serde_json::Value>(config)
            .map_err(|e| AppError::InvalidInput(format!("Invalid detection config JSON: {}", e)))?;
        if matches!(detect_type, Some("command-succeeds")) {
            let command = value
                .get("command")
                .and_then(|command| command.as_str())
                .map(str::trim)
                .unwrap_or("");
            if command.is_empty() {
                return Err(AppError::InvalidInput(
                    "command-succeeds detection requires a command".to_string(),
                ));
            }
            if value
                .get("allowUnsafeCommand")
                .and_then(|enabled| enabled.as_bool())
                != Some(true)
            {
                return Err(AppError::InvalidInput(
                    "command-succeeds detection requires allowUnsafeCommand=true".to_string(),
                ));
            }
        }
    }
    Ok(())
}

fn validate_detection_pattern(pattern: &str) -> Result<(), AppError> {
    let path = Path::new(pattern);
    if path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
    {
        return Err(AppError::InvalidInput(format!(
            "Checklist detection pattern must stay inside the workspace: {}",
            pattern
        )));
    }
    Ok(())
}

fn detection_glob_pattern(repo_root: &Path, pattern: &str) -> Result<String, AppError> {
    validate_detection_pattern(pattern)?;
    Ok(repo_root.join(pattern).to_string_lossy().to_string())
}

fn first_glob_match_inside(repo_root: &Path, full_pattern: &str) -> bool {
    let Ok(paths) = glob::glob(full_pattern) else {
        return false;
    };
    paths.filter_map(Result::ok).any(|path| {
        path.canonicalize()
            .map(|canonical| canonical.starts_with(repo_root))
            .unwrap_or(false)
    })
}

fn first_glob_file_inside(repo_root: &Path, full_pattern: &str) -> Option<PathBuf> {
    let paths = glob::glob(full_pattern).ok()?;
    paths.filter_map(Result::ok).find(|path| {
        path.canonicalize()
            .map(|canonical| canonical.starts_with(repo_root) && canonical.is_file())
            .unwrap_or(false)
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateChecklistItemInput {
    pub text: Option<String>,
    pub checked: Option<bool>,
    pub notes: Option<Option<String>>,
    pub position: Option<i64>,
    pub detect_type: Option<Option<String>>,
    pub detect_config: Option<Option<String>>,
    pub auto_detected: Option<bool>,
    pub linked_task_id: Option<Option<String>>,
}

/// Create a blank checklist for a workspace
#[tauri::command]
pub fn create_checklist(
    state: State<AppState>,
    workspace_id: String,
    name: String,
    description: Option<String>,
) -> Result<Checklist, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput(
            "Checklist name cannot be empty".to_string(),
        ));
    }

    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    if db::get_workspace_checklist(&conn, &workspace_id)?.is_some() {
        return Err(AppError::InvalidInput(
            "Workspace already has a checklist".to_string(),
        ));
    }

    Ok(db::insert_checklist(
        &conn,
        &workspace_id,
        name,
        description.as_deref(),
    )?)
}

/// Update checklist metadata
#[tauri::command]
pub fn update_checklist(
    state: State<AppState>,
    checklist_id: String,
    name: Option<String>,
    description: Option<Option<String>>,
) -> Result<Checklist, AppError> {
    let name = name.as_deref().map(str::trim);
    if let Some(value) = name {
        if value.is_empty() {
            return Err(AppError::InvalidInput(
                "Checklist name cannot be empty".to_string(),
            ));
        }
    }

    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let description_ref = description.as_ref().map(|opt| opt.as_deref());

    Ok(db::update_checklist(
        &conn,
        &checklist_id,
        name,
        description_ref,
    )?)
}

/// Delete a checklist by ID
#[tauri::command]
pub fn delete_checklist(state: State<AppState>, checklist_id: String) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::delete_checklist(&conn, &checklist_id)?;
    Ok(())
}

/// Get the checklist for a workspace with all categories and items
#[tauri::command]
pub fn get_workspace_checklist(
    state: State<AppState>,
    workspace_id: String,
) -> Result<ChecklistWithData, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Get the workspace's checklist
    let checklist = db::get_workspace_checklist(&conn, &workspace_id)?;

    match checklist {
        Some(cl) => {
            // Get all categories for this checklist
            let categories = db::list_checklist_categories(&conn, &cl.id)?;

            // Get items for each category
            let mut items = std::collections::HashMap::new();
            for cat in &categories {
                let cat_items = db::list_checklist_items(&conn, &cat.id)?;
                items.insert(cat.id.clone(), cat_items);
            }

            Ok(ChecklistWithData {
                checklist: Some(cl),
                categories,
                items,
            })
        }
        None => Ok(ChecklistWithData {
            checklist: None,
            categories: vec![],
            items: std::collections::HashMap::new(),
        }),
    }
}

/// Update a checklist item's checked state and/or notes
#[tauri::command(rename_all = "camelCase")]
pub fn update_checklist_item(
    state: State<AppState>,
    item_id: String,
    updates: UpdateChecklistItemInput,
) -> Result<ChecklistItem, AppError> {
    let text = updates.text.as_deref().map(str::trim);
    if let Some(value) = text {
        if value.is_empty() {
            return Err(AppError::InvalidInput(
                "Checklist item text cannot be empty".to_string(),
            ));
        }
    }
    if updates.position.is_some_and(|pos| pos < 0) {
        return Err(AppError::InvalidInput(
            "Position must be non-negative".to_string(),
        ));
    }
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let current = db::get_checklist_item(&conn, &item_id)?;
    let effective_detect_type = match updates.detect_type.as_ref() {
        Some(value) => value.as_deref(),
        None => current.detect_type.as_deref(),
    };
    let effective_detect_config = match updates.detect_config.as_ref() {
        Some(value) => value.as_deref(),
        None => current.detect_config.as_deref(),
    };
    validate_detect_type(effective_detect_type)?;
    validate_detect_config(effective_detect_type, effective_detect_config)?;

    Ok(db::update_checklist_item_details(
        &conn,
        &item_id,
        db::ChecklistItemUpdate {
            text,
            checked: updates.checked,
            notes: updates.notes.as_ref().map(|opt| opt.as_deref()),
            position: updates.position,
            detect_type: updates.detect_type.as_ref().map(|opt| opt.as_deref()),
            detect_config: updates.detect_config.as_ref().map(|opt| opt.as_deref()),
            auto_detected: updates.auto_detected,
            linked_task_id: updates.linked_task_id.as_ref().map(|opt| opt.as_deref()),
        },
    )?)
}

/// Create a checklist category
#[tauri::command]
pub fn create_checklist_category(
    state: State<AppState>,
    checklist_id: String,
    name: String,
    icon: String,
    position: Option<i64>,
) -> Result<ChecklistCategory, AppError> {
    let name = name.trim();
    let icon = icon.trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput(
            "Category name cannot be empty".to_string(),
        ));
    }
    if icon.is_empty() {
        return Err(AppError::InvalidInput(
            "Category icon cannot be empty".to_string(),
        ));
    }
    if position.is_some_and(|pos| pos < 0) {
        return Err(AppError::InvalidInput(
            "Position must be non-negative".to_string(),
        ));
    }

    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let position = match position {
        Some(position) => position,
        None => db::list_checklist_categories(&conn, &checklist_id)?.len() as i64,
    };

    Ok(db::insert_checklist_category(
        &conn,
        &checklist_id,
        name,
        icon,
        position,
    )?)
}

/// Update a checklist category
#[tauri::command]
pub fn update_checklist_category(
    state: State<AppState>,
    category_id: String,
    name: Option<String>,
    icon: Option<String>,
    position: Option<i64>,
    collapsed: Option<bool>,
) -> Result<ChecklistCategory, AppError> {
    let name = name.as_deref().map(str::trim);
    let icon = icon.as_deref().map(str::trim);
    if let Some(value) = name {
        if value.is_empty() {
            return Err(AppError::InvalidInput(
                "Category name cannot be empty".to_string(),
            ));
        }
    }
    if let Some(value) = icon {
        if value.is_empty() {
            return Err(AppError::InvalidInput(
                "Category icon cannot be empty".to_string(),
            ));
        }
    }
    if position.is_some_and(|pos| pos < 0) {
        return Err(AppError::InvalidInput(
            "Position must be non-negative".to_string(),
        ));
    }

    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(db::update_checklist_category_details(
        &conn,
        &category_id,
        name,
        icon,
        position,
        collapsed,
    )?)
}

/// Delete a checklist category and its items
#[tauri::command]
pub fn delete_checklist_category(
    state: State<AppState>,
    category_id: String,
) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::delete_checklist_category(&conn, &category_id)?;
    Ok(())
}

/// Create a checklist item
#[tauri::command]
pub fn create_checklist_item(
    state: State<AppState>,
    category_id: String,
    text: String,
    position: Option<i64>,
    detect_type: Option<String>,
    detect_config: Option<String>,
) -> Result<ChecklistItem, AppError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError::InvalidInput(
            "Checklist item text cannot be empty".to_string(),
        ));
    }
    if position.is_some_and(|pos| pos < 0) {
        return Err(AppError::InvalidInput(
            "Position must be non-negative".to_string(),
        ));
    }
    validate_detect_type(detect_type.as_deref())?;
    validate_detect_config(detect_type.as_deref(), detect_config.as_deref())?;

    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let position = match position {
        Some(position) => position,
        None => db::list_checklist_items(&conn, &category_id)?.len() as i64,
    };

    if detect_type.is_some() || detect_config.is_some() {
        Ok(db::create_checklist_item_with_detect(
            &conn,
            &category_id,
            text,
            position,
            detect_type.as_deref(),
            detect_config.as_deref(),
        )?)
    } else {
        Ok(db::insert_checklist_item(
            &conn,
            &category_id,
            text,
            position,
        )?)
    }
}

/// Delete a checklist item
#[tauri::command]
pub fn delete_checklist_item(state: State<AppState>, item_id: String) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    db::delete_checklist_item(&conn, &item_id)?;
    Ok(())
}

/// Create a checklist for a workspace from a template
#[tauri::command]
pub fn create_workspace_checklist(
    state: State<AppState>,
    workspace_id: String,
    name: String,
    description: Option<String>,
    categories: Vec<TemplateCategory>,
) -> Result<ChecklistWithData, AppError> {
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;

        // Check if workspace already has a checklist
        if let Some(existing) = db::get_workspace_checklist(&conn, &workspace_id)? {
            // Delete existing checklist (cascade will delete categories and items)
            db::delete_checklist(&conn, &existing.id)?;
        }

        // Create the checklist
        let checklist = db::insert_checklist(&conn, &workspace_id, &name, description.as_deref())?;

        // Create categories and items
        for (cat_idx, cat) in categories.iter().enumerate() {
            let category = db::insert_checklist_category(
                &conn,
                &checklist.id,
                &cat.name,
                &cat.icon,
                cat_idx as i64,
            )?;

            for (item_idx, item) in cat.items.iter().enumerate() {
                // Use create_checklist_item_with_detect if detection config is provided
                if item.detect_type.is_some() || item.detect_config.is_some() {
                    validate_detect_type(item.detect_type.as_deref())?;
                    validate_detect_config(
                        item.detect_type.as_deref(),
                        item.detect_config.as_deref(),
                    )?;
                    db::create_checklist_item_with_detect(
                        &conn,
                        &category.id,
                        &item.text,
                        item_idx as i64,
                        item.detect_type.as_deref(),
                        item.detect_config.as_deref(),
                    )?;
                } else {
                    db::insert_checklist_item(&conn, &category.id, &item.text, item_idx as i64)?;
                }
            }
        }

        tx.commit()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }

    // Re-fetch to get updated progress counts (conn is dropped here, so state can be used)
    get_workspace_checklist(state, workspace_id)
}

/// Delete a workspace's checklist
#[tauri::command]
pub fn delete_workspace_checklist(
    state: State<AppState>,
    workspace_id: String,
) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    if let Some(checklist) = db::get_workspace_checklist(&conn, &workspace_id)? {
        db::delete_checklist(&conn, &checklist.id)?;
    }

    Ok(())
}

/// Template category for creating checklists
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateCategory {
    pub name: String,
    pub icon: String,
    pub items: Vec<TemplateItem>,
}

/// Template item for creating checklists
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateItem {
    pub text: String,
    pub detect_type: Option<String>,
    pub detect_config: Option<String>,
}

/// Update a checklist item's auto-detected status
#[tauri::command]
pub fn update_checklist_item_auto_detect(
    state: State<AppState>,
    item_id: String,
    auto_detected: bool,
    checked: bool,
) -> Result<ChecklistItem, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::update_checklist_item_auto_detect(
        &conn,
        &item_id,
        auto_detected,
        checked,
    )?)
}

/// Link a checklist item to a task (for "Fix this" feature)
#[tauri::command]
pub fn link_checklist_item_to_task(
    state: State<AppState>,
    item_id: String,
    task_id: Option<String>,
) -> Result<ChecklistItem, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::link_checklist_item_to_task(
        &conn,
        &item_id,
        task_id.as_deref(),
    )?)
}

// ─── Auto-Detection ───────────────────────────────────────────────────────────

/// Result of running detection on a checklist item
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionResult {
    pub item_id: String,
    pub detected: bool,
    pub message: Option<String>,
}

/// Run auto-detection on all checklist items with detection configured
#[tauri::command(rename_all = "camelCase")]
pub async fn run_checklist_detection(
    state: State<'_, AppState>,
    workspace_id: String,
    _repo_path: String,
) -> Result<Vec<DetectionResult>, AppError> {
    use std::process::Command;

    // Get all checklist items with detection configured
    let (items, repo_path) = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let workspace = db::get_workspace(&conn, &workspace_id)?;

        // Get the workspace's checklist
        let checklist = db::get_workspace_checklist(&conn, &workspace_id)?;
        let Some(cl) = checklist else {
            return Ok(vec![]);
        };

        // Get all categories and items
        let categories = db::list_checklist_categories(&conn, &cl.id)?;
        let mut all_items = vec![];
        for cat in &categories {
            let items = db::list_checklist_items(&conn, &cat.id)?;
            all_items.extend(items);
        }
        (all_items, workspace.repo_path)
    };
    let repo_root = PathBuf::from(&repo_path)
        .canonicalize()
        .map_err(|e| AppError::InvalidInput(format!("Workspace repo path is invalid: {}", e)))?;

    // Filter to items with detection configured
    let detectable: Vec<_> = items
        .into_iter()
        .filter(|item| item.detect_type.is_some() && item.detect_type.as_deref() != Some("none"))
        .collect();

    if detectable.is_empty() {
        return Ok(vec![]);
    }

    let mut results = vec![];

    for item in detectable {
        let detect_type = item.detect_type.as_deref().unwrap_or("none");
        let detect_config: Option<serde_json::Value> = item
            .detect_config
            .as_ref()
            .and_then(|s| serde_json::from_str(s).ok());

        let (detected, message) = match detect_type {
            "file-exists" => {
                let pattern = detect_config
                    .as_ref()
                    .and_then(|c| c.get("pattern"))
                    .and_then(|p| p.as_str())
                    .unwrap_or("*");

                let full_pattern = detection_glob_pattern(&repo_root, pattern)?;
                let found = first_glob_match_inside(&repo_root, &full_pattern);

                (
                    found,
                    if found {
                        Some(format!("Found: {}", pattern))
                    } else {
                        Some(format!("Not found: {}", pattern))
                    },
                )
            }
            "file-absent" => {
                let pattern = detect_config
                    .as_ref()
                    .and_then(|c| c.get("pattern"))
                    .and_then(|p| p.as_str())
                    .unwrap_or("*");

                let full_pattern = detection_glob_pattern(&repo_root, pattern)?;
                let found = first_glob_match_inside(&repo_root, &full_pattern);

                (
                    !found,
                    if found {
                        Some(format!("Found (should be absent): {}", pattern))
                    } else {
                        Some(format!("Correctly absent: {}", pattern))
                    },
                )
            }
            "file-contains" => {
                let pattern = detect_config
                    .as_ref()
                    .and_then(|c| c.get("pattern"))
                    .and_then(|p| p.as_str())
                    .unwrap_or("*");
                let content = detect_config
                    .as_ref()
                    .and_then(|c| c.get("content"))
                    .and_then(|p| p.as_str())
                    .unwrap_or("");

                // Find first matching file and check content
                let full_pattern = detection_glob_pattern(&repo_root, pattern)?;
                let file_path = first_glob_file_inside(&repo_root, &full_pattern);

                let found = if let Some(path) = file_path {
                    std::fs::read_to_string(&path)
                        .map(|contents| contents.contains(content))
                        .unwrap_or(false)
                } else {
                    false
                };

                (
                    found,
                    if found {
                        Some(format!("Found '{}' in {}", content, pattern))
                    } else {
                        Some(format!("Not found '{}' in {}", content, pattern))
                    },
                )
            }
            "command-succeeds" => {
                let allow_unsafe_command = detect_config
                    .as_ref()
                    .and_then(|c| c.get("allowUnsafeCommand"))
                    .and_then(|p| p.as_bool())
                    .unwrap_or(false);
                let command = detect_config
                    .as_ref()
                    .and_then(|c| c.get("command"))
                    .and_then(|p| p.as_str())
                    .unwrap_or("")
                    .trim();

                if !allow_unsafe_command || command.is_empty() {
                    (
                        false,
                        Some(
                            "Command detection requires explicit allowUnsafeCommand=true"
                                .to_string(),
                        ),
                    )
                } else {
                    // Run command in a blocking thread
                    let repo_path_clone = repo_path.clone();
                    let command_clone = command.to_string();
                    let result = tokio::task::spawn_blocking(move || {
                        Command::new("sh")
                            .args(["-c", &command_clone])
                            .current_dir(&repo_path_clone)
                            .output()
                    })
                    .await;

                    match result {
                        Ok(Ok(output)) => {
                            let success = output.status.success();
                            (
                                success,
                                if success {
                                    Some(format!("Command succeeded: {}", command))
                                } else {
                                    Some(format!("Command failed: {}", command))
                                },
                            )
                        }
                        _ => (false, Some(format!("Command error: {}", command))),
                    }
                }
            }
            _ => (false, Some("Unknown detection type".to_string())),
        };

        // Keep both detection metadata and persisted checked state aligned.
        if detected != item.auto_detected || detected != item.checked {
            let conn = state
                .db
                .lock()
                .map_err(|e| AppError::DatabaseError(e.to_string()))?;
            db::update_checklist_item_auto_detect(&conn, &item.id, detected, detected)?;
        }

        results.push(DetectionResult {
            item_id: item.id,
            detected,
            message,
        });
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::{
        detection_glob_pattern, first_glob_match_inside, validate_detect_config,
        validate_detection_pattern,
    };

    #[test]
    fn detection_pattern_rejects_absolute_and_parent_paths() {
        assert!(validate_detection_pattern("/etc/passwd").is_err());
        assert!(validate_detection_pattern("../secret").is_err());
        assert!(validate_detection_pattern("src/../../secret").is_err());
    }

    #[test]
    fn detection_pattern_allows_relative_globs() {
        assert!(validate_detection_pattern("src/**/*.rs").is_ok());
        assert!(validate_detection_pattern("package.json").is_ok());
    }

    #[test]
    fn detection_glob_only_counts_matches_inside_workspace() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("repo");
        std::fs::create_dir_all(repo.join("src")).unwrap();
        std::fs::write(repo.join("src/lib.rs"), "test").unwrap();

        let repo_root = repo.canonicalize().unwrap();
        let pattern = detection_glob_pattern(&repo_root, "src/*.rs").unwrap();

        assert!(first_glob_match_inside(&repo_root, &pattern));
    }

    #[test]
    fn command_detection_config_requires_explicit_unsafe_opt_in() {
        let err =
            validate_detect_config(Some("command-succeeds"), Some(r#"{"command":"npm test"}"#))
                .expect_err("command checks must be explicit");
        assert!(err.to_string().contains("allowUnsafeCommand=true"));

        validate_detect_config(
            Some("command-succeeds"),
            Some(r#"{"command":"npm test","allowUnsafeCommand":true}"#),
        )
        .expect("explicit command check should be allowed");
    }

    #[test]
    fn non_command_detection_config_does_not_require_unsafe_opt_in() {
        validate_detect_config(Some("file-exists"), Some(r#"{"pattern":"README.md"}"#))
            .expect("file checks should not require command opt-in");
    }
}
