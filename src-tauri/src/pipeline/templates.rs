//! Pipeline template application: capture/restore column structure + triggers
//! across workspaces. Supports placeholder substitution (`{{NAME}}`) at apply
//! time, distinct from the runtime trigger interpolator (`{task.title}`, etc.).

use crate::db::{self, Column, PipelineTemplate};
use crate::error::AppError;
use crate::pipeline::triggers::ColumnTriggersV2;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Single column entry inside a pipeline template's `columns_json` blob.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnTemplateData {
    pub name: String,
    #[serde(default = "default_icon")]
    pub icon: String,
    #[serde(default)]
    pub color: Option<String>,
    /// `ColumnTriggersV2` JSON (string). Empty `{}` for columns with no triggers.
    #[serde(default = "default_triggers")]
    pub triggers: String,
}

fn default_icon() -> String {
    "list".to_string()
}

fn default_triggers() -> String {
    "{}".to_string()
}

/// Outcome of applying a template to a workspace.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOutcome {
    pub created_column_ids: Vec<String>,
    pub migrated_task_count: i64,
    pub policy: String,
}

/// Collision policy for `apply_pipeline_template`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CollisionPolicy {
    ReplaceAll,
    Append,
    Prompt,
}

impl CollisionPolicy {
    pub fn from_str(s: &str) -> Result<Self, AppError> {
        match s {
            "replace_all" => Ok(Self::ReplaceAll),
            "append" => Ok(Self::Append),
            "prompt" => Ok(Self::Prompt),
            other => Err(AppError::InvalidInput(format!(
                "Unknown collision_policy '{}'. Expected: replace_all | append | prompt",
                other
            ))),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReplaceAll => "replace_all",
            Self::Append => "append",
            Self::Prompt => "prompt",
        }
    }
}

/// Extract a list of column templates from a workspace's current columns.
///
/// Used by `save_pipeline_template`. Captures only structural data —
/// no task data, no IDs.
pub fn extract_template_from_workspace(
    conn: &Connection,
    workspace_id: &str,
) -> Result<Vec<ColumnTemplateData>, AppError> {
    let columns = db::list_columns(conn, workspace_id)?;
    Ok(columns
        .into_iter()
        .map(|col| ColumnTemplateData {
            name: col.name,
            icon: col.icon,
            color: col.color,
            triggers: col.triggers.unwrap_or_else(|| "{}".to_string()),
        })
        .collect())
}

/// Substitute `{{NAME}}` placeholders inside a triggers JSON blob.
///
/// Walks the parsed JSON tree and replaces placeholders only inside string
/// values. This avoids breaking JSON syntax when a placeholder value contains
/// `"`, `\`, or other characters that would require escaping in raw text.
///
/// Placeholders not present in `placeholders` are left as-is and a warning is
/// logged (caller surfaces this to the user).
pub fn substitute_placeholders(
    triggers_json: &str,
    placeholders: &HashMap<String, String>,
) -> Result<String, AppError> {
    if triggers_json.trim().is_empty() {
        return Ok("{}".to_string());
    }
    let mut value: serde_json::Value = serde_json::from_str(triggers_json).map_err(|e| {
        AppError::InvalidInput(format!(
            "triggers JSON is not valid JSON ({}). Got: {}",
            e, triggers_json
        ))
    })?;
    walk_substitute(&mut value, placeholders);
    serde_json::to_string(&value)
        .map_err(|e| AppError::DatabaseError(format!("re-serialize triggers: {}", e)))
}

