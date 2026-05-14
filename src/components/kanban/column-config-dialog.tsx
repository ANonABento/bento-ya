import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type {
  Column,
  ColumnTriggers,
  TriggerAction,
  ExitCriteria,
} from '@/types'
import type { ResourceProfile } from '@/types/column'
import { useColumnStore } from '@/stores/column-store'
import { getColumnTriggers } from '@/types/column'
import { ICONS, COLUMN_COLORS } from './column-config-constants'
import { TriggersTab } from './column-trigger-editor'
import { ExitTab } from './column-exit-editor'

/** Auto-suggest an icon based on column name keywords */
function suggestIcon(name: string): string | null {
  const lower = name.toLowerCase()
  const map: Array<[string[], string]> = [
    [['backlog', 'todo', 'inbox', 'queue', 'triage', 'icebox', 'ideas'], 'inbox'],
    [['working', 'progress', 'doing', 'active', 'build', 'develop', 'coding', 'implement', 'fixing'], 'play'],
    [['review', 'verify', 'qa', 'inspect', 'staging', 'approval'], 'eye'],
    [['done', 'complete', 'finish', 'ship', 'merge', 'closed', 'resolved'], 'check'],
    [['deploy', 'release', 'launch', 'publish', 'production'], 'rocket'],
    [['spec', 'plan', 'design', 'research', 'spike', 'discover'], 'code'],
    [['archive', 'stale', 'cancelled', 'deprecated'], 'archive'],
    [['test', 'testing', 'validation'], 'eye'],
  ]
  for (const [keywords, icon] of map) {
    if (keywords.some((k) => lower.includes(k))) return icon
  }
  return null
}

/** Auto-suggest a color based on column name keywords */
function suggestColor(name: string): string | null {
  const lower = name.toLowerCase()
  const map: Array<[string[], string]> = [
    [['backlog', 'todo', 'inbox', 'queue', 'triage', 'icebox', 'ideas'], COLUMN_COLORS.gray],
    [['working', 'progress', 'doing', 'active', 'build', 'develop', 'coding', 'implement', 'fixing'], COLUMN_COLORS.blue],
    [['review', 'verify', 'qa', 'inspect', 'staging', 'approval'], COLUMN_COLORS.amber],
    [['done', 'complete', 'finish', 'ship', 'merge', 'closed', 'resolved'], COLUMN_COLORS.green],
    [['deploy', 'release', 'launch', 'publish', 'production'], COLUMN_COLORS.purple],
    [['test', 'testing', 'validation', 'spec', 'plan', 'research', 'spike', 'discover'], COLUMN_COLORS.teal],
    [['archive', 'stale', 'cancelled', 'deprecated'], COLUMN_COLORS.slate],
  ]
  for (const [keywords, color] of map) {
    if (keywords.some((k) => lower.includes(k))) return color
  }
  return null
}

// ─── Types ──────────────────────────────────────────────────────────────────

type ColumnConfigDialogProps = {
  column: Column
  onClose: () => void
  onDelete?: () => void
}

type Tab = 'general' | 'triggers' | 'exit'
type ResourceProfileOption = ResourceProfile | 'auto'

const RESOURCE_PROFILE_OPTIONS: Array<{ value: ResourceProfileOption; label: string; hint: string }> = [
  { value: 'auto', label: 'Auto', hint: 'Backend default' },
  { value: 'light', label: 'Light', hint: 'Small work' },
  { value: 'standard', label: 'Standard', hint: 'Normal agent work' },
  { value: 'heavy', label: 'Heavy', hint: 'Prefer one at a time' },
  { value: 'exclusive', label: 'Exclusive', hint: 'Single lane work' },
]

// ─── Component ──────────────────────────────────────────────────────────────

