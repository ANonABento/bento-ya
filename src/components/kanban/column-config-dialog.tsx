import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { Column, TriggerType, ExitType, TriggerConfig, ExitConfig } from '@/types'
import { useColumnStore } from '@/stores/column-store'

// ─── Types ──────────────────────────────────────────────────────────────────

type ColumnConfigDialogProps = {
  column: Column
  onClose: () => void
}

const TRIGGER_TYPES: { value: TriggerType; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'No automatic trigger' },
  { value: 'agent', label: 'Agent', description: 'Spawn an AI agent' },
  { value: 'skill', label: 'Skill', description: 'Run a skill/command' },
  { value: 'script', label: 'Script', description: 'Execute a shell script' },
]

const EXIT_TYPES: { value: ExitType; label: string; description: string }[] = [
  { value: 'manual', label: 'Manual', description: 'User moves task manually' },
  { value: 'agent_complete', label: 'Agent Complete', description: 'Agent finishes work' },
  { value: 'script_success', label: 'Script Success', description: 'Script exits with code 0' },
  { value: 'checklist_done', label: 'Checklist Done', description: 'All checklist items checked' },
  { value: 'pr_approved', label: 'PR Approved', description: 'Pull request is approved' },
]

const COLORS = [
  '#E8A87C', // accent
  '#4ADE80', // success
  '#60A5FA', // running/blue
  '#F59E0B', // attention/amber
  '#F87171', // error/red
  '#A78BFA', // purple
  '#EC4899', // pink
  '#6EE7B7', // teal
]

const ICONS = [
  { value: 'list', label: 'List' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'play', label: 'Play' },
  { value: 'code', label: 'Code' },
  { value: 'check', label: 'Check' },
  { value: 'eye', label: 'Review' },
  { value: 'rocket', label: 'Deploy' },
  { value: 'archive', label: 'Archive' },
]

// ─── Component ──────────────────────────────────────────────────────────────

export function ColumnConfigDialog({ column, onClose }: ColumnConfigDialogProps) {
  const updateColumnAsync = useColumnStore((s) => s.updateColumnAsync)

  const [name, setName] = useState(column.name)
  const [icon, setIcon] = useState(column.icon || 'list')
  const [color, setColor] = useState(column.color || '#E8A87C')
  const [autoAdvance, setAutoAdvance] = useState(column.autoAdvance)

  // Parse trigger and exit configs
  const initialTrigger: TriggerConfig = (() => {
    try {
      return JSON.parse(column.trigger.type ? JSON.stringify(column.trigger) : '{"type":"none","config":{}}')
    } catch {
      return { type: 'none' as const, config: {} }
    }
  })()

  const initialExit: ExitConfig = (() => {
    try {
      return JSON.parse(column.exitCriteria.type ? JSON.stringify(column.exitCriteria) : '{"type":"manual","config":{}}')
    } catch {
      return { type: 'manual' as const, config: {} }
    }
  })()

  const [triggerType, setTriggerType] = useState<TriggerType>(initialTrigger.type)
  const [triggerConfig, setTriggerConfig] = useState(initialTrigger.config)
  const [exitType, setExitType] = useState<ExitType>(initialExit.type)
  const [exitConfig, setExitConfig] = useState(initialExit.config)

  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || isSubmitting) return

    setIsSubmitting(true)
    try {
      await updateColumnAsync(column.id, {
        name: name.trim(),
        icon,
        color,
        autoAdvance,
        triggerConfig: JSON.stringify({ type: triggerType, config: triggerConfig }),
        exitConfig: JSON.stringify({ type: exitType, config: exitConfig }),
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
    return () => window.removeEventListener('keydown', handleKeyDown)
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
          onClick={(e) => e.stopPropagation()}
          className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border-default bg-surface p-6 shadow-xl"
        >
          <h2 className="mb-4 text-lg font-semibold text-text-primary">
            Configure Column
          </h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
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
                  onChange={(e) => setIcon(e.target.value)}
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
                      onClick={() => setColor(c)}
                      className={`h-6 w-6 rounded-full transition-transform ${
                        color === c ? 'scale-110 ring-2 ring-white/50' : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Trigger Type */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                Trigger (when task enters)
              </label>
              <div className="grid grid-cols-2 gap-2">
                {TRIGGER_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => {
                      setTriggerType(t.value)
                      setTriggerConfig({})
                    }}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      triggerType === t.value
                        ? 'border-accent bg-accent/10 text-text-primary'
                        : 'border-border-default text-text-secondary hover:border-text-secondary'
                    }`}
                  >
                    <div className="font-medium">{t.label}</div>
                    <div className="text-xs opacity-70">{t.description}</div>
                  </button>
                ))}
              </div>

              {/* Trigger config inputs */}
              {triggerType === 'agent' && (
                <input
                  type="text"
                  placeholder="Agent type (e.g., claude, codex)"
                  value={triggerConfig.agent || ''}
                  onChange={(e) => setTriggerConfig({ ...triggerConfig, agent: e.target.value })}
                  className="mt-2 w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
                />
              )}
              {triggerType === 'skill' && (
                <input
                  type="text"
                  placeholder="Skill name (e.g., /review)"
                  value={triggerConfig.skill || ''}
                  onChange={(e) => setTriggerConfig({ ...triggerConfig, skill: e.target.value })}
                  className="mt-2 w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
                />
              )}
              {triggerType === 'script' && (
                <input
                  type="text"
                  placeholder="Script path or command"
                  value={triggerConfig.script || ''}
                  onChange={(e) => setTriggerConfig({ ...triggerConfig, script: e.target.value })}
                  className="mt-2 w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
                />
              )}
            </div>

            {/* Exit Criteria */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                Exit Criteria (when to advance)
              </label>
              <div className="grid grid-cols-2 gap-2">
                {EXIT_TYPES.map((e) => (
                  <button
                    key={e.value}
                    type="button"
                    onClick={() => {
                      setExitType(e.value)
                      setExitConfig({})
                    }}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      exitType === e.value
                        ? 'border-accent bg-accent/10 text-text-primary'
                        : 'border-border-default text-text-secondary hover:border-text-secondary'
                    }`}
                  >
                    <div className="font-medium">{e.label}</div>
                    <div className="text-xs opacity-70">{e.description}</div>
                  </button>
                ))}
              </div>

              {/* Exit config inputs */}
              {exitType !== 'manual' && (
                <div className="mt-2 flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-text-secondary">
                    <input
                      type="number"
                      placeholder="Timeout (s)"
                      value={exitConfig.timeout || ''}
                      onChange={(e) => setExitConfig({ ...exitConfig, timeout: parseInt(e.target.value) || undefined })}
                      className="w-24 rounded-lg border border-border-default bg-bg px-2 py-1 text-sm text-text-primary focus:border-accent focus:outline-none"
                    />
                    <span>Timeout (seconds)</span>
                  </label>
                </div>
              )}
            </div>

            {/* Auto Advance */}
            <div className="flex items-center justify-between rounded-lg border border-border-default px-4 py-3">
              <div>
                <div className="text-sm font-medium text-text-primary">Auto Advance</div>
                <div className="text-xs text-text-secondary">
                  Automatically move task to next column when exit criteria met
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAutoAdvance(!autoAdvance)}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  autoAdvance ? 'bg-accent' : 'bg-surface-hover'
                }`}
              >
                <motion.div
                  className="absolute top-1 h-4 w-4 rounded-full bg-white shadow"
                  animate={{ left: autoAdvance ? 24 : 4 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              </button>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
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
