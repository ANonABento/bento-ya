import { motion } from 'motion/react'
import type { ExitCriteria } from '@/types'
import { EXIT_CRITERIA_TYPES } from './column-config-constants'

// ─── Exit Tab ───────────────────────────────────────────────────────────────

export function ExitTab({
  exitCriteria,
  setExitCriteria,
}: {
  exitCriteria: ExitCriteria
  setExitCriteria: (v: ExitCriteria) => void
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-text-primary">
          Exit Criteria
        </h3>
        <p className="mb-3 text-xs text-text-secondary">
          When should the on_exit trigger fire and task be allowed to advance?
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

      {/* Auto Advance Toggle */}
      <div className="flex items-center justify-between rounded-lg border border-border-default px-4 py-3">
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
    </div>
  )
}
