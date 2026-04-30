import { useMemo, useState } from 'react'
import type { Label } from '@/types'
import { useLabelStore } from '@/stores/label-store'

const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899']
const DEFAULT_COLOR = '#ef4444'

type LabelBoardHeaderProps = {
  workspaceId: string
}

export function LabelBoardHeader({ workspaceId }: LabelBoardHeaderProps) {
  const labels = useLabelStore((s) => s.labels)
  const selectedLabelId = useLabelStore((s) => s.selectedLabelId)
  const setSelectedLabelId = useLabelStore((s) => s.setSelectedLabelId)
  const createLabel = useLabelStore((s) => s.create)
  const updateLabel = useLabelStore((s) => s.update)
  const deleteLabel = useLabelStore((s) => s.remove)

  const [draftName, setDraftName] = useState('')
  const [draftColor, setDraftColor] = useState(DEFAULT_COLOR)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingColor, setEditingColor] = useState(DEFAULT_COLOR)

  const editingLabel = useMemo(
    () => labels.find((label) => label.id === editingId) ?? null,
    [labels, editingId],
  )

  const startEdit = (label: Label) => {
    setEditingId(label.id)
    setEditingName(label.name)
    setEditingColor(label.color)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditingName('')
    setEditingColor(DEFAULT_COLOR)
  }

  const handleCreate = async () => {
    const name = draftName.trim()
    if (!name) return
    await createLabel(workspaceId, name, draftColor)
    setDraftName('')
  }

  const handleSave = async () => {
    if (!editingLabel) return
    const name = editingName.trim()
    if (!name) return
    await updateLabel(editingLabel.id, { name, color: editingColor })
    cancelEdit()
  }

  const handleDelete = async () => {
    if (!editingLabel) return
    await deleteLabel(editingLabel.id)
    cancelEdit()
  }

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border-default bg-bg px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => { setSelectedLabelId(null) }}
          style={{ cursor: 'pointer' }}
          className={`shrink-0 rounded border px-2 py-1 text-xs ${
            selectedLabelId === null
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-border-default text-text-secondary hover:bg-surface-hover'
          }`}
        >
          All
        </button>
        {labels.map((label) => (
          <button
            key={label.id}
            type="button"
            onClick={() => { setSelectedLabelId(selectedLabelId === label.id ? null : label.id) }}
            onDoubleClick={() => { startEdit(label) }}
            style={{ cursor: 'pointer' }}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded border px-2 py-1 text-xs ${
              selectedLabelId === label.id
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border-default text-text-secondary hover:bg-surface-hover'
            }`}
            title="Double-click to edit"
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: label.color }} />
            {label.name}
          </button>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {COLORS.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => { editingId ? setEditingColor(color) : setDraftColor(color) }}
            style={{ cursor: 'pointer', backgroundColor: color }}
            className={`h-5 w-5 rounded-full border ${
              (editingId ? editingColor : draftColor) === color ? 'border-text-primary' : 'border-transparent'
            }`}
            aria-label={`Use label color ${color}`}
          />
        ))}
        <input
          value={editingId ? editingName : draftName}
          onChange={(e) => { editingId ? setEditingName(e.target.value) : setDraftName(e.target.value) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void (editingId ? handleSave() : handleCreate())
            if (e.key === 'Escape' && editingId) cancelEdit()
          }}
          placeholder={editingId ? 'Edit label' : 'New label'}
          className="h-7 w-28 rounded border border-border-default bg-surface px-2 text-xs text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => { void (editingId ? handleSave() : handleCreate()) }}
          disabled={!(editingId ? editingName : draftName).trim()}
          style={{ cursor: (editingId ? editingName : draftName).trim() ? 'pointer' : 'default' }}
          className="h-7 rounded bg-accent px-2 text-xs font-medium text-bg disabled:opacity-50"
        >
          {editingId ? 'Save' : 'Add'}
        </button>
        {editingId && (
          <>
            <button
              type="button"
              onClick={cancelEdit}
              style={{ cursor: 'pointer' }}
              className="h-7 rounded border border-border-default px-2 text-xs text-text-secondary hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { void handleDelete() }}
              style={{ cursor: 'pointer' }}
              className="h-7 rounded bg-error px-2 text-xs font-medium text-white"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  )
}
