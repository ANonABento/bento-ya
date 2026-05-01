import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { Task } from '@/types'
import { useLabelStore } from '@/stores/label-store'
import { useTaskStore } from '@/stores/task-store'

type TaskLabelPickerProps = {
  task: Task
}

export function TaskLabelPicker({ task }: TaskLabelPickerProps) {
  const labels = useLabelStore((s) => s.labels)
  const setTaskLabels = useTaskStore((s) => s.setLabels)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedIds = useMemo(() => new Set((task.labels ?? []).map((label) => label.id)), [task.labels])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => { document.removeEventListener('pointerdown', handlePointerDown) }
  }, [open])

  function stopCardEvent(event: ReactMouseEvent) {
    event.preventDefault()
    event.stopPropagation()
  }

  function toggleLabel(labelId: string) {
    const next = new Set(selectedIds)
    if (next.has(labelId)) {
      next.delete(labelId)
    } else {
      next.add(labelId)
    }
    void setTaskLabels(task.id, [...next])
  }

  return (
    <div
      ref={containerRef}
      className="relative"
      onClick={(event) => { event.stopPropagation() }}
      onPointerDown={stopCardEvent}
    >
      <button
        type="button"
        onClick={(event) => {
          stopCardEvent(event)
          setOpen((current) => !current)
        }}
        style={{ cursor: 'pointer' }}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-text-secondary/60 transition-colors hover:bg-surface-hover hover:text-text-primary"
        title="Edit labels"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
          <path d="M2.5 4.5V3A1.5 1.5 0 0 1 4 1.5h1.5L13 9l-4 4-7.5-7.5Z" strokeLinejoin="round" />
          <path d="M4.75 4.75h.01" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-6 z-40 w-52 rounded border border-border-default bg-surface p-2 shadow-xl">
          <div className="mb-1 px-1 text-[10px] font-medium uppercase text-text-secondary/70">Labels</div>
          {labels.length === 0 ? (
            <div className="px-1 py-2 text-xs text-text-secondary">Create labels in the board header.</div>
          ) : (
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {labels.map((label) => (
                <button
                  key={label.id}
                  type="button"
                  onClick={(event) => {
                    stopCardEvent(event)
                    toggleLabel(label.id)
                  }}
                  style={{ cursor: 'pointer' }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
                >
                  <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${
                    selectedIds.has(label.id) ? 'border-accent bg-accent text-bg' : 'border-border-default'
                  }`}>
                    {selectedIds.has(label.id) && (
                      <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                        <path d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3A.75.75 0 0 1 4.53 7.97l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" />
                      </svg>
                    )}
                  </span>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: label.color }} />
                  <span className="min-w-0 flex-1 truncate">{label.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
