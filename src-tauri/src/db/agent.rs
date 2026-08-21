//! CRUD for the `agents` table — craftable agent DEFINITIONS.
//!
//! Not to be confused with `agent_session.rs`, which is a *running* CLI process.
//! Spec: `.tickets/_docs/specs/KAITEN_AGENTS.md`

use rusqlite::{params, Connection, Result as SqlResult};

use super::models::Agent;
use super::now;

/// Shared SELECT columns for agents. Order is load-bearing — it must match
/// `map_agent_row` one-to-one.
const AGENT_COLUMNS: &str = "id, name, role, runtime, config, avatar, created_at, updated_at";

fn map_agent_row(row: &rusqlite::Row) -> rusqlite::Result<Agent> {
    Ok(Agent {
        id: row.get(0)?,
        name: row.get(1)?,
        role: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
        runtime: row.get(3)?,
        config: row.get(4)?,
        avatar: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

pub fn insert_agent(
    conn: &Connection,
    id: &str,
    name: &str,
    role: &str,
    runtime: &str,
    config: &str,
    avatar: &str,
) -> SqlResult<Agent> {
    let ts = now();
    conn.execute(
        "INSERT INTO agents (id, name, role, runtime, config, avatar, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, name, role, runtime, config, avatar, ts, ts],
    )?;
    get_agent(conn, id)
}

pub fn get_agent(conn: &Connection, id: &str) -> SqlResult<Agent> {
    conn.query_row(
        &format!("SELECT {} FROM agents WHERE id = ?1", AGENT_COLUMNS),
        params![id],
        map_agent_row,
    )
}

pub fn list_agents(conn: &Connection) -> SqlResult<Vec<Agent>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM agents ORDER BY name COLLATE NOCASE",
        AGENT_COLUMNS
    ))?;
    let rows = stmt.query_map([], map_agent_row)?;
    rows.collect()
}

/// Partial update — `None` leaves a field untouched. `updated_at` always moves.
pub fn update_agent(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    role: Option<&str>,
    runtime: Option<&str>,
    config: Option<&str>,
    avatar: Option<&str>,
) -> SqlResult<Agent> {
    let current = get_agent(conn, id)?;
    let ts = now();
    conn.execute(
        "UPDATE agents SET name = ?1, role = ?2, runtime = ?3, config = ?4, avatar = ?5, \
         updated_at = ?6 WHERE id = ?7",
        params![
            name.unwrap_or(&current.name),
            role.unwrap_or(&current.role),
            runtime.unwrap_or(&current.runtime),
            config.unwrap_or(&current.config),
            avatar.unwrap_or(&current.avatar),
            ts,
            id,
        ],
    )?;
    get_agent(conn, id)
}

pub fn delete_agent(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM agents WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn seed(conn: &Connection) -> Agent {
        insert_agent(
            conn,
            "a1",
            "Code Smith",
            "Writes the code",
            "claude",
            r#"{"runtime":"claude","systemPrompt":"go"}"#,
            r#"{"initials":"CS"}"#,
        )
        .unwrap()
    }

    #[test]
    fn insert_and_get_round_trip() {
        let conn = db::init_test().unwrap();
        let agent = seed(&conn);
        assert_eq!(agent.name, "Code Smith");
        assert_eq!(agent.runtime, "claude");
        assert_eq!(agent.created_at, agent.updated_at);

        let reread = get_agent(&conn, "a1").unwrap();
        assert_eq!(reread.role, "Writes the code");
        assert!(reread.config.contains("systemPrompt"));
    }

    #[test]
    fn update_leaves_unspecified_fields_intact() {
        let conn = db::init_test().unwrap();
        seed(&conn);

        let updated = update_agent(&conn, "a1", Some("Reviewer"), None, None, None, None).unwrap();

        assert_eq!(updated.name, "Reviewer");
        assert_eq!(
            updated.role, "Writes the code",
            "a partial update must not blank the other fields"
        );
        assert_eq!(updated.runtime, "claude");
    }

    #[test]
    fn list_is_sorted_case_insensitively() {
        let conn = db::init_test().unwrap();
        insert_agent(&conn, "a1", "zebra", "", "script", "{}", "{}").unwrap();
        insert_agent(&conn, "a2", "Alpha", "", "script", "{}", "{}").unwrap();

        let names: Vec<String> = list_agents(&conn).unwrap().into_iter().map(|a| a.name).collect();
        // Without COLLATE NOCASE, "Alpha" would sort after "zebra" (uppercase
        // letters have lower code points), which reads as broken in the roster.
        assert_eq!(names, vec!["Alpha", "zebra"]);
    }

    #[test]
    fn delete_is_idempotent() {
        let conn = db::init_test().unwrap();
        seed(&conn);
        delete_agent(&conn, "a1").unwrap();
        assert!(get_agent(&conn, "a1").is_err());
        // Deleting an already-gone agent must not error — the UI can double-fire.
        delete_agent(&conn, "a1").unwrap();
    }
}
