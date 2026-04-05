use rusqlite::{params, Connection, Result as SqlResult};

use super::models::Script;
use super::now;

/// Shared SELECT columns for scripts.
const SCRIPT_COLUMNS: &str = "id, name, description, steps, is_built_in, created_at, updated_at";

/// Map a database row to a Script struct.
fn map_script_row(row: &rusqlite::Row) -> rusqlite::Result<Script> {
    Ok(Script {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
        steps: row.get(3)?,
        is_built_in: row.get::<_, i64>(4)? != 0,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

pub fn insert_script(
    conn: &Connection,
    id: &str,
    name: &str,
    description: &str,
    steps: &str,
    is_built_in: bool,
) -> SqlResult<Script> {
    let ts = now();
    conn.execute(
        "INSERT INTO scripts (id, name, description, steps, is_built_in, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, name, description, steps, is_built_in as i64, ts, ts],
    )?;
    get_script(conn, id)
}

pub fn get_script(conn: &Connection, id: &str) -> SqlResult<Script> {
    conn.query_row(
        &format!("SELECT {} FROM scripts WHERE id = ?1", SCRIPT_COLUMNS),
        params![id],
        map_script_row,
    )
}

pub fn list_scripts(conn: &Connection) -> SqlResult<Vec<Script>> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM scripts ORDER BY is_built_in DESC, name", SCRIPT_COLUMNS),
    )?;
    let rows = stmt.query_map([], map_script_row)?;
    rows.collect()
}

pub fn update_script(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    description: Option<&str>,
    steps: Option<&str>,
) -> SqlResult<Script> {
    let current = get_script(conn, id)?;
    let ts = now();
    conn.execute(
        "UPDATE scripts SET name = ?1, description = ?2, steps = ?3, updated_at = ?4 WHERE id = ?5",
        params![
            name.unwrap_or(&current.name),
            description.unwrap_or(&current.description),
            steps.unwrap_or(&current.steps),
            ts,
            id,
        ],
    )?;
    get_script(conn, id)
}

pub fn delete_script(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM scripts WHERE id = ?1", params![id])?;
    Ok(())
}

/// Seed built-in scripts if they don't already exist.
pub fn seed_built_in_scripts(conn: &Connection) -> SqlResult<()> {
    let built_ins = vec![
        (
            "code-check",
            "Code Check",
            "Run type-check and linter",
            r#"[{"type":"bash","name":"Type check","command":"npm run type-check"},{"type":"bash","name":"Lint","command":"npm run lint"}]"#,
        ),
        (
            "run-tests",
            "Run Tests",
            "Run the test suite",
            r#"[{"type":"bash","name":"Run tests","command":"npm test"}]"#,
        ),
        (
            "create-pr",
            "Create PR",
            "Create a pull request from the task branch",
            r#"[{"type":"bash","name":"Push branch","command":"git push -u origin HEAD"},{"type":"bash","name":"Create PR","command":"gh pr create --title '{task.title}' --fill"}]"#,
        ),
        (
            "ai-code-review",
            "AI Code Review",
            "Agent reviews the diff and suggests improvements",
            r#"[{"type":"agent","name":"Review code","prompt":"Review the changes on this branch. Check for bugs, security issues, and code quality. Suggest improvements.\n\nTask: {task.title}\n{task.description}","model":"sonnet"}]"#,
        ),
        (
            "full-pipeline",
            "Full Pipeline",
            "Type-check, test, lint, then create PR",
            r#"[{"type":"bash","name":"Type check","command":"npm run type-check"},{"type":"bash","name":"Tests","command":"npm test"},{"type":"check","name":"Lint clean","command":"npm run lint","failMessage":"Lint errors found"},{"type":"bash","name":"Create PR","command":"gh pr create --title '{task.title}' --fill"}]"#,
        ),
    ];

    for (id, name, description, steps) in built_ins {
        // Only insert if not already present (idempotent)
        let exists: bool = conn
            .prepare("SELECT COUNT(*) FROM scripts WHERE id = ?1")?
            .query_row(params![id], |row| row.get::<_, i64>(0))
            .map(|count| count > 0)?;

        if !exists {
            let ts = now();
            conn.execute(
                "INSERT INTO scripts (id, name, description, steps, is_built_in, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)",
                params![id, name, description, steps, ts, ts],
            )?;
        }
    }

    Ok(())
}