export function ColumnConfigDialog({ column, onClose, onDelete }: ColumnConfigDialogProps) {
  const updateColumnAsync = useColumnStore((s) => s.updateColumnAsync)

  const [tab, setTab] = useState<Tab>('general')
  const [name, setName] = useState(column.name)
  const [icon, setIcon] = useState(column.icon || 'list')
  const [color, setColor] = useState(column.color || '#E8A87C')
  const [userPickedIcon, setUserPickedIcon] = useState(false)
  const [userPickedColor, setUserPickedColor] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Reset the delete-confirm state after 3s if the user doesn't follow through —
  // prevents a stale "armed" state if focus moves away.
  useEffect(() => {
    if (!confirmDelete) return
    const t = setTimeout(() => { setConfirmDelete(false) }, 3000)
    return () => { clearTimeout(t) }
  }, [confirmDelete])

  // Reset manual override flags when dialog opens for a different column
  useEffect(() => {
    setUserPickedIcon(false)
    setUserPickedColor(false)
  }, [column.id])

  const handleNameChange = useCallback((newName: string) => {
    setName(newName)
    // Auto-suggest icon/color only if user hasn't manually picked them
    if (!userPickedIcon) {
      const suggested = suggestIcon(newName)
      if (suggested) setIcon(suggested)
    }
    if (!userPickedColor) {
      const suggested = suggestColor(newName)
      if (suggested) setColor(suggested)
    }
  }, [userPickedIcon, userPickedColor])

  const initialTriggers = useMemo((): ColumnTriggers => {
    return getColumnTriggers(column)
  }, [column])

  const [onEntry, setOnEntry] = useState<TriggerAction>(initialTriggers.on_entry || { type: 'none' })
  const [onExit, setOnExit] = useState<TriggerAction>(initialTriggers.on_exit || { type: 'none' })
  const [exitCriteria, setExitCriteria] = useState<ExitCriteria>(
    initialTriggers.exit_criteria || { type: 'manual', auto_advance: false }
  )
  const [maxConcurrent, setMaxConcurrent] = useState<number | undefined>(initialTriggers.max_concurrent)
  const [resourceProfile, setResourceProfile] = useState<ResourceProfile | undefined>(initialTriggers.resource_profile)

  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!name.trim() || isSubmitting) return

    setIsSubmitting(true)
    try {
      // Normalize: run_script with empty script_id → none
      const normalizeAction = (a: TriggerAction): TriggerAction =>
        a.type === 'run_script' && !a.script_id ? { type: 'none' } : a

      const triggers: ColumnTriggers = {
        on_entry: normalizeAction(onEntry),
        on_exit: normalizeAction(onExit),
        exit_criteria: exitCriteria,
        ...(resourceProfile ? { resource_profile: resourceProfile } : {}),
        ...(maxConcurrent != null && maxConcurrent > 0 ? { max_concurrent: maxConcurrent } : {}),
      }

      await updateColumnAsync(column.id, {
        name: name.trim(),
        icon,
        color,
        triggers: JSON.stringify(triggers),
      })
      onClose()
    } catch (err) {
      console.error('Failed to update column:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [onClose])

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.15 }}
          onClick={(e) => { e.stopPropagation() }}
          className="max-h-[90vh] w-full max-w-xl overflow-hidden rounded-xl border border-border-default bg-surface shadow-xl flex flex-col"
        >
          {/* Header */}
          <div className="border-b border-border-default px-6 py-4">
            <h2 className="text-lg font-semibold text-text-primary">
              Configure Column
            </h2>
          </div>

          {/* Tabs */}
          <div role="tablist" aria-label="Column configuration sections" className="flex border-b border-border-default px-6">
            {(['general', 'triggers', 'exit'] as Tab[]).map((t) => (
              <button
                key={t}
                id={`column-config-tab-${t}`}
                role="tab"
                type="button"
                aria-selected={tab === t}
                aria-controls={`column-config-panel-${t}`}
                tabIndex={tab === t ? 0 : -1}
                onClick={() => { setTab(t) }}
                onKeyDown={(e) => {
                  // Roving-tabindex arrow navigation per ARIA Authoring Practices.
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                  e.preventDefault()
                  const tabs = ['general', 'triggers', 'exit'] as const
                  const idx = tabs.indexOf(t)
                  const nextIdx = e.key === 'ArrowRight'
                    ? (idx + 1) % tabs.length
                    : (idx - 1 + tabs.length) % tabs.length
                  const next = tabs[nextIdx] ?? 'general'
                  setTab(next)
                  // Focus the newly-selected tab so the visual + DOM focus agree.
                  setTimeout(() => {
                    document.getElementById(`column-config-tab-${next}`)?.focus()
                  }, 0)
                }}
                className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                  tab === t
                    ? 'text-accent'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
                {tab === t && (
                  <motion.div
                    layoutId="tab-indicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent"
                  />
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <form onSubmit={(e) => { void handleSubmit(e) }} className="flex-1 overflow-y-auto">
            <div className="p-6">
              {tab === 'general' && (
                <div role="tabpanel" id="column-config-panel-general" aria-labelledby="column-config-tab-general">
                <GeneralTab
                  name={name}
                  setName={handleNameChange}
                  icon={icon}
                  setIcon={(v) => { setUserPickedIcon(true); setIcon(v) }}
                  color={color}
                  setColor={(v) => { setUserPickedColor(true); setColor(v) }}
                  maxConcurrent={maxConcurrent}
                  setMaxConcurrent={setMaxConcurrent}
                  resourceProfile={resourceProfile}
                  setResourceProfile={setResourceProfile}
                />
                </div>
              )}
              {tab === 'triggers' && (
                <div role="tabpanel" id="column-config-panel-triggers" aria-labelledby="column-config-tab-triggers">
                <TriggersTab
                  columnName={column.name}
                  onEntry={onEntry}
                  setOnEntry={setOnEntry}
                  onExit={onExit}
                  setOnExit={setOnExit}
                  setExitCriteria={setExitCriteria}
                />
                </div>
              )}
              {tab === 'exit' && (
                <div role="tabpanel" id="column-config-panel-exit" aria-labelledby="column-config-tab-exit">
                <ExitTab
                  exitCriteria={exitCriteria}
                  setExitCriteria={setExitCriteria}
                />
                </div>
              )}
            </div>

            {/* Actions — DOM order is Cancel, Save, Delete (safe → destructive) so
                keyboard focus reaches Cancel/Save before the destructive Delete.
                `order-*` classes restore the visual left-Delete / right-Save layout. */}
            <div className="flex items-center gap-2 border-t border-border-default px-6 py-4">
              <button
                type="button"
                onClick={onClose}
                className="order-2 ml-auto rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || isSubmitting}
                className="order-3 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : 'Save'}
              </button>
              {onDelete && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirmDelete) {
                      onClose()
                      onDelete()
                    } else {
                      setConfirmDelete(true)
                    }
                  }}
                  aria-label={confirmDelete ? 'Confirm delete column (click again to delete)' : 'Delete column'}
                  className={`order-1 rounded-lg px-3 py-2 text-sm transition-colors ${
                    confirmDelete
                      ? 'bg-error/20 text-error font-medium ring-2 ring-error/40'
                      : 'text-error hover:bg-error/10'
                  }`}
                >
                  {confirmDelete ? 'Click again to confirm' : 'Delete column'}
                </button>
              )}
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}

