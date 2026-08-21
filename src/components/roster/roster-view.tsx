import { useEffect, useMemo, useState } from 'react'
import type { Agent, AgentRuntime } from '@/types'
import { useRosterStore } from '@/stores/roster-store'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import * as ipc from '@/lib/ipc'
import { AgentTile, NewAgentTile } from './agent-tile'
import { AgentDossier } from './agent-dossier'
import { AgentEditor } from './agent-editor'

/**
 * The Roster section — character-select for agents.
 *
 * Layout mirrors the settings panel (sticky header + scrolling body + a detail
 * column), so switching between Board and Roster doesn't feel like switching
 * between two apps. Mutations go through ipc then `reload()`, treating the
 * store as read-only the way `scripts-tab` does.
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
    <div className="flex h-full min-h-0 flex-col" data-testid="roster-view">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* Grid */}
        {/* Browsing rail — deliberately narrow. Scanning happens here; the
            reading happens in the dossier. */}
        <div className="flex min-w-0 flex-none flex-col border-border-default lg:w-[340px] lg:shrink-0 lg:overflow-hidden lg:border-r">
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border-default px-4 py-2.5">
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
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg ${
                  filter === f.value
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                }`}
              >
                {f.label}
              </button>
            ))}
            <span className="ml-auto text-xs text-text-secondary">
              {visible.length} {visible.length === 1 ? 'agent' : 'agents'}
            </span>
          </div>

          {error && (
            <p className="mx-4 mb-3 rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
              {error}
            </p>
          )}

          <div className="min-h-0 p-4 lg:flex-1 lg:overflow-y-auto">
            {!loaded ? (
              <p className="text-sm text-text-secondary">Loading agents…</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
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
        <aside
          className={`min-w-0 overflow-y-auto border-border-default lg:flex-1 ${
            selected ? 'border-t lg:border-t-0' : 'hidden lg:block'
          }`}
        >
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
            <div className="flex h-full items-center justify-center p-6">
              <div className="max-w-sm text-center">
                <p className="text-sm text-text-primary">Pick an agent to see how it's set up.</p>
                <p className="mt-1 text-xs text-text-secondary">
                  Agents are shared across every workspace. Assigning them to board columns comes
                  later.
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>

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
        <ConfirmDialog
          title="Delete this agent?"
          body="This removes the definition. Work it has already done is unaffected."
          testId="roster-confirm-delete"
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
