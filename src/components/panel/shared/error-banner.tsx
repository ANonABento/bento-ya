/**
 * Consistent error banner for both panels.
 * Shows error message with optional dismiss and retry actions.
 */

import { memo } from 'react'

type ErrorBannerProps = {
  error: string
  onDismiss?: () => void
  onRetry?: () => void
}

export const ErrorBanner = memo(function ErrorBanner({ error, onDismiss, onRetry }: ErrorBannerProps) {
  return (
    <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" className="shrink-0">
        <path d="M7 1a6 6 0 100 12A6 6 0 007 1zm0 9a.75.75 0 110-1.5.75.75 0 010 1.5zm.75-3a.75.75 0 01-1.5 0V4.5a.75.75 0 011.5 0V7z"/>
      </svg>
      <span className="flex-1">{error}</span>
      <div className="flex items-center gap-1">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded px-2 py-0.5 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            Retry
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-red-400 hover:text-red-300 px-1"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
})

type FailedMessageBannerProps = {
  error: string
  onRetry: () => void
  onDismiss: () => void
}

export const FailedMessageBanner = memo(function FailedMessageBanner({ error, onRetry, onDismiss }: FailedMessageBannerProps) {
  return (
    <div className="mx-3 mt-2 rounded-md bg-red-500/10 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-red-400">{error}</p>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onRetry}
            className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded px-2 py-0.5 text-xs text-red-400/70 hover:bg-red-500/20 transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
})

type CliDetectingBannerProps = {
  message?: string
}

export const CliDetectingBanner = memo(function CliDetectingBanner({ message = 'Detecting Claude CLI...' }: CliDetectingBannerProps) {
  return (
    <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent">
      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span>{message}</span>
    </div>
  )
})
