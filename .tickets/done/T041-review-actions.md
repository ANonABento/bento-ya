# T041: Review Actions (Approve/Reject)

## Summary

The Review column has approve/reject buttons in the task detail panel that don't do anything. Wire them up to the pipeline state machine.

## Current State

From task detail panel (or review column card):
- "Approve" button exists but onClick does nothing
- "Reject" button exists but onClick does nothing

These should trigger pipeline state changes and potentially auto-advance.

## Acceptance Criteria

- [ ] **Approve button**:
  - [ ] Set task's `review_status` to "approved"
  - [ ] If exit_type = "manual_approval", trigger `mark_complete(task_id, true)`
  - [ ] If auto_advance enabled, move to next column
  - [ ] Show success toast
  - [ ] Update card UI to show approved state

- [ ] **Reject button**:
  - [ ] Prompt for rejection reason (required)
  - [ ] Set task's `review_status` to "rejected"
  - [ ] Set `pipeline_error` with rejection reason
  - [ ] Move task back to previous column (or configurable column)
  - [ ] Create follow-up attention item
  - [ ] Show rejection in task history

- [ ] **Review UI updates**:
  - [ ] Show current review status on task card
  - [ ] Show reviewer name and timestamp
  - [ ] Allow re-review after rejection fixes

## Technical Implementation

### Backend Commands

```rust
// src-tauri/src/commands/review.rs

#[tauri::command]
pub async fn approve_task(
    state: State<'_, AppState>,
    task_id: i64,
) -> Result<(), String> {
    let conn = state.db.lock().unwrap();

    // Update review status
    conn.execute(
        "UPDATE tasks SET review_status = 'approved', reviewed_at = ?1, reviewed_by = 'user' WHERE id = ?2",
        params![Utc::now().to_rfc3339(), task_id],
    )?;

    // Check if this satisfies exit criteria
    let task = get_task(&conn, task_id)?;
    let column = get_column(&conn, task.column_id)?;

    if let Some(exit_config) = &column.exit_config {
        let config: ExitConfig = serde_json::from_str(exit_config)?;
        if config.exit_type == "manual_approval" {
            pipeline::mark_complete(&conn, &state.app_handle, task_id, true)?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn reject_task(
    state: State<'_, AppState>,
    task_id: i64,
    reason: String,
    return_to_column: Option<i64>,
) -> Result<(), String> {
    let conn = state.db.lock().unwrap();

    // Update status
    conn.execute(
        "UPDATE tasks SET review_status = 'rejected', pipeline_error = ?1, reviewed_at = ?2 WHERE id = ?3",
        params![reason, Utc::now().to_rfc3339(), task_id],
    )?;

    // Move back to previous column
    let task = get_task(&conn, task_id)?;
    let target_column = return_to_column.unwrap_or_else(|| {
        // Find previous column by position
        get_previous_column(&conn, task.column_id).map(|c| c.id).unwrap_or(task.column_id)
    });

    move_task(&conn, task_id, target_column, 0)?;

    // Create attention item
    create_attention(&conn, task_id, "needs_revision", &reason)?;

    Ok(())
}
```

### Frontend

```tsx
// src/components/review/review-actions.tsx

export function ReviewActions({ task }: { task: Task }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const handleApprove = async () => {
    await ipc.approveTask(task.id);
    toast.success("Task approved");
  };

  const handleReject = async () => {
    if (!reason.trim()) {
      toast.error("Please provide a reason");
      return;
    }
    await ipc.rejectTask(task.id, reason);
    toast.info("Task sent back for revision");
    setRejecting(false);
  };

  if (task.reviewStatus === 'approved') {
    return <Badge variant="success">Approved</Badge>;
  }

  return (
    <div className="flex gap-2">
      <Button variant="success" onClick={handleApprove}>
        <CheckIcon /> Approve
      </Button>
      <Button variant="destructive" onClick={() => setRejecting(true)}>
        <XIcon /> Reject
      </Button>

      {rejecting && (
        <Dialog open onClose={() => setRejecting(false)}>
          <DialogTitle>Rejection Reason</DialogTitle>
          <Textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="What needs to be fixed?"
          />
          <DialogActions>
            <Button onClick={() => setRejecting(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject}>Reject</Button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}
```

## Database Changes

```sql
-- Already have review_status, but ensure these fields exist:
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS review_status TEXT;  -- null, 'approved', 'rejected'
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reviewed_at TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
```

## Exit Criteria Integration

Add new exit type in T034:
```rust
"manual_approval" => {
    task.review_status.as_ref().map(|s| s == "approved").unwrap_or(false)
}
```

## Files to Modify

| File | Changes |
|------|---------|
| `src-tauri/src/commands/review.rs` | NEW - Approve/reject commands |
| `src-tauri/src/commands/mod.rs` | Export review module |
| `src/lib/ipc.ts` | Add review IPC wrappers |
| `src/components/review/review-actions.tsx` | NEW or update existing |
| `src/components/kanban/task-card.tsx` | Show review status badge |
| `src-tauri/src/pipeline/evaluator.rs` | Add manual_approval exit type |

## Complexity

**S** - Straightforward CRUD, some pipeline integration

## Test Plan

1. Move task to Review column
2. Open task detail
3. Click "Approve" → verify status updates, task advances if configured
4. For rejection: click "Reject" → enter reason → verify task moves back
5. Verify attention badge appears after rejection