fn walk_substitute(value: &mut serde_json::Value, placeholders: &HashMap<String, String>) {
    match value {
        serde_json::Value::String(s) => {
            if s.contains("{{") {
                *s = substitute_in_string(s, placeholders);
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr.iter_mut() {
                walk_substitute(v, placeholders);
            }
        }
        serde_json::Value::Object(obj) => {
            for (_k, v) in obj.iter_mut() {
                walk_substitute(v, placeholders);
            }
        }
        _ => {}
    }
}

fn substitute_in_string(input: &str, placeholders: &HashMap<String, String>) -> String {
    let mut result = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(open_idx) = rest.find("{{") {
        result.push_str(&rest[..open_idx]);
        let after_open = &rest[open_idx + 2..];
        match after_open.find("}}") {
            Some(close_idx) => {
                let key = after_open[..close_idx].trim();
                let after_close = &after_open[close_idx + 2..];
                match placeholders.get(key) {
                    Some(val) => result.push_str(val),
                    None => {
                        log::warn!("[templates] no value for placeholder {{{{{}}}}}", key);
                        result.push_str("{{");
                        result.push_str(&after_open[..close_idx]);
                        result.push_str("}}");
                    }
                }
                rest = after_close;
            }
            None => {
                result.push_str("{{");
                result.push_str(after_open);
                rest = "";
                break;
            }
        }
    }
    result.push_str(rest);
    result
}

/// Validate a triggers JSON string by parsing it as `ColumnTriggersV2`.
fn validate_triggers(triggers_json: &str, column_name: &str) -> Result<(), AppError> {
    if triggers_json.is_empty() || triggers_json == "{}" {
        return Ok(());
    }
    serde_json::from_str::<ColumnTriggersV2>(triggers_json).map_err(|e| {
        AppError::InvalidInput(format!(
            "Column '{}' has invalid triggers after placeholder substitution: {}",
            column_name, e
        ))
    })?;
    Ok(())
}

/// Parse a template's `columns_json` into a Vec of column templates.
pub fn parse_template_columns(
    template: &PipelineTemplate,
) -> Result<Vec<ColumnTemplateData>, AppError> {
    serde_json::from_str(&template.columns_json).map_err(|e| {
        AppError::InvalidInput(format!(
            "Template '{}' columns_json is invalid: {}",
            template.name, e
        ))
    })
}

/// Apply a template to a workspace using `replace_all`: wipes existing columns
/// (after refusing if any task is non-idle), creates new ones, and re-points
/// tasks by name-match (or `task_mapping` overrides), falling back to the
/// first new column.
///
/// Caller is responsible for ensuring `template` is loaded and `workspace_id`
/// exists.
pub fn apply_template_replace_all(
    conn: &Connection,
    template: &PipelineTemplate,
    workspace_id: &str,
    placeholders: &HashMap<String, String>,
    task_mapping: &HashMap<String, String>,
) -> Result<ApplyOutcome, AppError> {
    // Refuse if any task is non-idle.
    let tasks = db::list_tasks(conn, workspace_id)?;
    let busy: Vec<String> = tasks
        .iter()
        .filter(|t| t.pipeline_state != "idle")
        .map(|t| format!("'{}' ({})", t.title, t.pipeline_state))
        .collect();
    if !busy.is_empty() {
        return Err(AppError::InvalidInput(format!(
            "Cannot apply template with replace_all: {} task(s) are not idle: {}",
            busy.len(),
            busy.join(", ")
        )));
    }

    let column_data = parse_template_columns(template)?;
    if column_data.is_empty() {
        return Err(AppError::InvalidInput(
            "Template has no columns".to_string(),
        ));
    }

    let existing_columns = db::list_columns(conn, workspace_id)?;

    // Substitute + validate every triggers blob before any writes.
    let prepared: Vec<(ColumnTemplateData, String)> = column_data
        .into_iter()
        .map(|col| {
            let substituted = substitute_placeholders(&col.triggers, placeholders)?;
            validate_triggers(&substituted, &col.name)?;
            Ok::<_, AppError>((col, substituted))
        })
        .collect::<Result<Vec<_>, _>>()?;

    // Build name → new column map for task remap (case-insensitive).
    let new_names: Vec<String> = prepared.iter().map(|(c, _)| c.name.clone()).collect();
    let new_names_set: HashMap<String, String> = new_names
        .iter()
        .map(|n| (n.to_lowercase(), n.clone()))
        .collect();

    // Plan task migrations: for each existing column, decide which new column
    // its tasks should go to.
    //   - explicit task_mapping wins (matches existing column name → new name)
    //   - else case-insensitive name match in new template
    //   - else fallback: first new column
    let fallback_name = prepared[0].0.name.clone();
    let mut column_remap: HashMap<String, String> = HashMap::new();
    for old in &existing_columns {
        let target = task_mapping
            .get(&old.name)
            .cloned()
            .or_else(|| new_names_set.get(&old.name.to_lowercase()).cloned())
            .unwrap_or_else(|| fallback_name.clone());
        column_remap.insert(old.id.clone(), target);
    }

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Stage tasks into a holding column (we'll need to re-point them after we
    // recreate columns). Since column ids are about to change, we move tasks
    // into a placeholder column inserted at a high position; after recreating
    // we move them into the matching new columns and delete the placeholder.
    let placeholder_pos: i64 = 1_000_000;
    let placeholder_col = db::insert_column_with_style(
        conn,
        workspace_id,
        "__bentoya_template_holding__",
        placeholder_pos,
        "list",
        None,
    )?;

    let mut migrated_task_count: i64 = 0;
    // Map task_id → desired new column name (resolved post-recreate).
    let mut task_target_names: HashMap<String, String> = HashMap::new();
    for task in &tasks {
        let target_name = column_remap
            .get(&task.column_id)
            .cloned()
            .unwrap_or_else(|| fallback_name.clone());
        task_target_names.insert(task.id.clone(), target_name);
        conn.execute(
            "UPDATE tasks SET column_id = ?1 WHERE id = ?2",
            params![placeholder_col.id, task.id],
        )
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
        migrated_task_count += 1;
    }

    // Delete every original column.
    for col in &existing_columns {
        db::delete_column(conn, &col.id)?;
    }

    // Insert new columns at their template positions.
    let mut created_column_ids: Vec<String> = Vec::with_capacity(prepared.len());
    let mut name_to_new_id: HashMap<String, String> = HashMap::new();
    for (idx, (col, triggers)) in prepared.iter().enumerate() {
        let inserted = db::insert_column_with_style(
            conn,
            workspace_id,
            &col.name,
            idx as i64,
            &col.icon,
            col.color.as_deref(),
        )?;
        // Persist triggers (insert_column_with_style doesn't take triggers).
        if !triggers.is_empty() && triggers != "{}" {
            db::update_column(
                conn,
                &inserted.id,
                None,
                None,
                None,
                None,
                None,
                Some(triggers),
            )?;
        }
        name_to_new_id.insert(col.name.clone(), inserted.id.clone());
        created_column_ids.push(inserted.id);
    }

    // Re-point tasks from holding column to new columns.
    for (task_id, target_name) in &task_target_names {
        let new_col_id = name_to_new_id.get(target_name).cloned().unwrap_or_else(|| {
            // Defensive: should never miss because target_name came from
            // prepared names.
            created_column_ids[0].clone()
        });
        db::append_task_to_column(conn, task_id, &new_col_id)?;
    }

    // Delete the placeholder column (now empty).
    db::delete_column(conn, &placeholder_col.id)?;

    tx.commit()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(ApplyOutcome {
        created_column_ids,
        migrated_task_count,
        policy: CollisionPolicy::ReplaceAll.as_str().to_string(),
    })
}

/// Apply a template to a workspace using `append`: adds the template's columns
/// at the end of the existing column list. Does not move tasks.
pub fn apply_template_append(
    conn: &Connection,
    template: &PipelineTemplate,
    workspace_id: &str,
    placeholders: &HashMap<String, String>,
) -> Result<ApplyOutcome, AppError> {
    let column_data = parse_template_columns(template)?;
    if column_data.is_empty() {
        return Err(AppError::InvalidInput(
            "Template has no columns".to_string(),
        ));
    }

    let prepared: Vec<(ColumnTemplateData, String)> = column_data
        .into_iter()
        .map(|col| {
            let substituted = substitute_placeholders(&col.triggers, placeholders)?;
            validate_triggers(&substituted, &col.name)?;
            Ok::<_, AppError>((col, substituted))
        })
        .collect::<Result<Vec<_>, _>>()?;

    let existing: Vec<Column> = db::list_columns(conn, workspace_id)?;
    let start_position = existing.iter().map(|c| c.position).max().unwrap_or(-1) + 1;

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let mut created_column_ids: Vec<String> = Vec::with_capacity(prepared.len());
    for (idx, (col, triggers)) in prepared.iter().enumerate() {
        let pos = start_position + idx as i64;
        let inserted = db::insert_column_with_style(
            conn,
            workspace_id,
            &col.name,
            pos,
            &col.icon,
            col.color.as_deref(),
        )?;
        if !triggers.is_empty() && triggers != "{}" {
            db::update_column(
                conn,
                &inserted.id,
                None,
                None,
                None,
                None,
                None,
                Some(triggers),
            )?;
        }
        created_column_ids.push(inserted.id);
    }

    tx.commit()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(ApplyOutcome {
        created_column_ids,
        migrated_task_count: 0,
        policy: CollisionPolicy::Append.as_str().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_workspace_with_columns(conn: &Connection, name: &str) -> (String, Vec<String>) {
        let ws = db::insert_workspace(conn, name, "/tmp/repo").unwrap();
        let mut col_ids = Vec::new();
        for (i, n) in ["Backlog", "Working", "Review", "Done"].iter().enumerate() {
            let col = db::insert_column_with_style(conn, &ws.id, n, i as i64, "list", None)
                .unwrap();
            col_ids.push(col.id);
        }
        (ws.id, col_ids)
    }

    fn make_template(conn: &Connection, name: &str, columns: serde_json::Value) -> PipelineTemplate {
        let json = serde_json::to_string(&columns).unwrap();
        db::insert_pipeline_template(conn, name, name, "", &json, None, false).unwrap()
    }

    #[test]
    fn substitute_placeholders_in_string_value() {
        let mut h = HashMap::new();
        h.insert("FOO".to_string(), "bar".to_string());
        let json = r#"{"on_entry":{"type":"run_script","script_id":"{{FOO}}"}}"#;
        let out = substitute_placeholders(json, &h).unwrap();
        assert!(out.contains("\"script_id\":\"bar\""), "got {}", out);
        assert!(!out.contains("{{"));
    }

    #[test]
    fn substitute_placeholders_preserves_quotes_in_value() {
        let mut h = HashMap::new();
        h.insert("X".to_string(), "with \"quoted\" word".to_string());
        let json = r#"{"on_entry":{"type":"run_script","script_id":"{{X}}"}}"#;
        let out = substitute_placeholders(json, &h).unwrap();
        // The serializer escapes the embedded quotes — the JSON must still parse.
        let parsed: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(
            parsed["on_entry"]["script_id"].as_str().unwrap(),
            "with \"quoted\" word"
        );
    }

    #[test]
    fn substitute_placeholders_leaves_unknown_keys_intact() {
        let h = HashMap::new();
        let json = r#"{"a":"hello {{MISSING}} world"}"#;
        let out = substitute_placeholders(json, &h).unwrap();
        assert!(out.contains("{{MISSING}}"));
    }

    #[test]
    fn substitute_placeholders_handles_empty_input() {
        let h = HashMap::new();
        assert_eq!(substitute_placeholders("", &h).unwrap(), "{}");
        assert_eq!(substitute_placeholders("{}", &h).unwrap(), "{}");
    }

    #[test]
    fn extract_template_from_workspace_captures_structure() {
        let conn = db::init_test().unwrap();
        let (ws_id, _) = make_workspace_with_columns(&conn, "WS");
        let extracted = extract_template_from_workspace(&conn, &ws_id).unwrap();
        assert_eq!(extracted.len(), 4);
        assert_eq!(extracted[0].name, "Backlog");
        assert_eq!(extracted[3].name, "Done");
    }

    #[test]
    fn apply_replace_all_clean_workspace() {
        let conn = db::init_test().unwrap();
        let ws = db::insert_workspace(&conn, "Target", "/tmp/x").unwrap();
        // Target starts with no columns.
        let template = make_template(
            &conn,
            "tpl",
            serde_json::json!([
                { "name": "Plan", "icon": "list", "color": null, "triggers": "{}" },
                { "name": "Build", "icon": "list", "color": null, "triggers": "{}" }
            ]),
        );
        let placeholders: HashMap<String, String> = HashMap::new();
        let mapping: HashMap<String, String> = HashMap::new();
        let outcome =
            apply_template_replace_all(&conn, &template, &ws.id, &placeholders, &mapping).unwrap();
        assert_eq!(outcome.created_column_ids.len(), 2);
        let cols = db::list_columns(&conn, &ws.id).unwrap();
        assert_eq!(cols.len(), 2);
        assert_eq!(cols[0].name, "Plan");
        assert_eq!(cols[1].name, "Build");
    }

    #[test]
    fn apply_replace_all_remaps_tasks_by_name() {
        let conn = db::init_test().unwrap();
        let (ws_id, col_ids) = make_workspace_with_columns(&conn, "WS");
        // Add tasks in "Backlog" and "Done".
        let t1 = db::insert_task(&conn, &ws_id, &col_ids[0], "Task A", None).unwrap();
        let t2 = db::insert_task(&conn, &ws_id, &col_ids[3], "Task B", None).unwrap();

        let template = make_template(
            &conn,
            "tpl",
            serde_json::json!([
                { "name": "Backlog", "icon": "list", "color": null, "triggers": "{}" },
                { "name": "Done", "icon": "list", "color": null, "triggers": "{}" }
            ]),
        );
        let outcome = apply_template_replace_all(
            &conn,
            &template,
            &ws_id,
            &HashMap::new(),
            &HashMap::new(),
        )
        .unwrap();
        assert_eq!(outcome.migrated_task_count, 2);
        let cols = db::list_columns(&conn, &ws_id).unwrap();
        let backlog = &cols.iter().find(|c| c.name == "Backlog").unwrap().id;
        let done = &cols.iter().find(|c| c.name == "Done").unwrap().id;
        let t1_after = db::get_task(&conn, &t1.id).unwrap();
        let t2_after = db::get_task(&conn, &t2.id).unwrap();
        assert_eq!(&t1_after.column_id, backlog);
        assert_eq!(&t2_after.column_id, done);
    }

    #[test]
    fn apply_replace_all_falls_back_to_first_column_when_no_match() {
        let conn = db::init_test().unwrap();
        let (ws_id, col_ids) = make_workspace_with_columns(&conn, "WS");
        let t = db::insert_task(&conn, &ws_id, &col_ids[1], "Task X", None).unwrap();
        let template = make_template(
            &conn,
            "tpl",
            serde_json::json!([
                { "name": "AlphaCol", "icon": "list", "color": null, "triggers": "{}" }
            ]),
        );
        apply_template_replace_all(&conn, &template, &ws_id, &HashMap::new(), &HashMap::new())
            .unwrap();
        let cols = db::list_columns(&conn, &ws_id).unwrap();
        assert_eq!(cols.len(), 1);
        let after = db::get_task(&conn, &t.id).unwrap();
        assert_eq!(after.column_id, cols[0].id);
    }

    #[test]
    fn apply_replace_all_refuses_non_idle_tasks() {
        let conn = db::init_test().unwrap();
        let (ws_id, col_ids) = make_workspace_with_columns(&conn, "WS");
        let task = db::insert_task(&conn, &ws_id, &col_ids[0], "Hot Task", None).unwrap();
        db::update_task_pipeline_state(&conn, &task.id, "running", None, None).unwrap();
        let template = make_template(
            &conn,
            "tpl",
            serde_json::json!([
                { "name": "OnlyCol", "icon": "list", "color": null, "triggers": "{}" }
            ]),
        );
        let result = apply_template_replace_all(
            &conn,
            &template,
            &ws_id,
            &HashMap::new(),
            &HashMap::new(),
        );
        assert!(matches!(result, Err(AppError::InvalidInput(_))));
        // Original columns unchanged.
        let cols = db::list_columns(&conn, &ws_id).unwrap();
        assert_eq!(cols.len(), 4);
    }

    #[test]
    fn apply_append_preserves_existing_columns() {
        let conn = db::init_test().unwrap();
        let (ws_id, _) = make_workspace_with_columns(&conn, "WS");
        let template = make_template(
            &conn,
            "tpl",
            serde_json::json!([
                { "name": "Notify", "icon": "bell", "color": null, "triggers": "{}" },
                { "name": "Wrap", "icon": "list", "color": null, "triggers": "{}" }
            ]),
        );
        apply_template_append(&conn, &template, &ws_id, &HashMap::new()).unwrap();
        let cols = db::list_columns(&conn, &ws_id).unwrap();
        assert_eq!(cols.len(), 6);
        assert_eq!(cols[4].name, "Notify");
        assert_eq!(cols[5].name, "Wrap");
    }

    #[test]
    fn apply_append_succeeds_with_running_tasks() {
        let conn = db::init_test().unwrap();
        let (ws_id, col_ids) = make_workspace_with_columns(&conn, "WS");
        let task = db::insert_task(&conn, &ws_id, &col_ids[0], "Hot", None).unwrap();
        db::update_task_pipeline_state(&conn, &task.id, "running", None, None).unwrap();
        let template = make_template(
            &conn,
            "tpl",
            serde_json::json!([
                { "name": "Extra", "icon": "list", "color": null, "triggers": "{}" }
            ]),
        );
        apply_template_append(&conn, &template, &ws_id, &HashMap::new()).unwrap();
        let cols = db::list_columns(&conn, &ws_id).unwrap();
        assert_eq!(cols.len(), 5);
    }

    #[test]
    fn apply_validates_triggers_post_substitution() {
        let conn = db::init_test().unwrap();
        let ws = db::insert_workspace(&conn, "W", "/tmp/x").unwrap();
        let template = make_template(
            &conn,
            "tpl",
            serde_json::json!([
                {
                    "name": "Plan",
                    "icon": "list",
                    "color": null,
                    "triggers": "{\"on_entry\":{\"type\":\"not_a_real_type\"}}"
                }
            ]),
        );
        let err = apply_template_append(&conn, &template, &ws.id, &HashMap::new()).unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)));
    }
}
