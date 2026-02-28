import { type ReactNode, useState, useRef } from 'react'

type TooltipProps = {
  content: string
  children: ReactNode
  className?: string
}

export function Tooltip({ content, children, className = '' }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null)

  function show() {
    timeoutRef.current = setTimeout(() => setVisible(true), 400)
  }

  function hide() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setVisible(false)
  }

  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <span className="absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-surface-hover px-2 py-1 text-xs text-text-primary shadow-lg border border-border-default">
          {content}
        </span>
      )}
    </span>
  )
}
