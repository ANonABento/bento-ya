use rusqlite::{params, Connection, Result as SqlResult};

use super::models::{Checklist, ChecklistCategory, ChecklistItem};
use super::{new_id, now};

pub fn insert_checklist(
    conn: &Connection,
    workspace_id: &str,
    name: &str,
    description: Option<&str>,
) -> SqlResult<Checklist> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO checklists (id, workspace_id, name, description, progress, total_items, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 0, 0, ?5, ?6)",
        params![id, workspace_id, name, description, ts, ts],
    )?;
    get_checklist(conn, &id)
}

pub fn get_checklist(conn: &Connection, id: &str) -> SqlResult<Checklist> {
    conn.query_row(
        "SELECT id, workspace_id, name, description, progress, total_items, created_at, updated_at FROM checklists WHERE id = ?1",
        params![id],
        |row| Ok(Checklist {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            name: row.get(2)?,
            description: row.get(3)?,
            progress: row.get(4)?,
            total_items: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        }),
    )
}

pub fn get_workspace_checklist(
    conn: &Connection,
    workspace_id: &str,
) -> SqlResult<Option<Checklist>> {
    match conn.query_row(
        "SELECT id, workspace_id, name, description, progress, total_items, created_at, updated_at FROM checklists WHERE workspace_id = ?1",
        params![workspace_id],
        |row| Ok(Checklist {
            id: row.get(0)?,
            workspace_id: row.get(1)?,
            name: row.get(2)?,
            description: row.get(3)?,
            progress: row.get(4)?,
            total_items: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        }),
    ) {
        Ok(c) => Ok(Some(c)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn delete_checklist(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM checklists WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn update_checklist(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    description: Option<Option<&str>>,
) -> SqlResult<Checklist> {
    let current = get_checklist(conn, id)?;
    let ts = now();
    let new_name = name.unwrap_or(&current.name).to_string();
    let new_description = match description {
        Some(value) => value.map(str::to_string),
        None => current.description,
    };

    conn.execute(
        "UPDATE checklists SET name = ?1, description = ?2, updated_at = ?3 WHERE id = ?4",
        params![new_name, new_description, ts, id],
    )?;

    get_checklist(conn, id)
}

pub fn insert_checklist_category(
    conn: &Connection,
    checklist_id: &str,
    name: &str,
    icon: &str,
    position: i64,
) -> SqlResult<ChecklistCategory> {
    let id = new_id();
    conn.execute(
        "INSERT INTO checklist_categories (id, checklist_id, name, icon, position, progress, total_items, collapsed) VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, 0)",
        params![id, checklist_id, name, icon, position],
    )?;
    // Update checklist total
    recalculate_checklist_progress(conn, checklist_id)?;
    get_checklist_category(conn, &id)
}

pub fn get_checklist_category(conn: &Connection, id: &str) -> SqlResult<ChecklistCategory> {
    conn.query_row(
        "SELECT id, checklist_id, name, icon, position, progress, total_items, collapsed FROM checklist_categories WHERE id = ?1",
        params![id],
        |row| Ok(ChecklistCategory {
            id: row.get(0)?,
            checklist_id: row.get(1)?,
            name: row.get(2)?,
            icon: row.get(3)?,
            position: row.get(4)?,
            progress: row.get(5)?,
            total_items: row.get(6)?,
            collapsed: row.get::<_, i64>(7)? != 0,
        }),
    )
}

pub fn list_checklist_categories(
    conn: &Connection,
    checklist_id: &str,
) -> SqlResult<Vec<ChecklistCategory>> {
    let mut stmt = conn.prepare(
        "SELECT id, checklist_id, name, icon, position, progress, total_items, collapsed FROM checklist_categories WHERE checklist_id = ?1 ORDER BY position"
    )?;
    let rows = stmt.query_map(params![checklist_id], |row| {
        Ok(ChecklistCategory {
            id: row.get(0)?,
            checklist_id: row.get(1)?,
            name: row.get(2)?,
            icon: row.get(3)?,
            position: row.get(4)?,
            progress: row.get(5)?,
            total_items: row.get(6)?,
            collapsed: row.get::<_, i64>(7)? != 0,
        })
    })?;
    rows.collect()
}

pub fn update_checklist_category_details(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    icon: Option<&str>,
    position: Option<i64>,
    collapsed: Option<bool>,
) -> SqlResult<ChecklistCategory> {
    let current = get_checklist_category(conn, id)?;
    let new_name = name.unwrap_or(&current.name).to_string();
    let new_icon = icon.unwrap_or(&current.icon).to_string();
    let new_position = position.unwrap_or(current.position);
    let new_collapsed = collapsed.unwrap_or(current.collapsed);

    conn.execute(
        "UPDATE checklist_categories SET name = ?1, icon = ?2, position = ?3, collapsed = ?4 WHERE id = ?5",
        params![
            new_name,
            new_icon,
            new_position,
            if new_collapsed { 1 } else { 0 },
            id
        ],
    )?;

    get_checklist_category(conn, id)
}

pub fn delete_checklist_category(conn: &Connection, id: &str) -> SqlResult<()> {
    let category = get_checklist_category(conn, id)?;
    conn.execute(
        "DELETE FROM checklist_categories WHERE id = ?1",
        params![id],
    )?;
    recalculate_checklist_progress(conn, &category.checklist_id)?;
    Ok(())
}

pub fn insert_checklist_item(
    conn: &Connection,
    category_id: &str,
    text: &str,
    position: i64,
) -> SqlResult<ChecklistItem> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO checklist_items (id, category_id, text, checked, notes, position, created_at, updated_at) VALUES (?1, ?2, ?3, 0, NULL, ?4, ?5, ?6)",
        params![id, category_id, text, position, ts, ts],
    )?;
    // Update category and checklist totals
    let cat = get_checklist_category(conn, category_id)?;
    recalculate_category_progress(conn, category_id)?;
    recalculate_checklist_progress(conn, &cat.checklist_id)?;
    get_checklist_item(conn, &id)
}

pub fn get_checklist_item(conn: &Connection, id: &str) -> SqlResult<ChecklistItem> {
    conn.query_row(
        "SELECT id, category_id, text, checked, notes, position, detect_type, detect_config, auto_detected, linked_task_id, created_at, updated_at FROM checklist_items WHERE id = ?1",
        params![id],
        |row| Ok(ChecklistItem {
            id: row.get(0)?,
            category_id: row.get(1)?,
            text: row.get(2)?,
            checked: row.get::<_, i64>(3)? != 0,
            notes: row.get(4)?,
            position: row.get(5)?,
            detect_type: row.get(6)?,
            detect_config: row.get(7)?,
            auto_detected: row.get::<_, Option<i64>>(8)?.unwrap_or(0) != 0,
            linked_task_id: row.get(9)?,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
        }),
    )
}

pub fn list_checklist_items(conn: &Connection, category_id: &str) -> SqlResult<Vec<ChecklistItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, category_id, text, checked, notes, position, detect_type, detect_config, auto_detected, linked_task_id, created_at, updated_at FROM checklist_items WHERE category_id = ?1 ORDER BY position"
    )?;
    let rows = stmt.query_map(params![category_id], |row| {
        Ok(ChecklistItem {
            id: row.get(0)?,
            category_id: row.get(1)?,
            text: row.get(2)?,
            checked: row.get::<_, i64>(3)? != 0,
            notes: row.get(4)?,
            position: row.get(5)?,
            detect_type: row.get(6)?,
            detect_config: row.get(7)?,
            auto_detected: row.get::<_, Option<i64>>(8)?.unwrap_or(0) != 0,
            linked_task_id: row.get(9)?,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
        })
    })?;
    rows.collect()
}

