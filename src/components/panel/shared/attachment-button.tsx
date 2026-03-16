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
        className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border transition-colors ${
          count > 0
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-border-default bg-bg text-text-secondary hover:bg-surface-hover hover:text-text-primary'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
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
      </button>
    </Tooltip>
  )
}
