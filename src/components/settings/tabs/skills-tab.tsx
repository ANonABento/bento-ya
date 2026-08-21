import { useEffect, useState } from 'react'
import type { Skill } from '@/types'
import * as ipc from '@/lib/ipc'
import { useRosterStore } from '@/stores/roster-store'

/**
 * Skills — reusable capabilities that can be attached to an LLM agent.
 *
 * Skills previously existed only as an inert type in settings.ts that persisted
 * to localStorage and that no backend code could read. They now have a real
 * table (migration 049), so they survive, and the backend can reach them when
 * agents are eventually wired into the pipeline.
 */

const inputClass =
  'w-full rounded-md border border-border-default bg-surface px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-accent'

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
        await ipc.updateSkill(skill.id, {
          name: name.trim(),
          description,
          trigger,
          script,
        })
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
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto rounded-xl border border-border-default bg-bg p-5 shadow-2xl"
      >
        <h3 className="mb-4 text-base font-semibold text-text-primary">
          {skill ? 'Edit skill' : 'New skill'}
        </h3>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">Name</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
            }}
            data-testid="skill-name-input"
          />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">Description</span>
          <input
            className={inputClass}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
            }}
          />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">
            Trigger (when the agent should reach for it)
          </span>
          <input
            className={inputClass}
            value={trigger}
            onChange={(e) => {
              setTrigger(e.target.value)
            }}
          />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-text-secondary">Script</span>
          <textarea
            className={`${inputClass} min-h-24 resize-y font-mono text-xs`}
            value={script}
            onChange={(e) => {
              setScript(e.target.value)
            }}
          />
        </label>
        {error && (
          <p className="mb-3 rounded-md border border-error/40 bg-error/10 px-2.5 py-1.5 text-xs text-error">
            {error}
          </p>
        )}
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            style={{ cursor: 'pointer' }}
            className="rounded-lg border border-border-default px-3 py-1.5 text-[13px] text-text-primary hover:bg-surface-hover"
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
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-bg disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
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
  // a freshly-renamed skill would still show its old name in a dossier.
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
        Reusable capabilities you can attach to an LLM agent in the Roster. Defining them here
        makes them available to every agent; passing them through to a running CLI lands with
        pipeline wiring.
      </p>

      {loadError && (
        <p className="mb-3 rounded-md border border-error/40 bg-error/10 px-2.5 py-1.5 text-xs text-error">
          {loadError}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : skills.length === 0 ? (
        <p className="mb-4 text-sm italic text-text-secondary">No skills defined yet.</p>
      ) : (
        <ul className="mb-4 flex flex-col gap-2">
          {skills.map((skill) => (
            <li
              key={skill.id}
              className="flex items-start gap-3 rounded-lg border border-border-default bg-surface px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-text-primary">{skill.name}</div>
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
                className="rounded border border-border-default px-2 py-0.5 text-xs text-text-primary hover:bg-surface-hover"
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
                className="rounded border border-border-default px-2 py-0.5 text-xs text-error hover:bg-error/10"
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
        className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-bg hover:opacity-90"
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-xl border border-border-default bg-bg p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-text-primary">Delete this skill?</h3>
            <p className="mt-1 text-[13px] text-text-secondary">
              Agents referencing it will show it as a missing skill until you detach it.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(null)
                }}
                style={{ cursor: 'pointer' }}
                className="rounded-lg border border-border-default px-3 py-1.5 text-[13px] text-text-primary hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleDelete(confirmDelete)
                }}
                data-testid="skill-confirm-delete"
                style={{ cursor: 'pointer' }}
                className="rounded-lg bg-error px-3 py-1.5 text-[13px] font-semibold text-bg hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