pub fn update_checklist_item(
    conn: &Connection,
    id: &str,
    checked: Option<bool>,
    notes: Option<Option<&str>>,
) -> SqlResult<ChecklistItem> {
    update_checklist_item_details(
        conn,
        id,
        ChecklistItemUpdate {
            checked,
            notes,
            ..ChecklistItemUpdate::default()
        },
    )
}

#[derive(Default)]
pub struct ChecklistItemUpdate<'a> {
    pub text: Option<&'a str>,
    pub checked: Option<bool>,
    pub notes: Option<Option<&'a str>>,
    pub position: Option<i64>,
    pub detect_type: Option<Option<&'a str>>,
    pub detect_config: Option<Option<&'a str>>,
    pub auto_detected: Option<bool>,
    pub linked_task_id: Option<Option<&'a str>>,
}

pub fn update_checklist_item_details(
    conn: &Connection,
    id: &str,
    update: ChecklistItemUpdate<'_>,
) -> SqlResult<ChecklistItem> {
    let current = get_checklist_item(conn, id)?;
    let ts = now();

    let new_text = update.text.unwrap_or(&current.text).to_string();
    let new_checked = update.checked.unwrap_or(current.checked);
    let new_notes = match update.notes {
        Some(n) => n.map(|s| s.to_string()),
        None => current.notes.clone(),
    };
    let new_position = update.position.unwrap_or(current.position);
    let new_detect_type = match update.detect_type {
        Some(value) => value.map(str::to_string),
        None => current.detect_type.clone(),
    };
    let new_detect_config = match update.detect_config {
        Some(value) => value.map(str::to_string),
        None => current.detect_config.clone(),
    };
    let new_auto_detected = update.auto_detected.unwrap_or(current.auto_detected);
    let new_linked_task_id = match update.linked_task_id {
        Some(value) => value.map(str::to_string),
        None => current.linked_task_id.clone(),
    };

    conn.execute(
        "UPDATE checklist_items SET text = ?1, checked = ?2, notes = ?3, position = ?4, detect_type = ?5, detect_config = ?6, auto_detected = ?7, linked_task_id = ?8, updated_at = ?9 WHERE id = ?10",
        params![
            new_text,
            if new_checked { 1 } else { 0 },
            new_notes,
            new_position,
            new_detect_type,
            new_detect_config,
            if new_auto_detected { 1 } else { 0 },
            new_linked_task_id,
            ts,
            id
        ],
    )?;

    // Update category and checklist progress
    let cat = get_checklist_category(conn, &current.category_id)?;
    recalculate_category_progress(conn, &current.category_id)?;
    recalculate_checklist_progress(conn, &cat.checklist_id)?;

    get_checklist_item(conn, id)
}

