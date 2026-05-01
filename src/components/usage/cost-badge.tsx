import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useWorkspaceUsage } from '@/hooks/use-workspace-usage'
import { formatUsageCost, formatUsageTokens, shortModelName } from '@/lib/usage'

type Props = {
  workspaceId: string
  onOpenDashboard?: () => void
}

export function CostBadge({ workspaceId, onOpenDashboard }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const { summary, records, isLoading, error, refresh } = useWorkspaceUsage(workspaceId, {
    enabled: isOpen,
    limit: 20,
  })

  const totalCost = summary?.totalCostUsd ?? 0

  return (
    <div className="relative">
      <button
        onClick={() => { setIsOpen(!isOpen) }}
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-colors ${
          totalCost > 0
            ? 'bg-accent/10 text-accent hover:bg-accent/20'
            : 'bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary'
        }`}
        title="Usage costs"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-3.5 w-3.5"
        >
          <path d="M10.75 10.818v2.614A3.13 3.13 0 0 0 11.888 13c.482-.315.612-.648.612-.875 0-.227-.13-.56-.612-.875a3.13 3.13 0 0 0-1.138-.432ZM8.33 8.62c.053.055.115.11.184.164.208.16.46.284.736.363V6.603a2.45 2.45 0 0 0-.35.13c-.14.065-.27.143-.386.233-.377.292-.514.627-.514.909 0 .184.058.39.202.592.037.051.08.102.128.152Z" />
          <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-6a.75.75 0 0 1 .75.75v.316a3.78 3.78 0 0 1 1.653.713c.426.33.744.74.925 1.2a.75.75 0 0 1-1.395.55 1.35 1.35 0 0 0-.447-.563 2.187 2.187 0 0 0-.736-.363V9.3c.698.093 1.383.32 1.959.696.787.514 1.29 1.27 1.29 2.13 0 .86-.504 1.616-1.29 2.13-.576.377-1.261.603-1.96.696v.299a.75.75 0 1 1-1.5 0v-.3a3.78 3.78 0 0 1-1.653-.713 2.97 2.97 0 0 1-.925-1.2.75.75 0 0 1 1.395-.55c.12.308.313.524.447.563.235.18.505.317.736.363v-2.614a3.78 3.78 0 0 1-1.959-.696C6.503 9.746 6 8.99 6 8.13c0-.86.504-1.616 1.29-2.13.576-.377 1.261-.603 1.96-.696v-.549A.75.75 0 0 1 10 4Z" clipRule="evenodd" />
        </svg>
        <span className="font-medium">{formatUsageCost(totalCost)}</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => { setIsOpen(false) }}
            />

            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-border-default bg-surface p-4 shadow-xl"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-text-primary">Usage Summary</h3>
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

              {isLoading ? (
                <div className="flex items-center justify-center py-6">
                  <span className="text-sm text-text-secondary">Loading...</span>
                </div>
              ) : error ? (
                <div className="rounded-lg bg-red-500/10 px-3 py-4 text-sm text-red-400">
                  {error}
                </div>
              ) : summary && summary.recordCount > 0 ? (
                <>
                  <div className="mb-4 grid grid-cols-3 gap-3">
                    <div className="rounded-lg bg-bg p-3 text-center">
                      <div className="text-lg font-semibold text-accent">
                        {formatUsageCost(summary.totalCostUsd)}
                      </div>
                      <div className="text-xs text-text-secondary">Total Cost</div>
                    </div>
                    <div className="rounded-lg bg-bg p-3 text-center">
                      <div className="text-lg font-semibold text-text-primary">
                        {formatUsageTokens(summary.totalInputTokens)}
                      </div>
                      <div className="text-xs text-text-secondary">Input</div>
                    </div>
                    <div className="rounded-lg bg-bg p-3 text-center">
                      <div className="text-lg font-semibold text-text-primary">
                        {formatUsageTokens(summary.totalOutputTokens)}
                      </div>
                      <div className="text-xs text-text-secondary">Output</div>
                    </div>
                  </div>

                  <div className="border-t border-border-default pt-3">
                    <div className="mb-2 text-xs font-medium text-text-secondary">
                      Recent Usage ({summary.recordCount} records)
                    </div>
                    <div className="max-h-40 space-y-1.5 overflow-y-auto">
                      {records.map((record) => (
                        <div
                          key={record.id}
                          className="flex items-center justify-between rounded bg-bg px-2 py-1.5 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-text-secondary">
                              {shortModelName(record.model)}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-text-secondary">
                              {formatUsageTokens(record.inputTokens + record.outputTokens)}
                            </span>
                            <span className="font-medium text-accent">
                              {formatUsageCost(record.costUsd)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {onOpenDashboard && (
                    <div className="mt-3 border-t border-border-default pt-3">
                      <button
                        onClick={() => {
                          setIsOpen(false)
                          onOpenDashboard()
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-bg py-2 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                          <path fillRule="evenodd" d="M4.25 2A2.25 2.25 0 0 0 2 4.25v11.5A2.25 2.25 0 0 0 4.25 18h11.5A2.25 2.25 0 0 0 18 15.75V4.25A2.25 2.25 0 0 0 15.75 2H4.25ZM15 5.75a.75.75 0 0 0-1.5 0v8.5a.75.75 0 0 0 1.5 0v-8.5Zm-8.5 6a.75.75 0 0 0-1.5 0v2.5a.75.75 0 0 0 1.5 0v-2.5ZM8.584 9a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5a.75.75 0 0 1 .75-.75Zm3.58-1.25a.75.75 0 0 0-1.5 0v6.5a.75.75 0 0 0 1.5 0v-6.5Z" clipRule="evenodd" />
                        </svg>
                        View Full Dashboard
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center py-6">
                  <div className="text-center">
                    <div className="mb-2 text-2xl">0</div>
                    <span className="text-sm text-text-secondary">
                      No usage recorded yet
                    </span>
                  </div>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
