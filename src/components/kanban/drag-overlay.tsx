import type { Task, Column } from '@/types'

type DragOverlayContentProps = {
  item:
    | { type: 'task'; data: Task }
    | { type: 'column'; data: Column }
}

export function DragOverlayContent({ item }: DragOverlayContentProps) {
  if (item.type === 'task') {
    return (
      <div className="w-[280px] rounded-xl border border-accent/30 bg-surface p-3 shadow-2xl">
        <h4 className="text-sm font-medium text-text-primary">{item.data.title}</h4>
        <div className="mt-1 flex items-center gap-2 text-xs text-text-secondary">
          {item.data.agentType && (
            <span className="rounded bg-surface-hover px-1.5 py-0.5">
              {item.data.agentType}
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="w-[300px] rounded-xl border border-accent/30 bg-surface p-3 shadow-2xl">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
        {item.data.name}
      </h3>
    </div>
  )
}
