import type { Task } from '@/types'
import { DEFAULT_SETTINGS } from '@/types/settings'

// Compact PR status indicator
export function PrStatusIndicator({ task, settings }: { task: Task; settings: typeof DEFAULT_SETTINGS.cards }) {
  if (!task.prNumber) return null

  const showAny = settings.showPrBadge || settings.showCiStatus || settings.showReviewStatus || settings.showMergeStatus

  if (!showAny) return null

  // Determine the most important status to show
  const hasConflict = task.prMergeable === 'conflicted'
  const hasCiFail = task.prCiStatus === 'failure' || task.prCiStatus === 'error'
  const hasChangesRequested = task.prReviewDecision === 'changes_requested'
  const isApproved = task.prReviewDecision === 'approved'
  const ciPending = task.prCiStatus === 'pending'
  const ciSuccess = task.prCiStatus === 'success'

  // Priority: conflict > ci fail > changes requested > ci pending > approved > success
  let statusColor = 'text-text-secondary'
  let statusIcon = null

  if (settings.showMergeStatus && hasConflict) {
    statusColor = 'text-error'
    statusIcon = (
      <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
        <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z" />
      </svg>
    )
  } else if (settings.showCiStatus && hasCiFail) {
    statusColor = 'text-error'
    statusIcon = (
      <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
        <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm2.78-4.22a.75.75 0 0 1-1.06 0L8 9.06l-1.72 1.72a.75.75 0 1 1-1.06-1.06L6.94 8 5.22 6.28a.75.75 0 0 1 1.06-1.06L8 6.94l1.72-1.72a.75.75 0 1 1 1.06 1.06L9.06 8l1.72 1.72a.75.75 0 0 1 0 1.06Z" clipRule="evenodd" />
      </svg>
    )
  } else if (settings.showReviewStatus && hasChangesRequested) {
    statusColor = 'text-warning'
    statusIcon = (
      <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
        <path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
      </svg>
    )
  } else if (settings.showCiStatus && ciPending) {
    statusColor = 'text-warning'
    statusIcon = (
      <svg className="h-3 w-3 animate-spin" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="7" />
      </svg>
    )
  } else if (settings.showReviewStatus && isApproved) {
    statusColor = 'text-success'
    statusIcon = (
      <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
        <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm3.844-8.791a.75.75 0 0 0-1.188-.918l-3.7 4.79-1.649-1.833a.75.75 0 1 0-1.114 1.004l2.25 2.5a.75.75 0 0 0 1.151-.043l4.25-5.5Z" clipRule="evenodd" />
      </svg>
    )
  } else if (settings.showCiStatus && ciSuccess) {
    statusColor = 'text-success'
    statusIcon = (
      <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
        <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm3.844-8.791a.75.75 0 0 0-1.188-.918l-3.7 4.79-1.649-1.833a.75.75 0 1 0-1.114 1.004l2.25 2.5a.75.75 0 0 0 1.151-.043l4.25-5.5Z" clipRule="evenodd" />
      </svg>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1 ${statusColor}`}>
      <svg className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
      </svg>
      <span className="text-[11px]">#{task.prNumber}</span>
      {statusIcon}
    </span>
  )
}

// Siege loop badge indicator
export function SiegeBadge({ task }: { task: Task }) {
  if (!task.siegeActive) return null

  return (
    <span className="inline-flex items-center gap-1 text-accent">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
      <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
        <path fillRule="evenodd" d="M8 1a3.5 3.5 0 0 0-3.5 3.5c0 1.57.75 2.4 1.5 2.8V8h.75v2.25H5v1.5h1.75V15h2.5v-3.25H11v-1.5H9.25V8h.75v-.7c.75-.4 1.5-1.23 1.5-2.8A3.5 3.5 0 0 0 8 1Zm0 1.5a2 2 0 0 0-2 2c0 .94.5 1.5 1 1.75V7h2v-.75c.5-.25 1-.81 1-1.75a2 2 0 0 0-2-2Z" clipRule="evenodd" />
      </svg>
      <span className="text-[11px] font-medium">
        {task.siegeIteration}/{task.siegeMaxIterations}
      </span>
    </span>
  )
}