pub fn delete_checklist_item(conn: &Connection, id: &str) -> SqlResult<()> {
    let item = get_checklist_item(conn, id)?;
    let cat = get_checklist_category(conn, &item.category_id)?;
    conn.execute("DELETE FROM checklist_items WHERE id = ?1", params![id])?;
    recalculate_category_progress(conn, &item.category_id)?;
    recalculate_checklist_progress(conn, &cat.checklist_id)?;
    Ok(())
}

fn recalculate_category_progress(conn: &Connection, category_id: &str) -> SqlResult<()> {
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM checklist_items WHERE category_id = ?1",
        params![category_id],
        |row| row.get(0),
    )?;
    let checked: i64 = conn.query_row(
        "SELECT COUNT(*) FROM checklist_items WHERE category_id = ?1 AND checked = 1",
        params![category_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "UPDATE checklist_categories SET progress = ?1, total_items = ?2 WHERE id = ?3",
        params![checked, total, category_id],
    )?;
    Ok(())
}

fn recalculate_checklist_progress(conn: &Connection, checklist_id: &str) -> SqlResult<()> {
    let total: i64 = conn.query_row(
        "SELECT COALESCE(SUM(total_items), 0) FROM checklist_categories WHERE checklist_id = ?1",
        params![checklist_id],
        |row| row.get(0),
    )?;
    let checked: i64 = conn.query_row(
        "SELECT COALESCE(SUM(progress), 0) FROM checklist_categories WHERE checklist_id = ?1",
        params![checklist_id],
        |row| row.get(0),
    )?;
    let ts = now();
    conn.execute(
        "UPDATE checklists SET progress = ?1, total_items = ?2, updated_at = ?3 WHERE id = ?4",
        params![checked, total, ts, checklist_id],
    )?;
    Ok(())
}

/// Create a checklist item with detection configuration (used for templates)
pub fn create_checklist_item_with_detect(
    conn: &Connection,
    category_id: &str,
    text: &str,
    position: i64,
    detect_type: Option<&str>,
    detect_config: Option<&str>,
) -> SqlResult<ChecklistItem> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO checklist_items (id, category_id, text, checked, notes, position, detect_type, detect_config, auto_detected, linked_task_id, created_at, updated_at) VALUES (?1, ?2, ?3, 0, NULL, ?4, ?5, ?6, 0, NULL, ?7, ?8)",
        params![id, category_id, text, position, detect_type, detect_config, ts, ts],
    )?;
    // Update category and checklist totals
    let cat = get_checklist_category(conn, category_id)?;
    recalculate_category_progress(conn, category_id)?;
    recalculate_checklist_progress(conn, &cat.checklist_id)?;
    get_checklist_item(conn, &id)
}

