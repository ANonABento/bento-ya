# Spec — Checklist as Per-Workspace Roadmap (+ MCP/HTTP surface)

> Status: **PLANNED, not started** (deferred 2026-06-12 — "more critical things first").
> Owner: TBD. Effort: ~1 day (routes + MCP tools + tests + rebuild).

## Goal

Repurpose the existing **checklist** feature as a high-level, per-workspace
**project roadmap** that both the human (UI) and agents (MCP) can read and
maintain. Today the checklist is a release-readiness widget with *no* agent
surface; this spec closes that gap without inventing a new feature.

## Why checklist (not pipeline templates)

They are genuinely different things (verified 2026-06-12):

| | Pipeline Template | **Checklist** |
|---|---|---|
| Scope | Global, stateless blueprint | **Already per-workspace** (1 per ws) |
| Captures | Column names/icons/triggers | Categories → items + state |
| Item state | — | `checked`, `notes`, `position`, `linked_task_id`, auto-detect |
| Agent surface | 3 MCP tools | **none** |

The checklist is already workspace-scoped, ordered, supports notes, can **link an
item to a board task** (`linked_task_id`), and can **auto-detect** completion from
repo state (file-exists / file-contains / file-absent / command-succeeds). That is
a near-perfect roadmap primitive — it just isn't reachable by agents.

## Current state (what exists)

- **DB** (`src-tauri/src/db/checklist.rs`): full CRUD already implemented as
  `(conn, …)` functions — `insert_checklist`, `get_workspace_checklist`,
  `insert_checklist_category`, `list_checklist_categories`,
  `insert_checklist_item`, `list_checklist_items`, `update_checklist_item`
  (toggle `checked`), `update_checklist_item_details`, `delete_checklist_item`,
  `link_checklist_item_to_task`, `create_checklist_item_with_detect`, …
- **Tauri commands** (`src-tauri/src/commands/checklist.rs`): 15 commands wrapping
  the above (used by the UI).
- **Tables** (migration `005_checklists.sql`, `019_checklist_autodetect.sql`):
  `checklists(workspace_id)`, `checklist_categories(checklist_id, name, icon,
  position)`, `checklist_items(category_id, text, checked, notes, position,
  detect_type, detect_config, auto_detected, linked_task_id)`.

## Gap

- **Zero `/api/*` routes** for checklist. MCP mutation tools route through
  `/api/*`, so nothing is reachable from MCP today.
- **Zero MCP tools.**
- One structural constraint: **exactly one checklist per workspace**
  (`commands/checklist.rs:134`). Fine for a *single* roadmap per project; only a
  blocker if we later want multiple named roadmaps per workspace.

## Design

Mirror the established `create_column` pattern exactly: an `/api/*` handler that
takes `AxumState<Arc<ApiState>>`, grabs a conn via `get_db!(api)`, calls the
`db::checklist::*` fn directly, then emits an event and returns `ok_response`.
Add a new event `checklist:changed { workspaceId }` (typed struct,
`#[serde(rename_all = "camelCase")]`) + a `useChecklistSync` hook so UI refreshes
live when an agent edits the roadmap.

### New HTTP routes (`src-tauri/src/api.rs`, registered in the `protected` router ~L893)

| Route | Calls | Notes |
|---|---|---|
| `GET  /api/checklist?workspace_id=` | `get_workspace_checklist` + categories + items | read; returns full nested roadmap |
| `POST /api/checklist/ensure` | `insert_checklist` if absent | idempotent; create-on-first-use |
| `POST /api/checklist/category` | `insert_checklist_category` | add roadmap phase |
| `POST /api/checklist/item` | `insert_checklist_item` / `create_checklist_item_with_detect` | add milestone (optional auto-detect) |
| `POST /api/checklist/item/update` | `update_checklist_item` (toggle) + `update_checklist_item_details` (text/notes) + `link_checklist_item_to_task` | the workhorse |
| `POST /api/checklist/item/delete` | `delete_checklist_item` | |

All request structs `#[derive(Deserialize)]` snake_case (match existing API
convention — note: the API request structs are snake_case, e.g. `MoveTaskReq`
uses `id`/`target_column_id`, *not* camelCase).

### New MCP tools (`mcp-server/src/main.rs`)

| Tool | Route | Scope |
|---|---|---|
| `get_checklist` | `GET /api/checklist` | read-only — works without app |
| `checklist_update` | `POST /api/checklist/item/update` | toggle done / edit text / link task |
| `checklist_add_item` | `POST /api/checklist/item` | add milestone |
| `checklist_add_category` | `POST /api/checklist/category` | add phase |

Read-only `get_checklist` should also support the test-only direct-DB fallback
(like the other read tools); mutations require the running app (`/api/*`).

### Phasing

1. **P1 (minimal, unblocks roadmap):** `GET /api/checklist` + `POST
   /api/checklist/item/update` → MCP `get_checklist` + `checklist_update`.
   Agents can read the roadmap and tick milestones.
2. **P2 (agent-maintainable):** add category + item create/delete routes + tools.
   Agents can build/restructure the roadmap.
3. **P3 (optional):** drop the 1-per-workspace constraint + add a `name` column to
   `checklists` for multiple named roadmaps per workspace (migration after 047).
   Only if multi-roadmap is wanted.

### Tests

- MCP: extend `mcp-server/src/main.rs` test module (currently 18 tests) with a
  `test_checklist_update_*` round-trip against the test-DB fallback.
- API: a handler test if the api.rs test harness supports it; otherwise rely on
  the MCP round-trip + a manual smoke test after rebuild.

## Open decisions (for whoever picks this up)

- **Single vs multiple roadmaps per workspace** — P3 above. Default: keep single
  (zero schema change) until there's a concrete need.
- **Auto-detect as roadmap signal** — should `checklist_update` allow agents to
  set `detect_config` so a milestone self-checks from repo state? Powerful for a
  roadmap ("done when `cargo test` passes"), but lets agents wire shell commands.
  Default: P2 read-only on detect; no agent-set detect until reviewed.
