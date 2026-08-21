//! CRUD for the `skills` table.
//!
//! Skills previously existed only as an inert frontend type persisted to
//! localStorage, which the backend could never read. Spec:
//! `.tickets/_docs/specs/KAITEN_AGENTS.md`

use rusqlite::{params, Connection, Result as SqlResult};

use super::models::Skill;
use super::now;

/// Order is load-bearing — must match `map_skill_row` one-to-one.
const SKILL_COLUMNS: &str =
    "id, name, description, trigger, script, created_at, updated_at";

fn map_skill_row(row: &rusqlite::Row) -> rusqlite::Result<Skill> {
    Ok(Skill {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
        trigger: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
        script: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

pub fn insert_skill(
    conn: &Connection,
    id: &str,
    name: &str,
    description: &str,
    trigger: &str,
    script: &str,
) -> SqlResult<Skill> {
    let ts = now();
    conn.execute(
        "INSERT INTO skills (id, name, description, trigger, script, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, name, description, trigger, script, ts, ts],
    )?;
    get_skill(conn, id)
}

pub fn get_skill(conn: &Connection, id: &str) -> SqlResult<Skill> {
    conn.query_row(
        &format!("SELECT {} FROM skills WHERE id = ?1", SKILL_COLUMNS),
        params![id],
        map_skill_row,
    )
}

pub fn list_skills(conn: &Connection) -> SqlResult<Vec<Skill>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM skills ORDER BY name COLLATE NOCASE",
        SKILL_COLUMNS
    ))?;
    let rows = stmt.query_map([], map_skill_row)?;
    rows.collect()
}

/// Partial update — `None` leaves a field untouched.
pub fn update_skill(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    description: Option<&str>,
    trigger: Option<&str>,
    script: Option<&str>,
) -> SqlResult<Skill> {
    let current = get_skill(conn, id)?;
    let ts = now();
    conn.execute(
        "UPDATE skills SET name = ?1, description = ?2, trigger = ?3, script = ?4, \
         updated_at = ?5 WHERE id = ?6",
        params![
            name.unwrap_or(&current.name),
            description.unwrap_or(&current.description),
            trigger.unwrap_or(&current.trigger),
            script.unwrap_or(&current.script),
            ts,
            id,
        ],
    )?;
    get_skill(conn, id)
}

pub fn delete_skill(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM skills WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn insert_and_update_round_trip() {
        let conn = db::init_test().unwrap();
        let skill = insert_skill(&conn, "s1", "Lint", "Runs the linter", "lint", "npm run lint")
            .unwrap();
        assert_eq!(skill.name, "Lint");

        let updated = update_skill(&conn, "s1", None, Some("Runs eslint"), None, None).unwrap();
        assert_eq!(updated.description, "Runs eslint");
        assert_eq!(updated.script, "npm run lint", "partial update kept the script");
    }

    #[test]
    fn delete_is_idempotent() {
        let conn = db::init_test().unwrap();
        insert_skill(&conn, "s1", "Lint", "", "", "").unwrap();
        delete_skill(&conn, "s1").unwrap();
        delete_skill(&conn, "s1").unwrap();
        assert!(list_skills(&conn).unwrap().is_empty());
    }
}
