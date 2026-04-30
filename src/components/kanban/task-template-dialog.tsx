import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { useTaskTemplateStore } from '@/stores/task-template-store'

type TaskTemplateDialogProps = {
  workspaceId: string
  columnId: string
  onClose: () => void
}

function labelsToText(labels: string) {
  try {
    const parsed = JSON.parse(labels) as string[]
    return parsed.join(', ')
  } catch {
    return ''
  }
}

function textToLabels(text: string) {
  return JSON.stringify(
    text
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean),
  )
}

export function TaskTemplateDialog({ workspaceId, columnId, onClose }: TaskTemplateDialogProps) {
  const rawTemplates = useTaskTemplateStore((s) => s.templates)
  const loadedWorkspaceId = useTaskTemplateStore((s) => s.loadedWorkspaceId)
  const load = useTaskTemplateStore((s) => s.load)
  const update = useTaskTemplateStore((s) => s.update)
  const remove = useTaskTemplateStore((s) => s.remove)
  const createTask = useTaskTemplateStore((s) => s.createTask)

  const templates = loadedWorkspaceId === workspaceId
    ? rawTemplates.filter((template) => template.workspaceId === workspaceId)
    : []

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [labels, setLabels] = useState('')
  const [model, setModel] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loadedWorkspaceId !== workspaceId) {
      void load(workspaceId)
    }
  }, [load, loadedWorkspaceId, workspaceId])

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? null,
    [selectedId, templates],
  )

  useEffect(() => {
    const next = selected ?? templates[0] ?? null
    if (!next) return
    if (next.id === selectedId) return
    setSelectedId(next.id)
  }, [selected, selectedId, templates])

  useEffect(() => {
    if (!selected) return
    setTitle(selected.title)
    setDescription(selected.description ?? '')
    setLabels(labelsToText(selected.labels))
    setModel(selected.model ?? '')
    setError(null)
  }, [selected])

  const handleSave = async () => {
    if (!selected) return false
    if (!title.trim()) {
      setError('Template title is required.')
      return false
    }
    try {
      await update(selected.id, {
        title: title.trim(),
        description: description.trim() || null,
        labels: textToLabels(labels),
        model: model.trim() || null,
      })
      setError(null)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template.')
      return false
    }
  }

  const handleCreate = async () => {
    if (!selected) return
    try {
      const saved = await handleSave()
      if (!saved) return
      await createTask(selected.id, columnId)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task.')
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    await remove(selected.id)
    const remaining = templates.filter((template) => template.id !== selected.id)
    setSelectedId(remaining[0]?.id ?? null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="flex max-h-[80vh] w-[720px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border-default bg-surface shadow-xl"
        onClick={(event) => { event.stopPropagation() }}
      >
        <div className="w-64 border-r border-border-default">
          <div className="border-b border-border-default px-3 py-2">
            <h3 className="text-sm font-medium text-text-primary">Task Templates</h3>
          </div>
          <div className="max-h-[calc(80vh-42px)] overflow-y-auto p-2">
            {templates.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-text-secondary">
                Save a task as a template first.
              </p>
            ) : templates.map((template) => (
              <button
                key={template.id}
                onClick={() => { setSelectedId(template.id) }}
                className={`mb-1 w-full rounded px-2 py-2 text-left text-sm ${
                  selectedId === template.id
                    ? 'bg-accent/15 text-text-primary'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                }`}
              >
                <span className="block truncate">{template.title}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-1 flex-col">
          <div className="border-b border-border-default px-4 py-3">
            <h3 className="text-sm font-medium text-text-primary">New From Template</h3>
          </div>

          {selected ? (
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {error && (
                <div className="rounded border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                  {error}
                </div>
              )}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-secondary">Title</span>
                <input
                  value={title}
                  onChange={(event) => { setTitle(event.target.value) }}
                  className="w-full rounded border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-secondary">Description</span>
                <textarea
                  value={description}
                  onChange={(event) => { setDescription(event.target.value) }}
                  rows={5}
                  className="w-full resize-none rounded border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-secondary">Labels</span>
                <input
                  value={labels}
                  onChange={(event) => { setLabels(event.target.value) }}
                  placeholder="bug, frontend"
                  className="w-full rounded border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-secondary">Model</span>
                <input
                  value={model}
                  onChange={(event) => { setModel(event.target.value) }}
                  placeholder="Default"
                  className="w-full rounded border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                />
              </label>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-text-secondary">
              No templates yet
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border-default p-3">
            <button
              onClick={() => { void handleDelete() }}
              disabled={!selected}
              className="rounded px-3 py-1.5 text-sm text-error hover:bg-error/10 disabled:opacity-40"
            >
              Delete
            </button>
            <div className="flex gap-2">
              <button onClick={onClose} className="rounded px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-hover">
                Cancel
              </button>
              <button
                onClick={() => { void handleSave() }}
                disabled={!selected}
                className="rounded border border-border-default px-3 py-1.5 text-sm text-text-primary hover:bg-surface-hover disabled:opacity-40"
              >
                Save
              </button>
              <button
                onClick={() => { void handleCreate() }}
                disabled={!selected}
                className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-40"
              >
                Create Task
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
