# T002: Database Schema & Migrations

## Summary

Set up SQLite via rusqlite with the full data model from PRODUCT.md. Create the schema, migration system, and basic DB connection management. This is the data foundation for all backend CRUD operations.

## Acceptance Criteria

- [ ] SQLite database created at `~/.bentoya/data.db` on first run
- [ ] `~/.bentoya/` directory auto-created if missing
- [ ] Schema includes all v0.1 tables: `workspaces`, `columns`, `tasks`, `agent_sessions`
- [ ] Migration system: numbered SQL files in `src-tauri/src/db/migrations/`
- [ ] Migrations run automatically on app startup (idempotent)
- [ ] DB connection pool or singleton accessible from Tauri commands
- [ ] All columns from PRODUCT.md data model present (workspace, column, task, agent_session)
- [ ] UUID generation for primary keys (use `uuid` crate)
- [ ] Timestamps stored as ISO 8601 strings
- [ ] JSON columns stored as TEXT with serde serialization
- [ ] Foreign key constraints enabled (`PRAGMA foreign_keys = ON`)
- [ ] Basic CRUD helper functions: `insert`, `get_by_id`, `list`, `update`, `delete` for each table
- [ ] Unit tests for schema creation and basic CRUD

## Dependencies

- T001 (project scaffolding)

## Can Parallelize With

- T004 (PTY manager), T005 (Git manager), T007 (frontend types/stores)

## Key Files

```
src-tauri/src/
  db/
    mod.rs              # Connection management, init, migration runner
    schema.rs           # Table definitions as SQL strings
    migrations/
      001_initial.sql   # Full v0.1 schema
  lib.rs                # Register db module
```

## Complexity

**M** — Straightforward schema work, but careful typing needed for JSON columns.

## Notes

- Use `rusqlite` with `bundled` feature (bundles SQLite, no system dependency)
- Add `uuid` crate with `v4` feature for ID generation
- Don't include `chat_messages` or `settings` tables yet — those come in v0.2+
- The `agent_sessions` table needs to store PTY state for reconnection
- `tasks.files_touched` is a JSON array of strings
- `tasks.checklist` is nullable JSON — not needed for v0.1 but keep the column
- Consider WAL mode for better concurrent read performance: `PRAGMA journal_mode=WAL`
- Keep schema.rs as the source of truth — migration files should match
