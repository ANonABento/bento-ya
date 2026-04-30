import { useState, useEffect, useCallback } from 'react'
import type { BatchSummary, Task } from '@/types'
import * as ipc from '@/lib/ipc'
import { useWorkspaceStore } from '@/stores/workspace-store'

// ─── BatchesTab ──────────────────────────────────────────────────────────────

export function BatchesTab() {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const [batches, setBatches] = useState<BatchSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [merging, setMerging] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const result = await ipc.listBatches(workspaceId)
      setBatches(result)
    } catch (err) {
      console.error('Failed to load batches:', err)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { void load() }, [load])

  const handleForceMerge = async (batchId: string) => {
    if (!workspaceId) return
    setMerging(batchId)
    setMessage(null)
    try {
      const prUrl = await ipc.forceMergeBatch(workspaceId, batchId)
      setMessage({
        text: prUrl ? `PR created: ${prUrl}` : 'Batch PR already exists or staging branch has no commits.',
        kind: 'success',
      })
      void load()
    } catch (err) {
      setMessage({ text: String(err), kind: 'error' })
    } finally {
      setMerging(null)
    }
  }

  const handleRetry = async (batchId: string) => {
    if (!workspaceId) return
    setRetrying(batchId)
    setMessage(null)
    try {
      const retried = await ipc.retryBatch(workspaceId, batchId)
      setMessage({ text: `Retried ${retried.length} task(s).`, kind: 'success' })
      void load()
    } catch (err) {
      setMessage({ text: String(err), kind: 'error' })
    } finally {
      setRetrying(null)
    }
  }

  if (!workspaceId) {
    return <div className="text-sm text-text-secondary">No workspace selected.</div>
  }

  if (loading) {
    return <div className="text-sm text-text-secondary">Loading batches...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          Batches group related tasks queued together for staging-branch PR workflows.
        </p>
        <button
          onClick={() => { void load() }}
          className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface hover:text-text-primary transition-colors"
        >
          Refresh
        </button>
      </div>

      {message && (
        <div
          className={`rounded-lg p-3 text-sm ${
            message.kind === 'success'
              ? 'bg-green-500/10 text-green-400'
              : 'bg-red-500/10 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {batches.length === 0 ? (
        <div className="rounded-lg border border-border-default bg-surface/50 p-6 text-center text-sm text-text-secondary">
          No batches found for this workspace.
        </div>
      ) : (
        <div className="space-y-3">
          {batches.map((batch) => (
            <BatchCard
              key={batch.batchId}
              batch={batch}
              isMerging={merging === batch.batchId}
              isRetrying={retrying === batch.batchId}
              onForceMerge={handleForceMerge}
              onRetry={handleRetry}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── BatchCard ───────────────────────────────────────────────────────────────

type BatchCardProps = {
  batch: BatchSummary
  isMerging: boolean
  isRetrying: boolean
  onForceMerge: (batchId: string) => void
  onRetry: (batchId: string) => void
}

function BatchCard({ batch, isMerging, isRetrying, onForceMerge, onRetry }: BatchCardProps) {
  const [expanded, setExpanded] = useState(false)

  const pendingCount = batch.taskCount - batch.prCount - batch.failedCount
  const allComplete = batch.prCount === batch.taskCount

  return (
    <div className="rounded-lg border border-border-default bg-surface/30">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-text-secondary hover:text-text-primary transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            <path
              fillRule="evenodd"
              d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <code className="text-xs font-mono text-text-primary">{batch.batchId}</code>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-text-secondary">
            <span>{batch.taskCount} task{batch.taskCount !== 1 ? 's' : ''}</span>
            <span className="text-green-400">{batch.prCount} PR{batch.prCount !== 1 ? 's' : ''}</span>
            {batch.failedCount > 0 && (
              <span className="text-red-400">{batch.failedCount} failed</span>
            )}
            {pendingCount > 0 && (
              <span className="text-yellow-400">{pendingCount} pending</span>
            )}
            {allComplete && (
              <span className="text-green-400 font-medium">complete</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {batch.failedCount > 0 && (
            <button
              onClick={() => onRetry(batch.batchId)}
              disabled={isRetrying}
              className="rounded px-2.5 py-1 text-xs font-medium text-yellow-400 border border-yellow-400/30 hover:bg-yellow-400/10 disabled:opacity-50 transition-colors"
            >
              {isRetrying ? 'Retrying…' : `Retry ${batch.failedCount} failed`}
            </button>
          )}
          <button
            onClick={() => onForceMerge(batch.batchId)}
            disabled={isMerging}
            className="rounded px-2.5 py-1 text-xs font-medium text-accent border border-accent/30 hover:bg-accent/10 disabled:opacity-50 transition-colors"
          >
            {isMerging ? 'Merging…' : 'Force Merge'}
          </button>
        </div>
      </div>

      {/* Expanded task list */}
      {expanded && (
        <div className="border-t border-border-default px-4 py-2 space-y-1.5">
          {batch.tasks.map((task) => (
            <div key={task.id} className="flex items-center gap-2 py-1 text-sm">
              <StatusDot task={task} />
              <span className="flex-1 truncate text-text-primary">{task.title}</span>
              {task.prNumber && (
                <span className="text-xs text-text-secondary">PR #{task.prNumber}</span>
              )}
              {task.pipelineError && (
                <span className="max-w-[200px] truncate text-xs text-red-400" title={task.pipelineError}>
                  {task.pipelineError}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusDot({ task }: { task: Task }) {
  if (task.pipelineError) {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" title="Failed" />
  }
  if (task.prNumber) {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-green-400" title="PR created" />
  }
  if (task.pipelineState !== 'idle') {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-blue-400 animate-pulse" title="Running" />
  }
  return <span className="h-2 w-2 shrink-0 rounded-full bg-surface border border-border-default" title="Queued" />
}
