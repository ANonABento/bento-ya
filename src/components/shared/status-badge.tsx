import type { ReactNode } from 'react'

type Variant = 'success' | 'error' | 'warning' | 'info' | 'neutral'
type Size = 'sm' | 'md'

type Props = {
  variant: Variant
  label?: string
  icon?: ReactNode
  size?: Size
  pulse?: boolean
  className?: string
}

const VARIANT_STYLES: Record<Variant, string> = {
  success: 'bg-success/10 text-success',
  error: 'bg-error/10 text-error',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-accent/10 text-accent',
  neutral: 'bg-surface text-text-secondary',
}

const SIZE_STYLES: Record<Size, string> = {
  sm: 'px-1.5 py-0.5 text-[10px] gap-1',
  md: 'px-2 py-1 text-xs gap-1.5',
}

export function StatusBadge({
  variant,
  label,
  icon,
  size = 'md',
  pulse = false,
  className = '',
}: Props) {
  return (
    <span
      className={`
        inline-flex items-center rounded-full font-medium
        ${VARIANT_STYLES[variant]}
        ${SIZE_STYLES[size]}
        ${className}
      `}
    >
      {icon && (
        <span className={pulse ? 'animate-pulse' : ''}>
          {icon}
        </span>
      )}
      {label}
    </span>
  )
}

// Common status dot for minimal displays
export function StatusDot({
  variant,
  pulse = false,
  size = 'md',
}: {
  variant: Variant
  pulse?: boolean
  size?: Size
}) {
  const dotSize = size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2'
  const colorMap: Record<Variant, string> = {
    success: 'bg-success',
    error: 'bg-error',
    warning: 'bg-warning',
    info: 'bg-accent',
    neutral: 'bg-text-secondary',
  }

  return (
    <span
      className={`
        inline-block rounded-full
        ${dotSize}
        ${colorMap[variant]}
        ${pulse ? 'animate-pulse' : ''}
      `}
    />
  )
}
