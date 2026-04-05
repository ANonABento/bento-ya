import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { getConflictMatrix, type ConflictEntry, type ConflictMatrix } from '@/lib/ipc'

type Props = {
  repoPath: string
}

function getHeatColor(branchCount: number): string {
  if (branchCount >= 4) return 'bg-error'
  if (branchCount === 3) return 'bg-warning'
  return 'bg-accent'
}

export function ConflictHeatmap({ repoPath }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [matrix, setMatrix] = useState<ConflictMatrix | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await getConflictMatrix(repoPath)
      setMatrix(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conflict data')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen && !matrix) {
      void refresh()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const conflictCount = matrix?.conflicts.length ?? 0

  return (
    <div className="relative">
      <button
        onClick={() => { setIsOpen(!isOpen) }}
        className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
          conflictCount > 0
            ? 'bg-warning/20 text-warning hover:bg-warning/30'
            : 'bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary'
        }`}
        title="Branch conflict heatmap"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4"
        >
          <path d="M12.232 4.232a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224a4 4 0 0 0-5.656-5.656l-3 3a4 4 0 0 0 .225 5.865.75.75 0 0 0 .977-1.138 2.5 2.5 0 0 1-.142-3.667l3-3Z" />
          <path d="M11.603 7.963a.75.75 0 0 0-.977 1.138 2.5 2.5 0 0 1 .142 3.667l-3 3a2.5 2.5 0 0 1-3.536-3.536l1.225-1.224a.75.75 0 0 0-1.061-1.06l-1.224 1.224a4 4 0 1 0 5.656 5.656l3-3a4 4 0 0 0-.225-5.865Z" />
        </svg>
        {conflictCount > 0 ? (
          <span>{conflictCount} conflict{conflictCount !== 1 ? 's' : ''}</span>
        ) : (
          <span>Conflicts</span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => { setIsOpen(false) }}
            />

            {/* Dropdown */}
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="absolute right-0 top-full z-50 mt-2 w-96 rounded-xl border border-border-default bg-surface p-4 shadow-xl"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-text-primary">Branch Conflicts</h3>
                <button
                  onClick={() => { void refresh() }}
                  disabled={isLoading}
                  className="rounded p-1 text-text-secondary transition-colors hover:bg-bg hover:text-text-primary disabled:opacity-50"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
                  >
                    <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0v2.43l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>

              {error && (
                <div className="mb-3 rounded-lg bg-error/10 px-3 py-2 text-sm text-error">
                  {error}
                </div>
              )}

              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <span className="text-sm text-text-secondary">Analyzing branches...</span>
                </div>
              ) : matrix?.hasConflicts ? (
                <div className="max-h-80 space-y-2 overflow-y-auto">
                  {matrix.conflicts.map((conflict) => (
                    <ConflictRow key={conflict.file} conflict={conflict} />
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center py-8">
                  <div className="text-center">
                    <div className="mb-2 text-2xl text-success">&#10003;</div>
                    <span className="text-sm text-text-secondary">
                      No potential conflicts detected
                    </span>
                  </div>
                </div>
              )}

              <div className="mt-3 border-t border-border-default pt-3">
                <div className="flex items-center gap-4 text-xs text-text-secondary">
                  <div className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-accent" />
                    <span>2 branches</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-warning" />
                    <span>3 branches</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-error" />
                    <span>4+ branches</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function ConflictRow({ conflict }: { conflict: ConflictEntry }) {
  const [expanded, setExpanded] = useState(false)
  const branchCount = conflict.branches.length
  const heatColor = getHeatColor(branchCount)

  return (
    <div className="rounded-lg border border-border-default bg-bg">
      <button
        onClick={() => { setExpanded(!expanded) }}
        className="flex w-full items-center gap-3 px-3 py-2 text-left"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${heatColor}`} />
        <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
          {conflict.file}
        </span>
        <span className="shrink-0 text-xs text-text-secondary">
          {branchCount} branches
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`h-3 w-3 text-text-secondary transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border-default"
          >
            <div className="px-3 py-2">
              <div className="space-y-1">
                {conflict.branches.map((branch) => (
                  <div
                    key={branch}
                    className="flex items-center gap-2 text-xs text-text-secondary"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className="h-3 w-3"
                    >
                      <path fillRule="evenodd" d="M9.965 2.018a.75.75 0 0 1 .813.68l.69 7.893a.75.75 0 1 1-1.494.13l-.5-5.725-4.22 4.22a.75.75 0 0 1-1.13-.094l-2.5-3.5a.75.75 0 0 1 1.202-.896l1.913 2.678 4.238-4.238a.75.75 0 0 1 .988-.148Z" clipRule="evenodd" />
                    </svg>
                    <span className="font-mono">{branch.replace('bentoya/', '')}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
