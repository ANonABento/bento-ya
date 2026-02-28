import { memo } from 'react'

type ColumnHeaderProps = {
  name: string
  taskCount: number
  color: string
}

export const ColumnHeader = memo(function ColumnHeader({
  name,
  taskCount,
  color,
}: ColumnHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span
        className="h-2.5 w-2.5 rounded-full shrink-0"
        style={{ backgroundColor: color || 'var(--accent)' }}
      />
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary truncate">
        {name}
      </h3>
      <span className="ml-auto shrink-0 rounded-full bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
        {taskCount}
      </span>
    </div>
  )
})
