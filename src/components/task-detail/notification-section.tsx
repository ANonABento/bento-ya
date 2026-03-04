import { useState, useCallback, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Task } from '@/types'

type NotificationSectionProps = {
  task: Task
  onUpdate?: (task: Task) => void
}

function parseStakeholders(json: string | null): string[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (Array.isArray(parsed)) {
      return parsed.filter((s): s is string => typeof s === 'string')
    }
    return []
  } catch {
    return []
  }
}

function formatDate(isoString: string | null): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function NotificationSection({ task, onUpdate }: NotificationSectionProps) {
  const [editMode, setEditMode] = useState(false)
  const [stakeholderInput, setStakeholderInput] = useState('')
  const [sending, setSending] = useState(false)

  const stakeholders = useMemo(() => parseStakeholders(task.notifyStakeholders), [task.notifyStakeholders])
  const isSent = Boolean(task.notificationSentAt)

  const handleAddStakeholder = useCallback(() => {
    const trimmed = stakeholderInput.trim()
    if (!trimmed) return

    const newList = [...stakeholders, trimmed]
    const json = JSON.stringify(newList)

    void invoke<Task>('update_task_stakeholders', { id: task.id, stakeholders: json })
      .then((updated) => {
        onUpdate?.(updated)
        setStakeholderInput('')
      })
      .catch((err: unknown) => {
        console.error('Failed to update stakeholders:', err)
      })
  }, [task.id, stakeholders, stakeholderInput, onUpdate])

  const handleRemoveStakeholder = useCallback((index: number) => {
    const newList = stakeholders.filter((_, i) => i !== index)
    const json = newList.length > 0 ? JSON.stringify(newList) : null

    void invoke<Task>('update_task_stakeholders', { id: task.id, stakeholders: json })
      .then((updated) => {
        onUpdate?.(updated)
      })
      .catch((err: unknown) => {
        console.error('Failed to update stakeholders:', err)
      })
  }, [task.id, stakeholders, onUpdate])

  const handleMarkSent = useCallback(() => {
    setSending(true)
    void invoke<Task>('mark_notification_sent', { id: task.id })
      .then((updated) => {
        onUpdate?.(updated)
      })
      .catch((err: unknown) => {
        console.error('Failed to mark notification sent:', err)
      })
      .finally(() => {
        setSending(false)
      })
  }, [task.id, onUpdate])

  const handleClearSent = useCallback(() => {
    void invoke<Task>('clear_notification_sent', { id: task.id })
      .then((updated) => {
        onUpdate?.(updated)
      })
      .catch((err: unknown) => {
        console.error('Failed to clear notification:', err)
      })
  }, [task.id, onUpdate])

  return (
    <div className="rounded-lg border border-border-default bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary">
          Notification
        </h4>
        {isSent && (
          <span className="flex items-center gap-1 text-[10px] text-green-500">
            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
              <path d="M10.28 2.28a.75.75 0 00-1.06-1.06L4.5 5.94 2.78 4.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l5.25-5.25z" />
            </svg>
            Sent {formatDate(task.notificationSentAt)}
          </span>
        )}
      </div>

      {/* Stakeholders list */}
      <div className="mb-3">
        <div className="mb-1.5 text-[10px] text-text-secondary">Notify:</div>
        {stakeholders.length === 0 ? (
          <div className="text-xs italic text-text-muted">No stakeholders configured</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {stakeholders.map((s, i) => (
              <div
                key={`${s}-${String(i)}`}
                className="group flex items-center gap-1 rounded bg-bg-tertiary px-2 py-0.5 text-xs text-text-primary"
              >
                <span>{s}</span>
                {editMode && (
                  <button
                    type="button"
                    onClick={() => { handleRemoveStakeholder(i) }}
                    className="ml-1 text-text-muted hover:text-red-400"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M3 3l6 6M9 3L3 9" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add stakeholder input */}
      {editMode && (
        <div className="mb-3 flex gap-2">
          <input
            type="text"
            value={stakeholderInput}
            onChange={(e) => { setStakeholderInput(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAddStakeholder()
              }
            }}
            placeholder="Name or email..."
            className="flex-1 rounded border border-border-default bg-bg-primary px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAddStakeholder}
            className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover"
          >
            Add
          </button>
        </div>
      )}

      {/* Context section - PR info */}
      {task.prUrl && (
        <div className="mb-3 rounded border border-border-default bg-bg-tertiary p-2">
          <div className="mb-1 text-[10px] text-text-secondary">Related PR:</div>
          <a
            href={task.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent hover:underline"
          >
            #{String(task.prNumber)} - {task.title}
          </a>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => { setEditMode(!editMode) }}
          className="rounded border border-border-default px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary"
        >
          {editMode ? 'Done Editing' : 'Edit Recipients'}
        </button>

        {!isSent ? (
          <button
            type="button"
            onClick={handleMarkSent}
            disabled={sending || stakeholders.length === 0}
            className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? 'Sending...' : 'Mark as Notified'}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleClearSent}
            className="rounded border border-border-default px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  )
}
