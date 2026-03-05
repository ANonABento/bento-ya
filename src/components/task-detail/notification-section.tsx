import { useState, useCallback } from 'react'
import {
  updateTaskStakeholders,
  markTaskNotificationSent,
  clearTaskNotificationSent,
} from '@/lib/ipc'
import { formatDateWithTime } from '@/lib/format-time'

type NotificationSectionProps = {
  taskId: string
  stakeholders: string | null // JSON array
  notificationSentAt: string | null
  onUpdate: () => void
}

export function NotificationSection({
  taskId,
  stakeholders,
  notificationSentAt,
  onUpdate,
}: NotificationSectionProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const stakeholderList: string[] = stakeholders ? JSON.parse(stakeholders) : []

  const handleAddStakeholder = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed) return

    setIsLoading(true)
    try {
      const newList = [...stakeholderList, trimmed]
      await updateTaskStakeholders(taskId, JSON.stringify(newList))
      setInput('')
      onUpdate()
    } finally {
      setIsLoading(false)
    }
  }, [taskId, input, stakeholderList, onUpdate])

  const handleRemoveStakeholder = useCallback(
    async (index: number) => {
      setIsLoading(true)
      try {
        const newList = stakeholderList.filter((_, i) => i !== index)
        await updateTaskStakeholders(
          taskId,
          newList.length > 0 ? JSON.stringify(newList) : null
        )
        onUpdate()
      } finally {
        setIsLoading(false)
      }
    },
    [taskId, stakeholderList, onUpdate]
  )

  const handleMarkNotified = useCallback(async () => {
    setIsLoading(true)
    try {
      await markTaskNotificationSent(taskId)
      onUpdate()
    } finally {
      setIsLoading(false)
    }
  }, [taskId, onUpdate])

  const handleClearNotified = useCallback(async () => {
    setIsLoading(true)
    try {
      await clearTaskNotificationSent(taskId)
      onUpdate()
    } finally {
      setIsLoading(false)
    }
  }, [taskId, onUpdate])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void handleAddStakeholder()
      } else if (e.key === 'Escape') {
        setIsEditing(false)
        setInput('')
      }
    },
    [handleAddStakeholder]
  )

  return (
    <div className="rounded-lg border border-border-default bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary">
          Notify
        </h4>
        <button
          type="button"
          onClick={() => setIsEditing(!isEditing)}
          className="text-[10px] text-accent hover:text-accent-hover"
        >
          {isEditing ? 'Done' : 'Edit'}
        </button>
      </div>

      {/* Stakeholder list */}
      {stakeholderList.length > 0 ? (
        <div className="mb-2 space-y-1">
          {stakeholderList.map((name, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between rounded bg-surface-hover px-2 py-1"
            >
              <span className="truncate text-xs text-text-primary">{name}</span>
              {isEditing && (
                <button
                  type="button"
                  onClick={() => void handleRemoveStakeholder(idx)}
                  disabled={isLoading}
                  className="ml-2 text-text-secondary hover:text-error disabled:opacity-50"
                >
                  <svg
                    className="h-3 w-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-2 text-xs text-text-secondary/70">
          No stakeholders added
        </p>
      )}

      {/* Add stakeholder input */}
      {isEditing && (
        <div className="mb-3 flex gap-1">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add name or email..."
            className="flex-1 rounded border border-border-default bg-surface-hover px-2 py-1 text-xs text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void handleAddStakeholder()}
            disabled={isLoading || !input.trim()}
            className="rounded bg-accent px-2 py-1 text-[10px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}

      {/* Notification status */}
      <div className="border-t border-border-default pt-2">
        {notificationSentAt ? (
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] text-success">Notified</span>
              <span className="ml-1 text-[10px] text-text-secondary">
                {formatDateWithTime(notificationSentAt)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleClearNotified()}
              disabled={isLoading}
              className="text-[10px] text-text-secondary hover:text-text-primary disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void handleMarkNotified()}
            disabled={isLoading || stakeholderList.length === 0}
            className="w-full rounded bg-surface-hover py-1.5 text-xs font-medium text-text-primary hover:bg-border-default disabled:cursor-not-allowed disabled:opacity-50"
          >
            {stakeholderList.length === 0
              ? 'Add stakeholders to notify'
              : 'Mark as Notified'}
          </button>
        )}
      </div>
    </div>
  )
}
