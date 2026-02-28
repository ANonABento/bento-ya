type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'running' | 'attention'

type BadgeProps = {
  variant?: BadgeVariant
  label?: string
  className?: string
}

const dotColors: Record<BadgeVariant, string> = {
  default: 'bg-text-secondary',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  running: 'bg-running',
  attention: 'bg-attention',
}

export function Badge({ variant = 'default', label, className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={`h-2 w-2 rounded-full ${dotColors[variant]}`} />
      {label && <span className="text-xs text-text-secondary">{label}</span>}
    </span>
  )
}
