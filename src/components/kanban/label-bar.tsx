import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Label } from '@/types'
import { useLabelStore } from '@/stores/label-store'

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899']

type LabelBarProps = {
  workspaceId: string
  selectedLabelId: string | null
  onSelectLabel: (labelId: string | null) => void
}

export function LabelBar({ workspaceId, selectedLabelId, onSelectLabel }: LabelBarProps) {
  const labels = useLabelStore((s) => s.labels)
  const addLabel = useLabelStore((s) => s.add)
  const updateLabel = useLabelStore((s) => s.update)
  const removeLabel = useLabelStore((s) => s.remove)
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[5] ?? '#3b82f6')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingColor, setEditingColor] = useState(color)

  const selectedLabel = useMemo(
    () => labels.find((label) => label.id === selectedLabelId) ?? null,
    [labels, selectedLabelId],
  )

  useEffect(() => {
    if (selectedLabelId && !selectedLabel) {
      onSelectLabel(null)
    }
  }, [onSelectLabel, selectedLabel, selectedLabelId])

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    await addLabel(workspaceId, name.trim(), color)
    setName('')
  }

  function startEditing(label: Label) {
    setEditingId(label.id)
    setEditingName(label.name)
    setEditingColor(label.color)
  }

  async function saveEditing() {
    if (!editingId || !editingName.trim()) return
    await updateLabel(editingId, { name: editingName.trim(), color: editingColor })
    setEditingId(null)
  }

  async function deleteEditing() {
    if (!editingId) return
    if (selectedLabelId === editingId) onSelectLabel(null)
    await removeLabel(editingId)
    setEditingId(null)
  }

  return (
    <div className="flex min-h-12 items-center gap-2 border-b border-border-default bg-bg px-3">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        <button
          type="button"
          onClick={() => { onSelectLabel(null) }}
          style={{ cursor: 'pointer' }}
          className={`shrink-0 rounded border px-2 py-1 text-xs transition-colors ${
            selectedLabelId === null
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-border-default text-text-secondary hover:border-accent/50'
          }`}
        >
          All tasks
        </button>
        {labels.map((label) => (
          <button
            key={label.id}
            type="button"
            onClick={() => { onSelectLabel(label.id) }}
            onDoubleClick={() => { startEditing(label) }}
            style={{ cursor: 'pointer' }}
            className={`flex shrink-0 items-center gap-1.5 rounded border px-2 py-1 text-xs transition-colors ${
              selectedLabelId === label.id
                ? 'border-accent bg-accent/10 text-text-primary'
                : 'border-border-default text-text-secondary hover:border-accent/50 hover:text-text-primary'
            }`}
            title="Double-click to edit"
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: label.color }} />
            <span>{label.name}</span>
          </button>
        ))}
      </div>

      <form onSubmit={(event) => { void handleCreate(event) }} className="flex shrink-0 items-center gap-1">
        <input
          value={name}
          onChange={(event) => { setName(event.target.value) }}
          placeholder="New label"
          className="h-7 w-28 rounded border border-border-default bg-surface px-2 text-xs text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
        />
        <input
          type="color"
          value={color}
          onChange={(event) => { setColor(event.target.value) }}
          aria-label="Label color"
          className="h-7 w-8 rounded border border-border-default bg-surface"
          style={{ cursor: 'pointer' }}
        />
        <button
          type="submit"
          disabled={!name.trim()}
          style={{ cursor: name.trim() ? 'pointer' : 'not-allowed' }}
          className="h-7 rounded bg-accent px-2 text-xs font-medium text-bg disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setEditingId(null) }}>
          <div
            className="w-full max-w-xs rounded border border-border-default bg-surface p-4 shadow-xl"
            onClick={(event) => { event.stopPropagation() }}
          >
            <h3 className="mb-3 text-sm font-semibold text-text-primary">Edit label</h3>
            <div className="space-y-2">
              <input
                value={editingName}
                onChange={(event) => { setEditingName(event.target.value) }}
                className="w-full rounded border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              />
              <input
                type="color"
                value={editingColor}
                onChange={(event) => { setEditingColor(event.target.value) }}
                className="h-9 w-full rounded border border-border-default bg-bg"
                style={{ cursor: 'pointer' }}
              />
            </div>
            <div className="mt-4 flex justify-between gap-2">
              <button
                type="button"
                onClick={() => { void deleteEditing() }}
                style={{ cursor: 'pointer' }}
                className="rounded px-3 py-1.5 text-sm text-error hover:bg-error/10"
              >
                Delete
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setEditingId(null) }}
                  style={{ cursor: 'pointer' }}
                  className="rounded px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-hover"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { void saveEditing() }}
                  style={{ cursor: 'pointer' }}
                  className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-bg"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
