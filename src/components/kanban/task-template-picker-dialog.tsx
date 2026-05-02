import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import type { TaskTemplate } from '@/types'
import * as ipc from '@/lib/ipc'

type TaskTemplatePickerDialogProps = {
  workspaceId: string
  onClose: () => void
  onCreateTask: (templateId: string) => Promise<void>
}

type TemplateFormState = {
  editingId: string | null
  title: string
  description: string
  labels: string
  model: string
}

const emptyForm: TemplateFormState = {
  editingId: null,
  title: '',
  description: '',
  labels: '[]',
  model: '',
}

function validateLabels(labels: string): string | null {
  try {
    const parsed: unknown = JSON.parse(labels)
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return null
    }
  } catch {
    return 'Labels must be valid JSON.'
  }
  return 'Labels must be a JSON array of strings.'
}

export function TaskTemplatePickerDialog({
  workspaceId,
  onClose,
  onCreateTask,
}: TaskTemplatePickerDialogProps) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [form, setForm] = useState<TemplateFormState>(emptyForm)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadTemplates = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setTemplates(await ipc.listTaskTemplates(workspaceId))
    } catch (err) {
      console.error('[TaskTemplatePickerDialog] Failed to load task templates:', err)
      setTemplates([])
      setError('Could not load templates.')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  const resetForm = useCallback(() => {
    setForm(emptyForm)
    setError(null)
  }, [])

  const handleEdit = useCallback((template: TaskTemplate) => {
    setForm({
      editingId: template.id,
      title: template.title,
      description: template.description ?? '',
      labels: template.labels,
      model: template.model ?? '',
    })
    setError(null)
  }, [])

  const handleSave = useCallback(async () => {
    const title = form.title.trim()
    if (!title) {
      setError('Template title is required.')
      return
    }

    const labels = form.labels.trim() || '[]'
    const labelsError = validateLabels(labels)
    if (labelsError) {
      setError(labelsError)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const description = form.description.trim()
      const model = form.model.trim()
      if (form.editingId) {
        const nextTemplate = await ipc.updateTaskTemplate(form.editingId, {
          title,
          description: description || null,
          labels,
          model: model || null,
        })
        setTemplates((prev) =>
          prev.map((template) => (template.id === nextTemplate.id ? nextTemplate : template)),
        )
      } else {
        const nextTemplate = await ipc.createTaskTemplate(
          workspaceId,
          title,
          description || undefined,
          labels,
          model || undefined,
        )
        setTemplates((prev) => [nextTemplate, ...prev])
      }
      setForm(emptyForm)
    } catch (err) {
      console.error('[TaskTemplatePickerDialog] Failed to save task template:', err)
      setError('Could not save template.')
    } finally {
      setSaving(false)
    }
  }, [form, workspaceId])

  const handleDelete = useCallback(async (templateId: string) => {
    setError(null)
    try {
      await ipc.deleteTaskTemplate(templateId)
      setTemplates((prev) => prev.filter((template) => template.id !== templateId))
      setForm((prev) => (prev.editingId === templateId ? emptyForm : prev))
    } catch (err) {
      console.error('[TaskTemplatePickerDialog] Failed to delete task template:', err)
      setError('Could not delete template.')
    }
  }, [])

  const handleCreateTask = useCallback(
    async (templateId: string) => {
      setError(null)
      try {
        await onCreateTask(templateId)
        onClose()
      } catch (err) {
        console.error('[TaskTemplatePickerDialog] Failed to create task from template:', err)
        setError('Could not create task from template.')
      }
    },
    [onClose, onCreateTask],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded border border-border-default bg-surface shadow-xl"
        onClick={(e) => {
          e.stopPropagation()
        }}
      >
        <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
          <h3 className="text-lg font-semibold text-text-primary">Task templates</h3>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface-hover"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-text-secondary">
              Title
              <input
                className="mt-1 w-full rounded border border-border-default bg-bg px-2 py-1 text-sm"
                value={form.title}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, title: e.target.value }))
                }}
                placeholder="New template title"
              />
            </label>
            <label className="text-xs text-text-secondary">
              Model
              <input
                className="mt-1 w-full rounded border border-border-default bg-bg px-2 py-1 text-sm"
                value={form.model}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, model: e.target.value }))
                }}
                placeholder="Optional model"
              />
            </label>
          </div>
          <label className="mt-2 block text-xs text-text-secondary">
            Description
            <textarea
              className="mt-1 min-h-[68px] w-full rounded border border-border-default bg-bg px-2 py-1 text-sm"
              value={form.description}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }}
              placeholder="Template description"
            />
          </label>
          <label className="mt-2 block text-xs text-text-secondary">
            Labels JSON
            <input
              className="mt-1 w-full rounded border border-border-default bg-bg px-2 py-1 text-sm"
              value={form.labels}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, labels: e.target.value }))
              }}
              placeholder="[]"
            />
          </label>

          {error && <p className="mt-2 text-xs text-error">{error}</p>}

          <div className="mt-3 flex justify-end gap-2">
            {form.editingId && (
              <button
                onClick={resetForm}
                className="rounded px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-hover"
              >
                Cancel edit
              </button>
            )}
            <button
              onClick={() => {
                void handleSave()
              }}
              disabled={saving || !form.title.trim()}
              className="rounded bg-accent px-2.5 py-1 text-xs font-medium text-bg disabled:opacity-50"
            >
              {form.editingId ? 'Update template' : 'Save template'}
            </button>
          </div>

          <div className="mt-4 max-h-64 overflow-y-auto">
            {loading ? (
              <p className="text-xs text-text-secondary">Loading templates...</p>
            ) : templates.length === 0 ? (
              <p className="text-xs text-text-secondary">No templates yet.</p>
            ) : (
              <ul className="space-y-2">
                {templates.map((template) => (
                  <li
                    key={template.id}
                    className="rounded border border-border-default bg-surface-hover p-2"
                  >
                    <div className="mb-2">
                      <div className="text-sm font-medium text-text-primary">{template.title}</div>
                      {template.description && (
                        <p className="text-xs text-text-secondary">{template.description}</p>
                      )}
                      <p className="mt-1 text-[11px] text-text-secondary/80">
                        labels: {template.labels}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        onClick={() => {
                          void handleCreateTask(template.id)
                        }}
                        className="rounded bg-accent px-2 py-1 text-xs text-bg"
                      >
                        Create task
                      </button>
                      <button
                        onClick={() => {
                          handleEdit(template)
                        }}
                        className="rounded border border-border-default bg-surface px-2 py-1 text-xs text-text-secondary"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          void handleDelete(template.id)
                        }}
                        className="rounded bg-error px-2 py-1 text-xs text-white"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  )
}
