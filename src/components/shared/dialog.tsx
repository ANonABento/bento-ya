import { type ReactNode, useEffect, useRef, useId } from 'react'

type DialogProps = {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  className?: string
}

export function Dialog({ open, onClose, title, children, className = '' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (open && !el.open) {
      el.showModal()
      // Move focus into the dialog on open
      const firstFocusable = el.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      firstFocusable?.focus()
    } else if (!open && el.open) {
      el.close()
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={title ? titleId : undefined}
      className={`m-auto max-w-md rounded-xl border border-border-default bg-surface p-0 text-text-primary shadow-2xl backdrop:bg-black/60 ${className}`}
    >
      {title && (
        <div className="border-b border-border-default px-4 py-3">
          <h2 id={titleId} className="text-base font-medium">{title}</h2>
        </div>
      )}
      <div className="p-4">{children}</div>
    </dialog>
  )
}
