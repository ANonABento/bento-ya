import { useState } from 'react'
import type { CommitInfo } from '@/hooks/use-git'

type CommitsSectionProps = {
  commits: CommitInfo[]
}

export function CommitsSection({ commits }: CommitsSectionProps) {
  const [expanded, setExpanded] = useState(false)

  if (commits.length === 0) {
    return (
      <div className="px-3 py-2">
        <span className="text-xs text-text-secondary">No commits</span>
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
          {commits.length} commit{commits.length !== 1 ? 's' : ''}
        </span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1">
          {commits.map((commit) => (
            <div
              key={commit.hash}
              className="flex items-start gap-2 rounded px-2 py-1 text-xs hover:bg-surface-hover"
            >
              <span className="shrink-0 font-mono text-[11px] text-accent">
                {commit.shortHash}
              </span>
              <span className="flex-1 truncate text-text-primary">
                {commit.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
