import { useEffect } from 'react'

/**
 * Destructive-action confirmation.
 *
 * Follows the app's established overlay recipe (fixed inset-0 z-[60] scrim +
 * rounded-xl card) rather than the native `<dialog>` in `dialog.tsx`, which
 * nothing else in the app uses.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
  testId,
}: {
  title: string
  body: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  testId?: string
}) {
  // Escape closes from anywhere, not just when the card has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-xl border border-border-default bg-bg shadow-2xl"
      >
        <div className="border-b border-border-default px-5 py-4">
          <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-text-secondary">{body}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border-default px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            style={{ cursor: 'pointer' }}
            className="rounded-lg border border-border-default px-4 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid={testId}
            style={{ cursor: 'pointer' }}
            className="rounded-lg bg-error px-4 py-2 text-sm font-medium text-bg transition-opacity hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
