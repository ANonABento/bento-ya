import { motion } from 'motion/react'
import type { ExitCriteria, ExitCriteriaType } from '@/types'
import { EXIT_CRITERIA_TYPES } from './column-config-constants'

// Exit criteria that can cause data-loss or irreversible actions when combined with auto_advance
const DANGEROUS_AUTO_ADVANCE: ExitCriteriaType[] = ['agent_complete', 'script_success', 'pr_approved']

// ─── Exit Tab ───────────────────────────────────────────────────────────────

export function ExitTab({
  exitCriteria,
  setExitCriteria,
}: {
  exitCriteria: ExitCriteria
  setExitCriteria: (v: ExitCriteria) => void
}) {
  const showDangerWarning =
    exitCriteria.auto_advance && DANGEROUS_AUTO_ADVANCE.includes(exitCriteria.type)

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-text-primary">
          Exit Criteria
        </h3>
        <p className="mb-3 text-xs text-text-secondary">
          When should the on_exit trigger fire and the task be allowed to advance?
        </p>

        {/* Criteria Type Grid */}
        <div className="grid grid-cols-2 gap-2">
          {EXIT_CRITERIA_TYPES.map((e) => (
            <button
              key={e.value}
              type="button"
              onClick={() => { setExitCriteria({ ...exitCriteria, type: e.value }) }}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                exitCriteria.type === e.value
                  ? 'border-accent bg-accent/10 text-text-primary'
                  : 'border-border-default text-text-secondary hover:border-text-secondary'
              }`}
            >
              <div className="font-medium">{e.label}</div>
              <div className="text-xs opacity-70">{e.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Timeout for time_elapsed */}
      {exitCriteria.type === 'time_elapsed' && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">
            Timeout (seconds)
          </label>
          <input
            type="number"
            value={exitCriteria.timeout || 300}
            onChange={(e) => {
              setExitCriteria({ ...exitCriteria, timeout: parseInt(e.target.value) || 300 })
            }}
            min={1}
            className="w-32 rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
      )}

      {/* Max Retries — shown for non-manual criteria */}
      {exitCriteria.type !== 'manual' && (
        <div>
          <label className="mb-1 block text-sm font-medium text-text-secondary">
            Max retries on failure
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={exitCriteria.max_retries ?? ''}
              onChange={(e) => {
                const raw = e.target.value
                setExitCriteria({
                  ...exitCriteria,
                  max_retries: raw === '' ? undefined : Math.max(0, parseInt(raw) || 0),
                })
              }}
              placeholder="0"
              min={0}
              className="w-24 rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
            />
            <p className="text-xs text-text-secondary">
              {exitCriteria.max_retries
                ? `Re-fires the on_entry trigger up to ${exitCriteria.max_retries}× on failure`
                : 'Leave empty to disable auto-retry'}
            </p>
          </div>
        </div>
      )}

      {/* Auto Advance Toggle */}
      <div className="rounded-lg border border-border-default px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-text-primary">Auto Advance</div>
            <div className="text-xs text-text-secondary">
              Automatically execute on_exit trigger when criteria met
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setExitCriteria({ ...exitCriteria, auto_advance: !exitCriteria.auto_advance })
            }}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              exitCriteria.auto_advance ? 'bg-accent' : 'bg-surface-hover'
            }`}
          >
            <motion.div
              className="absolute top-1 h-4 w-4 rounded-full bg-white shadow"
              animate={{ left: exitCriteria.auto_advance ? 24 : 4 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          </button>
        </div>

        {showDangerWarning && (
          <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2">
            <span className="mt-0.5 text-amber-400 text-xs">⚠</span>
            <p className="text-xs text-amber-300">
              Auto-advance will move the task automatically when{' '}
              <strong>{EXIT_CRITERIA_TYPES.find((t) => t.value === exitCriteria.type)?.label.toLowerCase()}</strong>.
              Make sure the on_exit action is correct — this will fire without user confirmation.
            </p>
          </div>
        )}

        {exitCriteria.type === 'manual_approval' && exitCriteria.auto_advance && (
          <div className="flex items-start gap-2 rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2">
            <span className="mt-0.5 text-red-400 text-xs">⚠</span>
            <p className="text-xs text-red-300">
              Manual Approval + Auto Advance: the task advances immediately once a reviewer approves.
              Ensure the reviewer understands this is a one-click action with no undo.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
