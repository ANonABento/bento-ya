import { type ReactNode, useEffect, useRef } from 'react'

type DialogProps = {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  className?: string
}

export function Dialog({ open, onClose, title, children, className = '' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (open && !el.open) {
      el.showModal()
    } else if (!open && el.open) {
      el.close()
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={`m-auto max-w-md rounded-xl border border-border-default bg-surface p-0 text-text-primary shadow-2xl backdrop:bg-black/60 ${className}`}
    >
      {title && (
        <div className="border-b border-border-default px-4 py-3">
          <h2 className="text-base font-medium">{title}</h2>
        </div>
      )}
      <div className="p-4">{children}</div>
    </dialog>
  )
}
