import { useState, useCallback, useRef, useEffect } from 'react'
import type { Task, TaskChecklistItem } from '@/types'

type TaskChecklistProps = {
  task: Task
  onUpdate: (checklist: TaskChecklistItem[]) => void
}

type RawChecklistItem = { id?: string; text: string; checked?: boolean }

function parseChecklist(json: string | null): TaskChecklistItem[] {
  if (!json) return []
  try {
    const items = JSON.parse(json) as RawChecklistItem[]
    // Ensure each item has an id
    return items.map((item, idx) => ({
      id: item.id || `item-${String(idx)}-${String(Date.now())}`,
      text: item.text || '',
      checked: item.checked ?? false,
    }))
  } catch {
    return []
  }
}

function generateId(): string {
  return `item-${String(Date.now())}-${Math.random().toString(36).slice(2, 9)}`
}

export function TaskChecklist({ task, onUpdate }: TaskChecklistProps) {
  const [items, setItems] = useState<TaskChecklistItem[]>(() => parseChecklist(task.checklist))
  const [newItemText, setNewItemText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  // Sync with task checklist when it changes externally
  useEffect(() => {
    setItems(parseChecklist(task.checklist))
  }, [task.checklist])

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  const handleToggle = useCallback((id: string) => {
    const newItems = items.map(item =>
      item.id === id ? { ...item, checked: !item.checked } : item
    )
    setItems(newItems)
    onUpdate(newItems)
  }, [items, onUpdate])

  const handleAddItem = useCallback(() => {
    const text = newItemText.trim()
    if (!text) return

    const newItem: TaskChecklistItem = {
      id: generateId(),
      text,
      checked: false,
    }
    const newItems = [...items, newItem]
    setItems(newItems)
    setNewItemText('')
    onUpdate(newItems)
    inputRef.current?.focus()
  }, [newItemText, items, onUpdate])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddItem()
    }
  }, [handleAddItem])

  const handleStartEdit = useCallback((item: TaskChecklistItem) => {
    setEditingId(item.id)
    setEditText(item.text)
  }, [])

  const handleSaveEdit = useCallback(() => {
    if (!editingId) return
    const text = editText.trim()
    if (!text) {
      // If empty, delete the item
      const newItems = items.filter(item => item.id !== editingId)
      setItems(newItems)
      onUpdate(newItems)
    } else {
      const newItems = items.map(item =>
        item.id === editingId ? { ...item, text } : item
      )
      setItems(newItems)
      onUpdate(newItems)
    }
    setEditingId(null)
    setEditText('')
  }, [editingId, editText, items, onUpdate])

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      setEditingId(null)
      setEditText('')
    }
  }, [handleSaveEdit])

  const handleDeleteItem = useCallback((id: string) => {
    const newItems = items.filter(item => item.id !== id)
    setItems(newItems)
    onUpdate(newItems)
  }, [items, onUpdate])

  const checkedCount = items.filter(i => i.checked).length
  const totalCount = items.length
  const progressPercent = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0

  return (
    <div className="space-y-2">
      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-surface-hover rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                progressPercent === 100 ? 'bg-success' : 'bg-accent'
              }`}
              style={{ width: `${String(progressPercent)}%` }}
            />
          </div>
          <span className="text-[11px] text-text-secondary tabular-nums">
            {checkedCount}/{totalCount}
          </span>
        </div>
      )}

      {/* Checklist items */}
      <div className="space-y-1">
        {items.map((item) => (
          <div
            key={item.id}
            className="group flex items-start gap-2 rounded px-1 py-0.5 hover:bg-surface-hover"
          >
            <button
              type="button"
              onClick={() => { handleToggle(item.id) }}
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                item.checked
                  ? 'border-success bg-success text-white'
                  : 'border-border-default hover:border-accent'
              }`}
            >
              {item.checked && (
                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 6l3 3 5-6" />
                </svg>
              )}
            </button>

            {editingId === item.id ? (
              <input
                ref={editInputRef}
                type="text"
                value={editText}
                onChange={(e) => { setEditText(e.target.value) }}
                onBlur={handleSaveEdit}
                onKeyDown={handleEditKeyDown}
                className="flex-1 bg-transparent text-xs text-text-primary outline-none"
              />
            ) : (
              <span
                onClick={() => { handleStartEdit(item) }}
                className={`flex-1 text-xs leading-relaxed cursor-text ${
                  item.checked ? 'text-text-secondary line-through' : 'text-text-primary'
                }`}
              >
                {item.text}
              </span>
            )}

            <button
              type="button"
              onClick={() => { handleDeleteItem(item.id) }}
              className="opacity-0 group-hover:opacity-100 p-0.5 text-text-secondary hover:text-error transition-opacity"
              title="Delete item"
            >
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 3l6 6M9 3L3 9" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Add new item */}
      <div className="flex items-center gap-2 px-1">
        <span className="text-text-secondary">
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 5v6M5 8h6" />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="text"
          value={newItemText}
          onChange={(e) => { setNewItemText(e.target.value) }}
          onKeyDown={handleKeyDown}
          placeholder="Add test item..."
          className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-secondary/50 outline-none"
        />
        {newItemText.trim() && (
          <button
            type="button"
            onClick={handleAddItem}
            className="text-[11px] text-accent hover:text-accent/80"
          >
            Add
          </button>
        )}
      </div>

      {/* Empty state */}
      {items.length === 0 && !newItemText && (
        <p className="text-[11px] text-text-secondary/60 px-1">
          Add test items to verify before advancing this task.
        </p>
      )}
    </div>
  )
}
