import { useEffect, useState } from 'react'
import type { ChangeSummary } from '@/hooks/use-git'
import { DiffViewer } from '@/components/review/diff-viewer'

type DiffSectionProps = {
  branch: string | null
  changes: ChangeSummary | null
  loading: boolean
  diffLoading: boolean
  diffError: string | null
  diffByFile: Record<string, string>
  loadDiff: (filePath: string | null) => Promise<string>
  compact?: boolean
  maxDiffHeight?: number | string
  onSendToAgent?: (content: string) => void
}

const ALL_FILES = '__all__'
const FILE_LIST_LIMIT = 6

export function DiffSection({
  branch,
  changes,
  loading,
  diffLoading,
  diffError,
  diffByFile,
  loadDiff,
  compact = false,
  maxDiffHeight,
  onSendToAgent,
}: DiffSectionProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [filesExpanded, setFilesExpanded] = useState(false)

  // Reset selection when branch changes
  useEffect(() => {
    setSelectedFile(null)
    setShowAll(false)
    setFilesExpanded(false)
  }, [branch])

  if (!branch) {
    return (
      <div className="rounded-md border border-border-default bg-surface px-3 py-3" data-testid="changes-empty-no-branch">
        <span className="text-xs text-text-secondary">
          No branch on this task — create one to see diffs.
        </span>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="rounded-md border border-border-default bg-surface px-3 py-3" data-testid="changes-loading">
        <span className="text-xs text-text-secondary">Loading changes…</span>
      </div>
    )
  }

  if (!changes || changes.totalFiles === 0) {
    return (
      <div className="rounded-md border border-border-default bg-surface px-3 py-3" data-testid="changes-empty">
        <span className="text-xs text-text-secondary">No changes on this branch.</span>
      </div>
    )
  }

  const currentKey = showAll ? ALL_FILES : selectedFile
  const currentDiff = currentKey ? diffByFile[currentKey] : undefined
  const hiddenFileCount = Math.max(0, changes.files.length - FILE_LIST_LIMIT)
  const visibleFiles = filesExpanded ? changes.files : changes.files.slice(0, FILE_LIST_LIMIT)

  async function selectFile(path: string) {
    if (selectedFile === path && !showAll) {
      setSelectedFile(null)
      return
    }
    setShowAll(false)
    setSelectedFile(path)
    if (diffByFile[path] === undefined) {
      await loadDiff(path)
    }
  }

  async function toggleAll() {
    if (showAll) {
      setShowAll(false)
      return
    }
    setShowAll(true)
    setSelectedFile(null)
    if (diffByFile[ALL_FILES] === undefined) {
      await loadDiff(null)
    }
  }

  return (
    <div className="rounded-md border border-border-default bg-surface" data-testid="changes-panel">
      {/* Summary header */}
      <div className={`flex items-center justify-between gap-2 border-b border-border-default ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-primary">
            {changes.totalFiles} file{changes.totalFiles !== 1 ? 's' : ''}
          </span>
          <span className="text-xs text-success">+{changes.totalAdditions}</span>
          <span className="text-xs text-error">-{changes.totalDeletions}</span>
        </div>
        <button
          type="button"
          onClick={() => { void toggleAll() }}
          className="text-[11px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline"
          style={{ cursor: 'pointer' }}
        >
          {showAll ? 'Hide combined diff' : 'View all'}
        </button>
      </div>

      {/* File list */}
      <div className={`${compact ? 'max-h-56' : 'max-h-40'} overflow-y-auto px-1 py-1`}>
        {visibleFiles.map((file) => {
          const active = selectedFile === file.path && !showAll
          return (
            <button
              key={file.path}
              type="button"
              onClick={() => { void selectFile(file.path) }}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                active ? 'bg-accent/15' : 'hover:bg-surface-hover'
              }`}
              style={{ cursor: 'pointer' }}
            >
              <StatusIcon status={file.status} />
              <span
                className={`flex-1 truncate font-mono text-[11px] ${
                  active ? 'text-text-primary' : 'text-text-secondary'
                }`}
                title={file.path}
              >
                {file.path}
              </span>
              <span className="text-success">+{file.additions}</span>
              <span className="text-error">-{file.deletions}</span>
            </button>
          )
        })}
        {hiddenFileCount > 0 && (
          <button
            type="button"
            onClick={() => { setFilesExpanded((current) => !current) }}
            className="mt-1 flex w-full items-center justify-center rounded px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            style={{ cursor: 'pointer' }}
          >
            {filesExpanded ? 'Show less' : `Show ${String(hiddenFileCount)} more`}
          </button>
        )}
      </div>

      {/* Diff pane */}
      {(selectedFile || showAll) && (
        <div
          className="overflow-auto border-t border-border-default"
          style={{ maxHeight: maxDiffHeight ?? (compact ? 'calc(100vh - 320px)' : 320) }}
          data-card-click-interactive="true"
        >
          {diffLoading && currentDiff === undefined ? (
            <div className="px-3 py-3 text-xs text-text-secondary">Loading diff…</div>
          ) : diffError ? (
            <div className="px-3 py-3 text-xs text-error">
              Failed to load diff: {diffError}
            </div>
          ) : currentDiff === undefined ? (
            <div className="px-3 py-3 text-xs text-text-secondary">No diff available.</div>
          ) : (
            <div className={compact ? 'p-1.5' : 'p-2'}>
              <DiffViewer
                diff={currentDiff}
                defaultCollapsed={showAll}
                compact={compact}
                selectable={Boolean(onSendToAgent)}
                onSendToAgent={onSendToAgent}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  const color =
    status === 'added'
      ? 'text-success'
      : status === 'deleted'
        ? 'text-error'
        : status === 'modified'
          ? 'text-warning'
          : 'text-text-secondary'
  const letter = status[0]?.toUpperCase() ?? '?'

  return (
    <span className={`w-3 shrink-0 text-center font-mono text-[10px] font-bold ${color}`}>
      {letter}
    </span>
  )
}
