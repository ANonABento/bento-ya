import { useMemo, useState } from 'react'
import type { Label } from '@/types'
import { useLabelStore } from '@/stores/label-store'

const EMPTY_LABEL_IDS: string[] = []

type TaskLabelPickerProps = {
  taskId: string
  labels: Label[]
}

export function TaskLabelPicker({ taskId, labels }: TaskLabelPickerProps) {
  const allLabels = useLabelStore((s) => s.labels)
  const taskLabelIds = useLabelStore((s) => s.taskLabels[taskId])
  const setTaskLabels = useLabelStore((s) => s.setTaskLabels)
  const [open, setOpen] = useState(false)

  const labelIds = taskLabelIds ?? EMPTY_LABEL_IDS
  const selectedIds = useMemo(() => new Set(labelIds), [labelIds])

  const toggleLabel = async (labelId: string) => {
    const next = selectedIds.has(labelId)
      ? labelIds.filter((id) => id !== labelId)
      : [...labelIds, labelId]
    await setTaskLabels(taskId, next)
  }

  return (
    <div
      className="relative"
      onClick={(e) => { e.stopPropagation() }}
      onPointerDown={(e) => { e.stopPropagation() }}
    >
      <button
        type="button"
        onClick={() => { setOpen((value) => !value) }}
        style={{ cursor: 'pointer' }}
        className="inline-flex h-5 w-5 items-center justify-center rounded border border-border-default text-[13px] leading-none text-text-secondary hover:border-accent hover:text-accent"
        title="Labels"
        aria-label="Labels"
      >
        +
      </button>

      {open && (
        <div className="absolute right-0 top-6 z-30 w-48 rounded border border-border-default bg-surface p-2 shadow-xl">
          {allLabels.length === 0 ? (
            <p className="px-1 py-1 text-xs text-text-secondary">No labels</p>
          ) : (
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {allLabels.map((label) => (
                <label
                  key={label.id}
                  className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-text-primary hover:bg-surface-hover"
                  style={{ cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(label.id)}
                    onChange={() => { void toggleLabel(label.id) }}
                    className="h-3 w-3"
                  />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: label.color }} />
                  <span className="min-w-0 flex-1 truncate">{label.name}</span>
                </label>
              ))}
            </div>
          )}
          {labels.length > 0 && (
            <button
              type="button"
              onClick={() => { void setTaskLabels(taskId, []) }}
              style={{ cursor: 'pointer' }}
              className="mt-2 w-full rounded px-2 py-1 text-left text-xs text-text-secondary hover:bg-surface-hover"
            >
              Clear labels
            </button>
          )}
        </div>
      )}
    </div>
  )
}
