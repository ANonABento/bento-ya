-- Pipeline templates: reusable column+trigger configurations applied across workspaces.
CREATE TABLE IF NOT EXISTS pipeline_templates (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    columns_json TEXT NOT NULL DEFAULT '[]',
    source_workspace_id TEXT,
    is_built_in INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_templates_name ON pipeline_templates(name);
