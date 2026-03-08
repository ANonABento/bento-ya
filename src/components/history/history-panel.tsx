import { useState, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { getWorkspaceHistory, restoreSnapshot, type SessionSnapshot } from '@/lib/ipc'

type Props = {
  workspaceId: string
  onClose: () => void
  onRestore?: (backupId: string) => void
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  return `${String(mins)}m ${String(secs)}s`
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return `Today at ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
  } else if (diffDays === 1) {
    return `Yesterday at ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
  } else if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'long', hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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

export function HistoryPanel({ workspaceId, onClose, onRestore }: Props) {
  const [snapshots, setSnapshots] = useState<SessionSnapshot[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedSnapshot, setSelectedSnapshot] = useState<SessionSnapshot | null>(null)
  const [isRestoring, setIsRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  const handleRestore = useCallback(async (snapshot: SessionSnapshot) => {
    if (isRestoring) return

    setIsRestoring(true)
    setRestoreError(null)

    try {
      const result = await restoreSnapshot({
        snapshotId: snapshot.id,
        currentSessionId: snapshot.sessionId,
        currentWorkspaceId: workspaceId,
        currentTaskId: snapshot.taskId ?? undefined,
        currentScrollback: undefined,
        currentCommandHistory: '[]',
        currentFilesModified: '[]',
        currentDurationMs: 0,
      })

      // Call onRestore callback with backup ID so parent can show notification
      onRestore?.(result.backupId)
      onClose()
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : 'Failed to restore snapshot')
    } finally {
      setIsRestoring(false)
    }
  }, [isRestoring, workspaceId, onRestore, onClose])

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
                      {formatDate(snapshot.createdAt)}
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
                    {formatDate(selectedSnapshot.createdAt)} • Duration: {formatDuration(selectedSnapshot.durationMs)}
                  </p>
                </div>
                <button
                  onClick={() => { void handleRestore(selectedSnapshot) }}
                  disabled={isRestoring}
                  className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
                >
                  {isRestoring ? (
                    <>
                      <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Restoring...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0v2.43l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z" clipRule="evenodd" />
                      </svg>
                      Restore
                    </>
                  )}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                {restoreError && (
                  <div className="mb-4 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
                    {restoreError}
                  </div>
                )}
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
