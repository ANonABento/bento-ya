import { useEffect, useMemo, useState } from 'react'
import type { Agent, AgentRuntime } from '@/types'
import { useRosterStore } from '@/stores/roster-store'
import * as ipc from '@/lib/ipc'
import { AgentTile, NewAgentTile } from './agent-tile'
import { AgentDossier } from './agent-dossier'
import { AgentEditor } from './agent-editor'

/**
 * The Roster section — character-select for agents.
 *
 * Layout follows the settings panel: a filtered grid on the left, a detail
 * pane on the right. Mutations go through ipc and then `reload()`, mirroring
 * how scripts-tab treats its store as read-only.
 */

type Filter = 'all' | AgentRuntime

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'script', label: 'Script' },
]

export function RosterView() {
  const agents = useRosterStore((s) => s.agents)
  const loaded = useRosterStore((s) => s.loaded)
  const load = useRosterStore((s) => s.load)
  const reload = useRosterStore((s) => s.reload)

  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Agent | null>(null)
  const [seed, setSeed] = useState<Agent | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(
    () => (filter === 'all' ? agents : agents.filter((a) => a.runtime === filter)),
    [agents, filter],
  )

  // Keep the selection valid: an agent can leave the visible set by being
  // deleted or filtered out, and a dossier for a vanished agent would throw.
  const selected = visible.find((a) => a.id === selectedId) ?? null

  const closeEditor = () => {
    setEditing(null)
    setSeed(null)
    setCreating(false)
  }

  const handleDelete = async (id: string) => {
    try {
      await ipc.deleteAgent(id)
      setConfirmDelete(null)
      if (selectedId === id) setSelectedId(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="flex h-full min-h-0" data-testid="roster-view">
      {/* Grid */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-border-default bg-bg/80 px-5 py-3 backdrop-blur">
          <h2 className="text-base font-semibold text-text-primary">Roster</h2>
          <p className="mt-0.5 text-xs text-text-secondary">
            Agents you craft once and reuse. Wiring them into board columns comes later.
          </p>
        </header>

        <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 py-3">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                setFilter(f.value)
              }}
              data-testid={`roster-filter-${f.value}`}
              aria-pressed={filter === f.value}
              style={{ cursor: 'pointer' }}
              className={`rounded-md border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                filter === f.value
                  ? 'border-accent text-accent'
                  : 'border-border-default text-text-secondary hover:text-text-primary'
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto font-mono text-[11px] text-text-secondary">
            {visible.length} {visible.length === 1 ? 'agent' : 'agents'}
          </span>
        </div>

        {error && (
          <p className="mx-5 mb-2 rounded-md border border-error/40 bg-error/10 px-2.5 py-1.5 text-xs text-error">
            {error}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {!loaded ? (
            <p className="text-sm text-text-secondary">Loading roster…</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {visible.map((agent) => (
                <AgentTile
                  key={agent.id}
                  agent={agent}
                  selected={agent.id === selectedId}
                  onSelect={() => {
                    setSelectedId(agent.id)
                  }}
                />
              ))}
              <NewAgentTile
                onClick={() => {
                  setCreating(true)
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Dossier */}
      <aside className="hidden w-[380px] shrink-0 border-l border-border-default lg:block">
        {selected ? (
          <AgentDossier
            agent={selected}
            onEdit={() => {
              setEditing(selected)
            }}
            onDuplicate={() => {
              setSeed(selected)
              setCreating(true)
            }}
            onDelete={() => {
              setConfirmDelete(selected.id)
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <p className="text-sm text-text-secondary">
              Select an agent to see its dossier — the fields change with its runtime.
            </p>
          </div>
        )}
      </aside>

      {(editing ?? creating) && (
        <AgentEditor
          agent={editing}
          seed={seed}
          onSave={() => {
            closeEditor()
            void reload()
          }}
          onCancel={closeEditor}
        />
      )}

      {confirmDelete !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-xl border border-border-default bg-bg p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-text-primary">Delete this agent?</h3>
            <p className="mt-1 text-[13px] text-text-secondary">
              This removes the definition. Nothing that already ran is affected.
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
                data-testid="roster-confirm-delete"
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
