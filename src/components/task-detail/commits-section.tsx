import { useState } from 'react'
import type { CommitInfo } from '@/hooks/use-git'

type CommitsSectionProps = {
  commits: CommitInfo[]
}

const COMMIT_LIST_LIMIT = 3

export function CommitsSection({ commits }: CommitsSectionProps) {
  const [expanded, setExpanded] = useState(false)

  if (commits.length === 0) {
    return (
      <div className="px-3 py-2">
        <span className="text-xs text-text-secondary">No commits</span>
      </div>
    )
  }

  const hiddenCommitCount = Math.max(0, commits.length - COMMIT_LIST_LIMIT)
  const visibleCommits = expanded ? commits : commits.slice(0, COMMIT_LIST_LIMIT)

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-text-primary">
          {commits.length} commit{commits.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="mt-2 space-y-1">
        {visibleCommits.map((commit) => (
          <div
            key={commit.hash}
            className="flex items-start gap-2 rounded px-2 py-1 text-xs hover:bg-surface-hover"
          >
            <span className="shrink-0 font-mono text-xs text-accent">
              {commit.shortHash}
            </span>
            <span className="flex-1 truncate text-text-primary">
              {commit.message}
            </span>
          </div>
        ))}
        {hiddenCommitCount > 0 && (
          <button
            type="button"
            onClick={() => { setExpanded((current) => !current) }}
            className="flex w-full items-center justify-center rounded px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            style={{ cursor: 'pointer' }}
          >
            {expanded ? 'Show less' : `Show ${String(hiddenCommitCount)} more`}
          </button>
        )}
      </div>
    </div>
  )
}
