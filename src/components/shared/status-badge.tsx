/**
 * Status badge components with consistent styling across the app.
 */

import { BADGE_COLORS, type BadgeVariant } from '@/constants/status'

type StatusBadgeProps = {
  variant?: BadgeVariant
  label: string
  showDot?: boolean
  size?: 'sm' | 'md'
  className?: string
}

const sizeStyles = {
  sm: {
    container: 'px-1.5 py-0.5 text-[10px]',
    dot: 'h-1.5 w-1.5',
  },
  md: {
    container: 'px-2 py-1 text-xs',
    dot: 'h-2 w-2',
  },
}

export function StatusBadge({
  variant = 'default',
  label,
  showDot = true,
  size = 'md',
  className = '',
}: StatusBadgeProps) {
  const colors = BADGE_COLORS[variant]
  const sizes = sizeStyles[size]

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${colors.bg} ${colors.text} ${sizes.container} ${className}`}
    >
      {showDot && <span className={`rounded-full ${colors.dot} ${sizes.dot}`} />}
      {label}
    </span>
  )
}

// Compact dot-only status indicator
type StatusDotProps = {
  variant?: BadgeVariant
  size?: 'sm' | 'md' | 'lg'
  pulse?: boolean
  className?: string
}

const dotSizes = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
  lg: 'h-2.5 w-2.5',
}

export function StatusDot({
  variant = 'default',
  size = 'md',
  pulse = false,
  className = '',
}: StatusDotProps) {
  const colors = BADGE_COLORS[variant]

  return (
    <span
      className={`inline-block rounded-full ${colors.dot} ${dotSizes[size]} ${pulse ? 'animate-pulse' : ''} ${className}`}
    />
  )
}
