import { useMemo } from 'react'
import type { Task, Column } from '@/types'
import { useSettingsStore } from '@/stores/settings-store'
import { useLabelStore } from '@/stores/label-store'

type DragOverlayContentProps = {
  item:
    | { type: 'task'; data: Task }
    | { type: 'column'; data: Column }
}

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-running',
  completed: 'bg-success',
  failed: 'bg-error',
  stopped: 'bg-text-secondary',
  needs_attention: 'bg-attention',
}

export function DragOverlayContent({ item }: DragOverlayContentProps) {
  const cardSettings = useSettingsStore((s) => s.global.cards)
  const workspaceLabels = useLabelStore((s) => s.labels)

  const taskLabels = useMemo(() => {
    if (item.type !== 'task') return []
    const labelsById = new Map(workspaceLabels.map((l) => [l.id, l]))
    return (item.data.labels ?? []).flatMap((l) => {
      const current = labelsById.get(l.id)
      return current ? [current] : []
    })
  }, [item, workspaceLabels])

  if (item.type === 'task') {
    const task = item.data
    const hasMetadata = (cardSettings.showBranch && task.branch) ||
      (cardSettings.showAgentType && task.agentType) ||
      (cardSettings.showPrBadge && task.prNumber)

    return (
      <div className="w-[280px] pointer-events-none">
        <div className="rounded-lg border-2 border-accent bg-surface shadow-2xl shadow-black/50 p-3 space-y-2">
          {/* Title row */}
          <div className="flex items-start gap-2">
            <h4 className="flex-1 text-sm font-medium text-text-primary leading-snug line-clamp-2">
              {task.title}
            </h4>
            {task.agentStatus && (
              <span
                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-surface ${STATUS_COLORS[task.agentStatus] || 'bg-text-secondary'}`}
              />
            )}
          </div>

          {/* Description */}
          {cardSettings.showDescription && task.description && (
            <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed">
              {task.description}
            </p>
          )}

          {/* Metadata row */}
          {hasMetadata && (
            <div className="flex items-center gap-x-3 text-[11px] text-text-secondary">
              {cardSettings.showPrBadge && task.prNumber && (
                <span className="inline-flex items-center gap-1">
                  <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
                  </svg>
                  #{task.prNumber}
                </span>
              )}
              {cardSettings.showAgentType && task.agentType && (
                <span>{task.agentType}</span>
              )}
              {cardSettings.showBranch && task.branch && (
                <span className="font-mono truncate max-w-[100px]">{task.branch}</span>
              )}
            </div>
          )}

          {/* Labels */}
          {cardSettings.showLabels && taskLabels.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {taskLabels.slice(0, 3).map((label) => (
                <span
                  key={label.id}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-secondary"
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: label.color }} />
                  {label.name}
                </span>
              ))}
              {taskLabels.length > 3 && (
                <span className="text-[10px] text-text-secondary/70">+{taskLabels.length - 3}</span>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="w-[300px] rounded-xl border-2 border-accent bg-surface p-3 shadow-2xl pointer-events-none">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
        {item.data.name}
      </h3>
    </div>
  )
}
