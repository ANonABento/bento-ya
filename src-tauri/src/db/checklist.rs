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

pub fn get_workspace_checklist(conn: &Connection, workspace_id: &str) -> SqlResult<Option<Checklist>> {
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

pub fn list_checklist_categories(conn: &Connection, checklist_id: &str) -> SqlResult<Vec<ChecklistCategory>> {
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

pub fn update_checklist_category(
    conn: &Connection,
    id: &str,
    collapsed: Option<bool>,
) -> SqlResult<ChecklistCategory> {
    if let Some(c) = collapsed {
        conn.execute(
            "UPDATE checklist_categories SET collapsed = ?1 WHERE id = ?2",
            params![if c { 1 } else { 0 }, id],
        )?;
    }
    get_checklist_category(conn, id)
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
    let current = get_checklist_item(conn, id)?;
    let ts = now();

    let new_checked = checked.unwrap_or(current.checked);
    let new_notes = match notes {
        Some(n) => n.map(|s| s.to_string()),
        None => current.notes.clone(),
    };

    conn.execute(
        "UPDATE checklist_items SET checked = ?1, notes = ?2, updated_at = ?3 WHERE id = ?4",
        params![if new_checked { 1 } else { 0 }, new_notes, ts, id],
    )?;

    // Update category and checklist progress
    let cat = get_checklist_category(conn, &current.category_id)?;
    recalculate_category_progress(conn, &current.category_id)?;
    recalculate_checklist_progress(conn, &cat.checklist_id)?;

    get_checklist_item(conn, id)
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
            Some("Tests pass now"),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
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
            None,
            None,
            Some(Some("notes")),
            None,
            Some(None),
            Some(None),
            None,
            Some(None),
        )
        .unwrap();
        assert_eq!(cleared.notes.as_deref(), Some("notes"));
        assert_eq!(cleared.detect_type, None);
        assert_eq!(cleared.detect_config, None);
        assert_eq!(cleared.linked_task_id, None);
    }
}
