import type { Task } from '@/types'
import type { AttentionItem } from '@/stores/attention-store'
import { ATTENTION_LABELS } from '@/stores/attention-store'

/** Attention/needs-attention banner */
export function AttentionBanner({ attention }: { attention: AttentionItem }) {
  return (
    <div className="flex items-center gap-1.5 rounded bg-attention/10 px-2 py-1 text-xs text-attention">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 shrink-0">
        <path fillRule="evenodd" d="M6.701 2.25c.577-1 2.02-1 2.598 0l5.196 9a1.5 1.5 0 0 1-1.299 2.25H2.804a1.5 1.5 0 0 1-1.3-2.25l5.197-9ZM8 5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 5Zm0 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
      </svg>
      <span className="truncate">{ATTENTION_LABELS[attention.reason]}</span>
    </div>
  )
}

/** Blocked by dependencies banner */
export function BlockedBanner({ blockerInfo }: { blockerInfo: string | null }) {
  return (
    <div className="flex items-center gap-1.5 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-400">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 shrink-0">
        <path fillRule="evenodd" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7A1.5 1.5 0 0 0 3 8.5v5A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 11.5 7V4.5A3.5 3.5 0 0 0 8 1Zm2 6V4.5a2 2 0 1 0-4 0V7h4Z" clipRule="evenodd" />
      </svg>
      <span className="truncate">
        {blockerInfo ? `Blocked by: ${blockerInfo}` : 'Blocked'}
      </span>
    </div>
  )
}

/** Quality gate review status badge */
export function QualityGateBanner({ reviewStatus }: { reviewStatus: string | null }) {
  const colorClass =
    reviewStatus === 'approved' ? 'bg-success/10 text-success' :
    reviewStatus === 'rejected' ? 'bg-error/10 text-error' :
    'bg-amber-500/10 text-amber-500'

  return (
    <div className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs ${colorClass}`}>
      {reviewStatus === 'approved' ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 shrink-0">
          <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm3.844-8.791a.75.75 0 0 0-1.188-.918l-3.7 4.79-1.649-1.833a.75.75 0 1 0-1.114 1.004l2.25 2.5a.75.75 0 0 0 1.151-.043l4.25-5.5Z" clipRule="evenodd" />
        </svg>
      ) : reviewStatus === 'rejected' ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 shrink-0">
          <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm2.78-4.22a.75.75 0 0 1-1.06 0L8 9.06l-1.72 1.72a.75.75 0 1 1-1.06-1.06L6.94 8 5.22 6.28a.75.75 0 0 1 1.06-1.06L8 6.94l1.72-1.72a.75.75 0 1 1 1.06 1.06L9.06 8l1.72 1.72a.75.75 0 0 1 0 1.06Z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 shrink-0">
          <path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
        </svg>
      )}
      <span className="truncate">
        {reviewStatus === 'approved' ? 'Approved' :
         reviewStatus === 'rejected' ? 'Rejected' :
         'Pending Review'}
      </span>
    </div>
  )
}

/** Pipeline error banner with retry button */
export function PipelineErrorBanner({
  task,
  onRetry,
}: {
  task: Task
  onRetry: () => void
}) {
  return (
    <div className="flex items-center gap-1.5 rounded bg-error/10 px-2 py-1 text-xs text-error">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 shrink-0">
        <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm.75-8.25a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 1.5 0v-3.5ZM8 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
      </svg>
      <span className="truncate flex-1">{task.pipelineError}{task.retryCount > 0 && ` (${task.retryCount} retries)`}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRetry()
        }}
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-error/20 hover:bg-error/30 transition-colors"
      >
        Retry
      </button>
    </div>
  )
}
