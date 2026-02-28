import { useState } from 'react'
import type { ChangeSummary } from '@/hooks/use-git'

type ChangesSectionProps = {
  changes: ChangeSummary | null
  loading: boolean
}

export function ChangesSection({ changes, loading }: ChangesSectionProps) {
  const [expanded, setExpanded] = useState(false)

  if (loading) {
    return (
      <div className="px-3 py-2">
        <span className="text-xs text-text-secondary">Loading changes...</span>
      </div>
    )
  }

  if (!changes || changes.totalFiles === 0) {
    return (
      <div className="px-3 py-2">
        <span className="text-xs text-text-secondary">No changes</span>
      </div>
    )
  }

  return (
    <div className="px-3 py-2">
      <button
        type="button"
        onClick={() => { setExpanded(!expanded) }}
        className="flex w-full items-center gap-2 text-left"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className={`text-text-secondary transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          <path d="M4 2l4 4-4 4" />
        </svg>
        <span className="text-xs font-medium text-text-primary">
          {changes.totalFiles} file{changes.totalFiles !== 1 ? 's' : ''}
        </span>
        <span className="text-xs text-success">+{changes.totalAdditions}</span>
        <span className="text-xs text-error">-{changes.totalDeletions}</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1">
          {changes.files.map((file) => (
            <div
              key={file.path}
              className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-surface-hover"
            >
              <StatusIcon status={file.status} />
              <span className="flex-1 truncate font-mono text-[11px] text-text-primary">
                {file.path}
              </span>
              <span className="text-success">+{file.additions}</span>
              <span className="text-error">-{file.deletions}</span>
            </div>
          ))}
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
    <span className={`w-3 text-center font-mono text-[10px] font-bold ${color}`}>
      {letter}
    </span>
  )
}