// ─── General Tab ────────────────────────────────────────────────────────────

function GeneralTab({
  name,
  setName,
  icon,
  setIcon,
  color,
  setColor,
  maxConcurrent,
  setMaxConcurrent,
  resourceProfile,
  setResourceProfile,
}: {
  name: string
  setName: (v: string) => void
  icon: string
  setIcon: (v: string) => void
  color: string
  setColor: (v: string) => void
  maxConcurrent: number | undefined
  setMaxConcurrent: (v: number | undefined) => void
  resourceProfile: ResourceProfile | undefined
  setResourceProfile: (v: ResourceProfile | undefined) => void
}) {
  const shouldSuggestSingleLane = resourceProfile === 'heavy' || resourceProfile === 'exclusive'

  return (
    <div className="space-y-5">
      {/* Name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-secondary">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value) }}
          className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
        />
      </div>

      {/* Icon & Color */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">
            Icon
          </label>
          <select
            value={icon}
            onChange={(e) => { setIcon(e.target.value) }}
            className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            {ICONS.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">
            Color
          </label>
          <div role="radiogroup" aria-label="Column color" className="flex flex-wrap gap-2">
            {Object.entries(COLUMN_COLORS).map(([name, c]) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`Color: ${name}`}
                onClick={() => { setColor(c) }}
                className={`h-6 w-6 rounded-full transition-transform ${
                  color === c ? 'scale-110 ring-2 ring-white/50' : 'hover:scale-105'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Capacity */}
      <div className="border-t border-border-default pt-5">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-text-primary">Capacity</h3>
          <p className="mt-0.5 text-xs text-text-secondary/70">Column resource profile and concurrency.</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-secondary">
              Resource profile
            </label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
              {RESOURCE_PROFILE_OPTIONS.map((option) => {
                const selected = option.value === (resourceProfile ?? 'auto')
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setResourceProfile(option.value === 'auto' ? undefined : option.value)
                    }}
                    className={`min-h-14 rounded-lg border px-2 py-2 text-left transition-colors ${
                      selected
                        ? 'border-accent bg-accent/10 text-text-primary'
                        : 'border-border-default bg-bg text-text-secondary hover:border-border-hover hover:text-text-primary'
                    }`}
                    aria-pressed={selected}
                  >
                    <span className="block text-sm font-medium leading-4">{option.label}</span>
                    <span className="mt-1 block text-[11px] leading-3 text-text-secondary/70">{option.hint}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                Max concurrent agents
              </label>
              <input
                type="number"
                min={1}
                step={1}
                placeholder="Unlimited"
                value={maxConcurrent ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '') { setMaxConcurrent(undefined); return }
                  const n = Number.parseInt(v, 10)
                  setMaxConcurrent(Number.isFinite(n) && n > 0 ? n : undefined)
                }}
                className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none sm:max-w-40"
              />
            </div>

            {shouldSuggestSingleLane && maxConcurrent !== 1 && (
              <button
                type="button"
                onClick={() => { setMaxConcurrent(1) }}
                className="rounded-lg border border-border-default px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-hover"
              >
                Set to 1
              </button>
            )}
          </div>

          {shouldSuggestSingleLane && maxConcurrent !== 1 && (
            <p className="text-xs text-warning">
              {resourceProfile === 'exclusive' ? 'Exclusive' : 'Heavy'} columns usually run best at 1.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
