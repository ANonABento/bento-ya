use rusqlite::{params, Connection, Result as SqlResult};

use super::models::PipelineTemplate;
use super::now;

/// Shared SELECT columns for pipeline_templates.
const PIPELINE_TEMPLATE_COLUMNS: &str = "id, name, description, columns_json, source_workspace_id, is_built_in, created_at, updated_at";

fn map_pipeline_template_row(row: &rusqlite::Row) -> rusqlite::Result<PipelineTemplate> {
    Ok(PipelineTemplate {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
        columns_json: row.get(3)?,
        source_workspace_id: row.get(4)?,
        is_built_in: row.get::<_, i64>(5)? != 0,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

pub fn insert_pipeline_template(
    conn: &Connection,
    id: &str,
    name: &str,
    description: &str,
    columns_json: &str,
    source_workspace_id: Option<&str>,
    is_built_in: bool,
) -> SqlResult<PipelineTemplate> {
    let ts = now();
    conn.execute(
        "INSERT INTO pipeline_templates (id, name, description, columns_json, source_workspace_id, is_built_in, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, name, description, columns_json, source_workspace_id, is_built_in as i64, ts, ts],
    )?;
    get_pipeline_template(conn, id)
}

pub fn get_pipeline_template(conn: &Connection, id: &str) -> SqlResult<PipelineTemplate> {
    conn.query_row(
        &format!(
            "SELECT {} FROM pipeline_templates WHERE id = ?1",
            PIPELINE_TEMPLATE_COLUMNS
        ),
        params![id],
        map_pipeline_template_row,
    )
}

pub fn list_pipeline_templates(conn: &Connection) -> SqlResult<Vec<PipelineTemplate>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM pipeline_templates ORDER BY is_built_in DESC, name",
        PIPELINE_TEMPLATE_COLUMNS
    ))?;
    let rows = stmt.query_map([], map_pipeline_template_row)?;
    rows.collect()
}

pub fn find_pipeline_template_by_name(
    conn: &Connection,
    name: &str,
) -> SqlResult<Option<PipelineTemplate>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM pipeline_templates WHERE name = ?1",
        PIPELINE_TEMPLATE_COLUMNS
    ))?;
    let mut rows = stmt.query_map(params![name], map_pipeline_template_row)?;
    Ok(rows.next().transpose()?)
}

pub fn update_pipeline_template(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    description: Option<&str>,
    columns_json: Option<&str>,
) -> SqlResult<PipelineTemplate> {
    let current = get_pipeline_template(conn, id)?;
    let ts = now();
    conn.execute(
        "UPDATE pipeline_templates SET name = ?1, description = ?2, columns_json = ?3, updated_at = ?4 WHERE id = ?5",
        params![
            name.unwrap_or(&current.name),
            description.unwrap_or(&current.description),
            columns_json.unwrap_or(&current.columns_json),
            ts,
            id,
        ],
    )?;
    get_pipeline_template(conn, id)
}

pub fn delete_pipeline_template(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute(
        "DELETE FROM pipeline_templates WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

/// Built-in `slothing-default` template content.
///
/// Six columns matching the get-me-job pipeline shape: Icebox → Setup → Plan →
/// Working → Merge main → Done. Workspace-specific values are placeholders.
fn slothing_default_columns_json() -> String {
    serde_json::to_string(&serde_json::json!([
        {
            "name": "Icebox",
            "icon": "snowflake",
            "color": "#6B7280",
            "triggers": "{}"
        },
        {
            "name": "Setup",
            "icon": "cog",
            "color": "#6B7280",
            "triggers": "{\"on_entry\":{\"type\":\"auto_setup\"},\"exit_criteria\":{\"type\":\"agent_complete\",\"auto_advance\":true}}"
        },
        {
            "name": "Plan",
            "icon": "clipboard",
            "color": "#3B82F6",
            "triggers": "{\"on_entry\":{\"type\":\"spawn_cli\",\"cli\":\"claude\",\"model\":\"opus\",\"prompt_template\":\"Read {{CLAUDE_MD_PATH}} and plan the implementation for: {task.title}\\n\\n{task.description}\"},\"exit_criteria\":{\"type\":\"agent_complete\",\"auto_advance\":true,\"max_retries\":1}}"
        },
        {
            "name": "Working",
            "icon": "play",
            "color": "#3B82F6",
            "triggers": "{\"on_entry\":{\"type\":\"spawn_cli\",\"cli\":\"codex\",\"model\":\"gpt-5.5\",\"prompt_template\":\"Implement: {task.title}\\n\\n{task.description}\"},\"exit_criteria\":{\"type\":\"agent_complete\",\"auto_advance\":true,\"max_retries\":2}}"
        },
        {
            "name": "Merge main",
            "icon": "git-merge",
            "color": "#F59E0B",
            "triggers": "{\"on_entry\":{\"type\":\"spawn_cli\",\"cli\":\"claude\",\"model\":\"opus\",\"prompt_template\":\"Merge main into the current branch and resolve any conflicts for: {task.title}\"},\"on_exit\":{\"type\":\"create_pr\"},\"exit_criteria\":{\"type\":\"agent_complete\",\"auto_advance\":true}}"
        },
        {
            "name": "Done",
            "icon": "check",
            "color": "#4ADE80",
            "triggers": "{\"on_entry\":{\"type\":\"run_script\",\"script_id\":\"{{DISCORD_NOTIFY_SCRIPT_ID}}\"}}"
        }
    ]))
    .expect("slothing-default JSON is statically valid")
}

/// Seed built-in pipeline templates if they don't already exist.
pub fn seed_built_in_pipeline_templates(conn: &Connection) -> SqlResult<()> {
    let ts = now();
    let columns_json = slothing_default_columns_json();
    conn.execute(
        "INSERT OR IGNORE INTO pipeline_templates (id, name, description, columns_json, source_workspace_id, is_built_in, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, 1, ?5, ?6)",
        params![
            "slothing-default",
            "slothing-default",
            "Six-stage pipeline (Icebox → Setup → Plan → Working → Merge main → Done) with claude-opus + codex agents.",
            columns_json,
            ts,
            ts,
        ],
    )?;
    Ok(())
}
