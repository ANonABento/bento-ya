/**
 * AttachmentButton - Button to open file picker for attachments.
 */

import { Tooltip } from '@/components/shared/tooltip'

type AttachmentButtonProps = {
  onClick: () => void
  disabled?: boolean
  isLoading?: boolean
  count?: number
}

export function AttachmentButton({
  onClick,
  disabled = false,
  isLoading = false,
  count = 0,
}: AttachmentButtonProps) {
  return (
    <Tooltip
      content={isLoading ? 'Loading...' : count > 0 ? `${String(count)} attached` : 'Attach files'}
      side="top"
      delay={200}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || isLoading}
        aria-label={isLoading ? 'Loading attachments' : count > 0 ? `Attachments (${String(count)})` : 'Attach files'}
        className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded border transition-colors ${
          count > 0
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-border-default bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary'
        } disabled:opacity-50`}
        style={{ cursor: disabled || isLoading ? 'not-allowed' : 'pointer' }}
      >
        {isLoading ? (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 3v10M3 8h10" strokeLinecap="round" />
          </svg>
        )}
        {count > 0 && (
          <span className="absolute -right-1 -top-1 min-w-3 rounded-full bg-accent px-0.5 text-2xs leading-3 text-bg">
            {count}
          </span>
        )}
      </button>
    </Tooltip>
  )
}