/// Update the auto-detected status of a checklist item
pub fn update_checklist_item_auto_detect(
    conn: &Connection,
    id: &str,
    auto_detected: bool,
    checked: bool,
) -> SqlResult<ChecklistItem> {
    let ts = now();
    conn.execute(
        "UPDATE checklist_items SET auto_detected = ?1, checked = ?2, updated_at = ?3 WHERE id = ?4",
        params![if auto_detected { 1 } else { 0 }, if checked { 1 } else { 0 }, ts, id],
    )?;

    // Update category and checklist progress
    let item = get_checklist_item(conn, id)?;
    let cat = get_checklist_category(conn, &item.category_id)?;
    recalculate_category_progress(conn, &item.category_id)?;
    recalculate_checklist_progress(conn, &cat.checklist_id)?;

    get_checklist_item(conn, id)
}

/// Link a checklist item to a task (for "Fix this" feature)
pub fn link_checklist_item_to_task(
    conn: &Connection,
    id: &str,
    task_id: Option<&str>,
) -> SqlResult<ChecklistItem> {
    let ts = now();
    conn.execute(
        "UPDATE checklist_items SET linked_task_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![task_id, ts, id],
    )?;
    get_checklist_item(conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{init_test, insert_workspace};

    #[test]
    fn checklist_item_crud_recalculates_progress() {
        let conn = init_test().unwrap();
        let workspace = insert_workspace(&conn, "Test", "/tmp/test").unwrap();
        let checklist = insert_checklist(&conn, &workspace.id, "Release", None).unwrap();
        let category =
            insert_checklist_category(&conn, &checklist.id, "Quality", "check", 0).unwrap();

        let item = insert_checklist_item(&conn, &category.id, "Tests pass", 0).unwrap();
        let category = get_checklist_category(&conn, &category.id).unwrap();
        let checklist = get_checklist(&conn, &checklist.id).unwrap();
        assert_eq!(category.total_items, 1);
        assert_eq!(category.progress, 0);
        assert_eq!(checklist.total_items, 1);
        assert_eq!(checklist.progress, 0);

        update_checklist_item(&conn, &item.id, Some(true), None).unwrap();
        let category = get_checklist_category(&conn, &category.id).unwrap();
        let checklist = get_checklist(&conn, &checklist.id).unwrap();
        assert_eq!(category.progress, 1);
        assert_eq!(checklist.progress, 1);

        delete_checklist_item(&conn, &item.id).unwrap();
        let category = get_checklist_category(&conn, &category.id).unwrap();
        let checklist = get_checklist(&conn, &checklist.id).unwrap();
        assert_eq!(category.total_items, 0);
        assert_eq!(category.progress, 0);
        assert_eq!(checklist.total_items, 0);
        assert_eq!(checklist.progress, 0);
    }

    #[test]
    fn checklist_item_details_preserve_unmentioned_nullable_fields() {
        let conn = init_test().unwrap();
        let workspace = insert_workspace(&conn, "Test", "/tmp/test").unwrap();
        let checklist = insert_checklist(&conn, &workspace.id, "Release", Some("Before")).unwrap();
        let category =
            insert_checklist_category(&conn, &checklist.id, "Quality", "check", 0).unwrap();
        let item = create_checklist_item_with_detect(
            &conn,
            &category.id,
            "Tests pass",
            0,
            Some("file-exists"),
            Some(r#"{"pattern":"README.md"}"#),
        )
        .unwrap();
        link_checklist_item_to_task(&conn, &item.id, Some("task-1")).unwrap();

        let updated = update_checklist_item_details(
            &conn,
            &item.id,
            ChecklistItemUpdate {
                text: Some("Tests pass now"),
                ..ChecklistItemUpdate::default()
            },
        )
        .unwrap();
        assert_eq!(updated.text, "Tests pass now");
        assert_eq!(updated.detect_type.as_deref(), Some("file-exists"));
        assert_eq!(
            updated.detect_config.as_deref(),
            Some(r#"{"pattern":"README.md"}"#)
        );
        assert_eq!(updated.linked_task_id.as_deref(), Some("task-1"));

        let cleared = update_checklist_item_details(
            &conn,
            &item.id,
            ChecklistItemUpdate {
                notes: Some(Some("notes")),
                detect_type: Some(None),
                detect_config: Some(None),
                linked_task_id: Some(None),
                ..ChecklistItemUpdate::default()
            },
        )
        .unwrap();
        assert_eq!(cleared.notes.as_deref(), Some("notes"));
        assert_eq!(cleared.detect_type, None);
        assert_eq!(cleared.detect_config, None);
        assert_eq!(cleared.linked_task_id, None);
    }
}
