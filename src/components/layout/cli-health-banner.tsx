import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { listen } from '@/lib/ipc'
import { checkCliHealth, isCliHealthConcerning, type CliHealthReport } from '@/lib/ipc/cli'

/**
 * App-level banner that warns when an installed CLI has drifted from the flags
 * / versions the agent runner depends on (Phase 5). The backend probes on
 * startup and broadcasts `cli:health`; we also re-check on mount for hot reloads
 * and offer a manual re-check. A *missing* CLI is not surfaced here — onboarding
 * and Settings own that path.
 */
export function CliHealthBanner() {
  const [reports, setReports] = useState<CliHealthReport[]>([])
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const [rechecking, setRechecking] = useState(false)

  useEffect(() => {
    let cancelled = false
    checkCliHealth()
      .then((r) => { if (!cancelled) setReports(r) })
      .catch(() => { /* probe failures shouldn't break the app */ })

    const unlisten = listen<CliHealthReport[]>('cli:health', (payload) => {
      if (!cancelled) setReports(payload)
    })
    return () => {
      cancelled = true
      void unlisten.then((off) => { off() })
    }
  }, [])

  const concerning = reports.filter(isCliHealthConcerning)
  // Re-show after a dismiss only when the set of problems changes.
  const signature = concerning
    .map((r) => `${r.id}:${r.status}:${r.missingFlags.join('|')}:${r.version ?? ''}`)
    .join(';')
  const visible = concerning.length > 0 && signature !== dismissedKey

  const handleRecheck = () => {
    setRechecking(true)
    checkCliHealth()
      .then(setReports)
      .catch(() => { /* keep prior state */ })
      .finally(() => { setRechecking(false) })
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="flex items-start justify-between gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm">
            <div className="min-w-0 text-text-primary">
              <span className="font-medium text-warning">Agent CLI compatibility warning. </span>
              {concerning.map((r) => (
                <span key={r.id} className="mr-3 text-text-secondary">
                  {r.name}
                  {r.status === 'outdated'
                    ? ` is ${r.version ?? 'older'} (need ≥ ${r.minVersion ?? '?'})`
                    : ` is missing expected flags: ${r.missingFlags.join(', ')}`}
                  .
                </span>
              ))}
              <span className="text-text-secondary/80">Agent runs may misbehave until the CLI is updated.</span>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button
                onClick={handleRecheck}
                disabled={rechecking}
                className="rounded bg-warning/20 px-2.5 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/30 disabled:opacity-50"
                style={{ cursor: rechecking ? 'wait' : 'pointer' }}
              >
                {rechecking ? 'Checking…' : 'Re-check'}
              </button>
              <button
                onClick={() => { setDismissedKey(signature) }}
                className="text-text-secondary transition-colors hover:text-text-primary"
                aria-label="Dismiss"
                style={{ cursor: 'pointer' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
