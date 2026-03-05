import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { getWorkspaceHistory, type SessionSnapshot } from '@/lib/ipc'
import { formatDuration, formatDateWithTime } from '@/lib/format'

type Props = {
  workspaceId: string
  onClose: () => void
  onReplay?: (snapshot: SessionSnapshot) => void
}

function getStatusColor(type: string): string {
  switch (type) {
    case 'complete': return 'bg-success'
    case 'error': return 'bg-error'
    default: return 'bg-accent'
  }
}

function getStatusLabel(type: string): string {
  switch (type) {
    case 'complete': return 'Complete'
    case 'error': return 'Error'
    default: return 'Checkpoint'
  }
}

export function HistoryPanel({ workspaceId, onClose, onReplay }: Props) {
  const [snapshots, setSnapshots] = useState<SessionSnapshot[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedSnapshot, setSelectedSnapshot] = useState<SessionSnapshot | null>(null)

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      try {
        const data = await getWorkspaceHistory(workspaceId, 100)
        setSnapshots(data)
      } catch {
        // Ignore errors
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [workspaceId])

  const parseJsonArray = (json: string): string[] => {
    try {
      return JSON.parse(json) as string[]
    } catch {
      return []
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="flex max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-border-default bg-surface shadow-2xl"
      >
        {/* Sidebar - Session List */}
        <div className="flex w-80 flex-col border-r border-border-default">
          <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
            <h2 className="font-semibold text-text-primary">Session History</h2>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-bg hover:text-text-primary"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <span className="text-sm text-text-secondary">Loading history...</span>
              </div>
            ) : snapshots.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="mb-3 text-4xl">0</div>
                <p className="text-sm text-text-secondary">No session history yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border-default">
                {snapshots.map((snapshot) => (
                  <button
                    key={snapshot.id}
                    onClick={() => { setSelectedSnapshot(snapshot) }}
                    className={`w-full px-4 py-3 text-left transition-colors hover:bg-bg ${
                      selectedSnapshot?.id === snapshot.id ? 'bg-bg' : ''
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${getStatusColor(snapshot.snapshotType)}`} />
                      <span className="text-xs font-medium text-text-secondary">
                        {getStatusLabel(snapshot.snapshotType)}
                      </span>
                      <span className="text-xs text-text-secondary">
                        {formatDuration(snapshot.durationMs)}
                      </span>
                    </div>
                    <div className="text-sm text-text-primary">
                      {formatDateWithTime(snapshot.createdAt)}
                    </div>
                    <div className="mt-1 text-xs text-text-secondary">
                      {parseJsonArray(snapshot.filesModified).length} files modified
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Main Content - Snapshot Details */}
        <div className="flex flex-1 flex-col">
          {selectedSnapshot ? (
            <>
              <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${getStatusColor(selectedSnapshot.snapshotType)}`} />
                    <h3 className="font-semibold text-text-primary">
                      {getStatusLabel(selectedSnapshot.snapshotType)} Session
                    </h3>
                  </div>
                  <p className="mt-1 text-sm text-text-secondary">
                    {formatDateWithTime(selectedSnapshot.createdAt)} • Duration: {formatDuration(selectedSnapshot.durationMs)}
                  </p>
                </div>
                {onReplay && (
                  <button
                    onClick={() => { onReplay(selectedSnapshot) }}
                    className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z" />
                    </svg>
                    Replay
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-6">
                  {/* Files Modified */}
                  <div>
                    <h4 className="mb-3 text-sm font-medium text-text-secondary">Files Modified</h4>
                    <div className="rounded-lg border border-border-default bg-bg">
                      {parseJsonArray(selectedSnapshot.filesModified).length > 0 ? (
                        <div className="divide-y divide-border-default">
                          {parseJsonArray(selectedSnapshot.filesModified).map((file, i) => (
                            <div key={i} className="flex items-center gap-2 px-3 py-2">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-text-secondary">
                                <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h6.879a1.5 1.5 0 0 1 1.06.44l4.122 4.12A1.5 1.5 0 0 1 17 7.622V16.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16.5v-13Z" />
                              </svg>
                              <span className="font-mono text-xs text-text-primary">{file}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="px-3 py-4 text-center text-sm text-text-secondary">
                          No files modified
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Commands */}
                  <div>
                    <h4 className="mb-3 text-sm font-medium text-text-secondary">Commands Executed</h4>
                    <div className="rounded-lg border border-border-default bg-bg">
                      {parseJsonArray(selectedSnapshot.commandHistory).length > 0 ? (
                        <div className="divide-y divide-border-default">
                          {parseJsonArray(selectedSnapshot.commandHistory).map((cmd, i) => (
                            <div key={i} className="px-3 py-2">
                              <code className="font-mono text-xs text-text-primary">{cmd}</code>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="px-3 py-4 text-center text-sm text-text-secondary">
                          No commands recorded
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Scrollback Preview */}
                  {selectedSnapshot.scrollbackSnapshot && (
                    <div>
                      <h4 className="mb-3 text-sm font-medium text-text-secondary">Terminal Output</h4>
                      <div className="max-h-64 overflow-y-auto rounded-lg border border-border-default bg-[#1a1b26] p-4">
                        <pre className="whitespace-pre-wrap font-mono text-xs text-[#a9b1d6]">
                          {selectedSnapshot.scrollbackSnapshot.slice(0, 5000)}
                          {selectedSnapshot.scrollbackSnapshot.length > 5000 && (
                            <span className="text-text-secondary">... (truncated)</span>
                          )}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="mx-auto mb-3 h-12 w-12 text-text-secondary/50">
                  <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 0 0 0-1.5h-3.75V6Z" clipRule="evenodd" />
                </svg>
                <p className="text-text-secondary">Select a session to view details</p>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
