/**
 * Reusable empty state component with optional icon, title, description, and action.
 */

type EmptyStateSize = 'sm' | 'md' | 'lg'

type EmptyStateProps = {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  size?: EmptyStateSize
  className?: string
}

const sizeStyles: Record<EmptyStateSize, { container: string; icon: string; title: string; desc: string }> = {
  sm: {
    container: 'py-4 px-3',
    icon: 'h-6 w-6 mb-2',
    title: 'text-xs font-medium',
    desc: 'text-[11px]',
  },
  md: {
    container: 'py-8 px-4',
    icon: 'h-8 w-8 mb-3',
    title: 'text-sm font-medium',
    desc: 'text-xs',
  },
  lg: {
    container: 'py-12 px-6',
    icon: 'h-12 w-12 mb-4',
    title: 'text-base font-medium',
    desc: 'text-sm',
  },
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
  className = '',
}: EmptyStateProps) {
  const styles = sizeStyles[size]

  return (
    <div className={`flex flex-col items-center justify-center text-center ${styles.container} ${className}`}>
      {icon && (
        <div className={`text-text-secondary/50 ${styles.icon}`}>
          {icon}
        </div>
      )}
      <h3 className={`text-text-secondary ${styles.title}`}>{title}</h3>
      {description && (
        <p className={`mt-1 text-text-secondary/70 ${styles.desc}`}>{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
