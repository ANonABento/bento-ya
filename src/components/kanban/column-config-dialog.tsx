import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type {
  Column,
  ColumnTriggers,
  TriggerAction,
  ExitCriteria,
} from '@/types'
import { useColumnStore } from '@/stores/column-store'
import { getColumnTriggers } from '@/types/column'
import { COLORS, ICONS } from './column-config-constants'
import { TriggersTab } from './column-trigger-editor'
import { ExitTab } from './column-exit-editor'

// ─── Types ──────────────────────────────────────────────────────────────────

type ColumnConfigDialogProps = {
  column: Column
  onClose: () => void
}

type Tab = 'general' | 'triggers' | 'exit'

// ─── Component ──────────────────────────────────────────────────────────────

export function ColumnConfigDialog({ column, onClose }: ColumnConfigDialogProps) {
  const updateColumnAsync = useColumnStore((s) => s.updateColumnAsync)

  const [tab, setTab] = useState<Tab>('general')
  const [name, setName] = useState(column.name)
  const [icon, setIcon] = useState(column.icon || 'list')
  const [color, setColor] = useState(column.color || '#E8A87C')

  const initialTriggers = useMemo((): ColumnTriggers => {
    return getColumnTriggers(column)
  }, [column])

  const [onEntry, setOnEntry] = useState<TriggerAction>(initialTriggers.on_entry || { type: 'none' })
  const [onExit, setOnExit] = useState<TriggerAction>(initialTriggers.on_exit || { type: 'none' })
  const [exitCriteria, setExitCriteria] = useState<ExitCriteria>(
    initialTriggers.exit_criteria || { type: 'manual', auto_advance: false }
  )

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
          <div className="flex border-b border-border-default px-6">
            {(['general', 'triggers', 'exit'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t) }}
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
                <GeneralTab
                  name={name}
                  setName={setName}
                  icon={icon}
                  setIcon={setIcon}
                  color={color}
                  setColor={setColor}
                />
              )}
              {tab === 'triggers' && (
                <TriggersTab
                  columnName={column.name}
                  onEntry={onEntry}
                  setOnEntry={setOnEntry}
                  onExit={onExit}
                  setOnExit={setOnExit}
                  setExitCriteria={setExitCriteria}
                />
              )}
              {tab === 'exit' && (
                <ExitTab
                  exitCriteria={exitCriteria}
                  setExitCriteria={setExitCriteria}
                />
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 border-t border-border-default px-6 py-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || isSubmitting}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : 'Save'}
              </button>
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
}: {
  name: string
  setName: (v: string) => void
  icon: string
  setIcon: (v: string) => void
  color: string
  setColor: (v: string) => void
}) {
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
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
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
    </div>
  )
}
