import type { ReactNode } from 'react'

type Size = 'sm' | 'md' | 'lg'

type Props = {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  size?: Size
  className?: string
}

const SIZE_STYLES: Record<Size, { container: string; icon: string; title: string; description: string }> = {
  sm: {
    container: 'py-4',
    icon: 'text-xl mb-2',
    title: 'text-xs text-text-secondary/70',
    description: 'text-xs text-text-secondary/50 mt-1',
  },
  md: {
    container: 'py-8',
    icon: 'text-3xl mb-3',
    title: 'text-sm text-text-secondary',
    description: 'text-xs text-text-secondary/70 mt-1',
  },
  lg: {
    container: 'py-12',
    icon: 'text-5xl mb-4',
    title: 'text-base text-text-secondary',
    description: 'text-sm text-text-secondary/70 mt-2',
  },
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
  className = '',
}: Props) {
  const styles = SIZE_STYLES[size]

  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${styles.container} ${className}`}
    >
      {icon && <div className={styles.icon}>{icon}</div>}
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
