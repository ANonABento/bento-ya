use crate::db::{self, AppState, PipelineTemplate};
use crate::error::AppError;
use crate::pipeline::templates::{
    self, ApplyOutcome, ColumnTemplateData, CollisionPolicy,
};
use crate::pipeline::{self};
use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineTemplateSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source_workspace_id: Option<String>,
    pub is_built_in: bool,
    pub column_count: usize,
    pub created_at: String,
    pub updated_at: String,
}

fn summarize(template: &PipelineTemplate) -> PipelineTemplateSummary {
    let column_count: usize = serde_json::from_str::<Vec<serde_json::Value>>(&template.columns_json)
        .map(|v| v.len())
        .unwrap_or(0);
    PipelineTemplateSummary {
        id: template.id.clone(),
        name: template.name.clone(),
        description: template.description.clone(),
        source_workspace_id: template.source_workspace_id.clone(),
        is_built_in: template.is_built_in,
        column_count,
        created_at: template.created_at.clone(),
        updated_at: template.updated_at.clone(),
    }
}

#[tauri::command]
pub fn list_pipeline_templates(
    state: State<AppState>,
) -> Result<Vec<PipelineTemplateSummary>, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::list_pipeline_templates(&conn)?
        .iter()
        .map(summarize)
        .collect())
}

#[tauri::command]
pub fn get_pipeline_template(
    state: State<AppState>,
    id: String,
) -> Result<PipelineTemplate, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(db::get_pipeline_template(&conn, &id)?)
}

#[tauri::command]
pub fn save_pipeline_template(
    state: State<AppState>,
    name: String,
    description: String,
    source_workspace_id: String,
) -> Result<PipelineTemplate, AppError> {
    if name.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Template name cannot be empty".to_string(),
        ));
    }
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    if let Some(existing) = db::find_pipeline_template_by_name(&conn, name.trim())? {
        return Err(AppError::InvalidInput(format!(
            "A template named '{}' already exists (id {})",
            existing.name, existing.id
        )));
    }

    // Capture columns from the source workspace.
    let column_data: Vec<ColumnTemplateData> =
        templates::extract_template_from_workspace(&conn, &source_workspace_id)?;
    if column_data.is_empty() {
        return Err(AppError::InvalidInput(
            "Source workspace has no columns".to_string(),
        ));
    }
    let columns_json = serde_json::to_string(&column_data)
        .map_err(|e| AppError::DatabaseError(format!("serialize columns: {}", e)))?;

    let id = db::new_id();
    Ok(db::insert_pipeline_template(
        &conn,
        &id,
        name.trim(),
        description.trim(),
        &columns_json,
        Some(&source_workspace_id),
        false,
    )?)
}

#[tauri::command]
pub fn delete_pipeline_template(state: State<AppState>, id: String) -> Result<(), AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    let existing = db::get_pipeline_template(&conn, &id)?;
    if existing.is_built_in {
        return Err(AppError::InvalidInput(
            "Cannot delete built-in pipeline templates".to_string(),
        ));
    }
    db::delete_pipeline_template(&conn, &id)?;
    Ok(())
}

#[tauri::command]
pub fn apply_pipeline_template(
    state: State<AppState>,
    app: AppHandle,
    template_id: String,
    target_workspace_id: String,
    collision_policy: String,
    placeholders: Option<HashMap<String, String>>,
    task_mapping: Option<HashMap<String, String>>,
) -> Result<ApplyOutcome, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let policy = CollisionPolicy::from_str(&collision_policy)?;
    let template = db::get_pipeline_template(&conn, &template_id)?;
    // Sanity-check workspace exists.
    db::get_workspace(&conn, &target_workspace_id)?;

    let placeholders = placeholders.unwrap_or_default();
    let task_mapping = task_mapping.unwrap_or_default();

    let outcome = match policy {
        CollisionPolicy::ReplaceAll => templates::apply_template_replace_all(
            &conn,
            &template,
            &target_workspace_id,
            &placeholders,
            &task_mapping,
        )?,
        CollisionPolicy::Append => templates::apply_template_append(
            &conn,
            &template,
            &target_workspace_id,
            &placeholders,
        )?,
        CollisionPolicy::Prompt => {
            return Err(AppError::InvalidInput(
                "collision_policy 'prompt' is not yet supported in v1".to_string(),
            ));
        }
    };

    pipeline::emit_tasks_changed(&app, &target_workspace_id, "pipeline_template_applied");
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarize_handles_empty_columns_json() {
        let t = PipelineTemplate {
            id: "x".into(),
            name: "x".into(),
            description: "".into(),
            columns_json: "".into(),
            source_workspace_id: None,
            is_built_in: false,
            created_at: "".into(),
            updated_at: "".into(),
        };
        assert_eq!(summarize(&t).column_count, 0);
    }

    #[test]
    fn summarize_counts_columns() {
        let t = PipelineTemplate {
            id: "x".into(),
            name: "x".into(),
            description: "".into(),
            columns_json: "[{},{},{}]".into(),
            source_workspace_id: None,
            is_built_in: false,
            created_at: "".into(),
            updated_at: "".into(),
        };
        assert_eq!(summarize(&t).column_count, 3);
    }
}
