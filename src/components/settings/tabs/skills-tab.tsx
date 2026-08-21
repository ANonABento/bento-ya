import { useEffect, useState } from 'react'
import type { Skill } from '@/types'
import * as ipc from '@/lib/ipc'
import { useRosterStore } from '@/stores/roster-store'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'

/**
 * Skills — reusable capabilities you can attach to an LLM agent in the Roster.
 *
 * Skills used to exist only as an inert type in `settings.ts` that persisted to
 * localStorage and that no backend code could read. They now have a real table
 * (migration 049), so the backend can reach them when agents are wired into the
 * pipeline.
 *
 * Chrome matches `script-editor.tsx` — same header / body / footer, same
 * controls — since this is the same kind of object in the same panel.
 */

const inputClass =
  'w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none'

function SkillEditor({
  skill,
  onSave,
  onCancel,
}: {
  skill: Skill | null
  onSave: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(skill?.name ?? '')
  const [description, setDescription] = useState(skill?.description ?? '')
  const [trigger, setTrigger] = useState(skill?.trigger ?? '')
  const [script, setScript] = useState(skill?.script ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (skill) {
        await ipc.updateSkill(skill.id, { name: name.trim(), description, trigger, script })
      } else {
        await ipc.createSkill(name.trim(), description, trigger, script)
      }
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={skill ? 'Edit skill' : 'New skill'}
        data-testid="skill-editor"
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-border-default bg-bg shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
          <h3 className="text-base font-semibold text-text-primary">
            {skill ? 'Edit skill' : 'New skill'}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            style={{ cursor: 'pointer' }}
            className="rounded p-1 text-text-secondary transition-colors hover:bg-surface hover:text-text-primary"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4" aria-hidden="true">
              <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Name</label>
              <input
                className={inputClass}
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                }}
                placeholder="e.g. Run tests"
                autoFocus
                data-testid="skill-name-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                Description
              </label>
              <input
                className={inputClass}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value)
                }}
                placeholder="e.g. Runs the unit suite and reports failures"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Trigger</label>
              <input
                className={inputClass}
                value={trigger}
                onChange={(e) => {
                  setTrigger(e.target.value)
                }}
                placeholder="e.g. before opening a PR"
              />
              <p className="mt-1 text-xs text-text-secondary/70">
                When the agent should reach for this.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Script</label>
              <textarea
                className={`${inputClass} min-h-24 resize-y font-mono text-xs`}
                value={script}
                onChange={(e) => {
                  setScript(e.target.value)
                }}
                placeholder="npm test"
              />
            </div>
            {error && (
              <p className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
                {error}
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border-default px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            style={{ cursor: 'pointer' }}
            className="rounded-lg border border-border-default px-4 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSave()
            }}
            disabled={saving}
            data-testid="skill-save"
            style={{ cursor: 'pointer' }}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition-opacity disabled:opacity-50"
          >
            {saving ? 'Saving…' : skill ? 'Save skill' : 'Create skill'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function SkillsTab() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Skill | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const reloadRoster = useRosterStore((s) => s.reload)

  const load = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setSkills(await ipc.listSkills())
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load skills')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // Agents reference skills by id, so the roster's copy has to follow along or
  // a renamed skill would still show its old name in a dossier.
  const refreshAll = async () => {
    await load()
    await reloadRoster()
  }

  const handleDelete = async (id: string) => {
    try {
      await ipc.deleteSkill(id)
      setConfirmDelete(null)
      await refreshAll()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div data-testid="skills-tab">
      <p className="mb-4 text-xs text-text-secondary">
        Attach these to an agent in the Roster. Passing them through to a running CLI lands with
        pipeline wiring.
      </p>

      {loadError && (
        <p className="mb-3 rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
          {loadError}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-text-secondary">Loading skills…</p>
      ) : skills.length === 0 ? (
        <p className="mb-4 text-sm text-text-secondary">
          No skills yet. Create one to attach it to an agent.
        </p>
      ) : (
        <ul className="mb-4 flex flex-col gap-2">
          {skills.map((skill) => (
            <li
              key={skill.id}
              className="flex items-start gap-3 rounded-lg border border-border-default bg-surface px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-text-primary">{skill.name}</div>
                {skill.description && (
                  <div className="mt-0.5 text-xs text-text-secondary">{skill.description}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditing(skill)
                }}
                style={{ cursor: 'pointer' }}
                className="rounded-lg border border-border-default px-2.5 py-1 text-xs text-text-secondary transition-colors hover:text-text-primary"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(skill.id)
                }}
                data-testid={`skill-delete-${skill.id}`}
                style={{ cursor: 'pointer' }}
                className="rounded-lg border border-border-default px-2.5 py-1 text-xs text-error transition-colors hover:bg-error/10"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => {
          setCreating(true)
        }}
        data-testid="skill-new"
        style={{ cursor: 'pointer' }}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition-opacity hover:opacity-90"
      >
        New skill
      </button>

      {(editing ?? creating) && (
        <SkillEditor
          skill={editing}
          onSave={() => {
            setEditing(null)
            setCreating(false)
            void refreshAll()
          }}
          onCancel={() => {
            setEditing(null)
            setCreating(false)
          }}
        />
      )}

      {confirmDelete !== null && (
        <ConfirmDialog
          title="Delete this skill?"
          body="Agents that use it will show it as a missing skill until you detach it."
          testId="skill-confirm-delete"
          onConfirm={() => {
            void handleDelete(confirmDelete)
          }}
          onCancel={() => {
            setConfirmDelete(null)
          }}
        />
      )}
    </div>
  )
}
