use crate::db::{self, AppState, Checklist, ChecklistCategory, ChecklistItem};
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use tauri::State;

/// Response containing the full checklist with categories and items
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistWithData {
    pub checklist: Option<Checklist>,
    pub categories: Vec<ChecklistCategory>,
    pub items: std::collections::HashMap<String, Vec<ChecklistItem>>,
}

/// Get the checklist for a workspace with all categories and items
#[tauri::command]
pub fn get_workspace_checklist(
    state: State<AppState>,
    workspace_id: String,
) -> Result<ChecklistWithData, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;

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
#[tauri::command]
pub fn update_checklist_item(
    state: State<AppState>,
    item_id: String,
    checked: Option<bool>,
    notes: Option<Option<String>>,
) -> Result<ChecklistItem, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Convert Option<Option<String>> to Option<Option<&str>>
    let notes_ref = notes.as_ref().map(|opt| opt.as_deref());

    Ok(db::update_checklist_item(&conn, &item_id, checked, notes_ref)?)
}

/// Update a checklist category's collapsed state
#[tauri::command]
pub fn update_checklist_category(
    state: State<AppState>,
    category_id: String,
    collapsed: bool,
) -> Result<ChecklistCategory, AppError> {
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(db::update_checklist_category(&conn, &category_id, Some(collapsed))?)
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
        let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;
        let tx = conn.unchecked_transaction().map_err(|e| AppError::DatabaseError(e.to_string()))?;

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
                db::insert_checklist_item(
                    &conn,
                    &category.id,
                    &item.text,
                    item_idx as i64,
                )?;
            }
        }

        tx.commit().map_err(|e| AppError::DatabaseError(e.to_string()))?;
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
    let conn = state.db.lock().map_err(|e| AppError::DatabaseError(e.to_string()))?;

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
pub struct TemplateItem {
    pub text: String,
}
