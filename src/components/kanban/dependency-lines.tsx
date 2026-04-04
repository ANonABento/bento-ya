import { useMemo } from 'react'
import type { Task } from '@/types'

type CardRect = { x: number; y: number; width: number; height: number }

type DependencyLinesProps = {
  tasks: Task[]
  positions: Map<string, CardRect>
}

type ParsedDep = {
  task_id: string
  condition: string
}

function parseDeps(json: string | null): ParsedDep[] {
  if (!json) return []
  try { return JSON.parse(json) as ParsedDep[] } catch { return [] }
}

export function DependencyLines({ tasks, positions }: DependencyLinesProps) {
  const lines = useMemo(() => {
    const result: Array<{
      id: string
      fromId: string
      toId: string
      path: string
    }> = []

    for (const task of tasks) {
      const deps = parseDeps(task.dependencies)
      const toRect = positions.get(task.id)
      if (!toRect || deps.length === 0) continue

      for (const dep of deps) {
        const fromRect = positions.get(dep.task_id)
        if (!fromRect) continue

        // Calculate bezier path
        // "from" = blocker card (right edge), "to" = dependent card (left edge)
        const fromX = fromRect.x + fromRect.width  // right edge of blocker
        const fromY = fromRect.y + fromRect.height / 2  // center Y
        const toX = toRect.x  // left edge of dependent
        const toY = toRect.y + toRect.height / 2

        // If cards are in same column (similar X), curve outward to the right
        const sameColumn = Math.abs(fromRect.x - toRect.x) < 20

        let path: string
        if (sameColumn) {
          // Same column: connect right-to-right with an outward curve
          const offset = 50
          path = `M ${fromX},${fromY} C ${fromX + offset},${fromY} ${fromX + offset},${toY} ${fromX},${toY}`
        } else if (toX < fromRect.x) {
          // Blocker is to the right of dependent: use left edge of blocker, right edge of dependent
          const altFromX = fromRect.x  // left edge of blocker
          const altToX = toRect.x + toRect.width  // right edge of dependent
          const midX = (altFromX + altToX) / 2
          path = `M ${altFromX},${fromY} C ${midX},${fromY} ${midX},${toY} ${altToX},${toY}`
        } else {
          // Normal: blocker left of dependent
          const midX = (fromX + toX) / 2
          path = `M ${fromX},${fromY} C ${midX},${fromY} ${midX},${toY} ${toX},${toY}`
        }

        result.push({
          id: `${dep.task_id}-${task.id}`,
          fromId: dep.task_id,
          toId: task.id,
          path,
        })
      }
    }

    return result
  }, [tasks, positions])

  if (lines.length === 0) return null

  return (
    <svg
      className="absolute inset-0 pointer-events-none overflow-visible"
      style={{ zIndex: 5 }}
    >
      <defs>
        <marker
          id="dep-arrow"
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" opacity="0.7" />
        </marker>
      </defs>
      {lines.map((line) => (
        <path
          key={line.id}
          d={line.path}
          stroke="#f59e0b"
          strokeWidth="1.5"
          strokeDasharray="6 4"
          fill="none"
          opacity="0.5"
          markerEnd="url(#dep-arrow)"
          className="transition-opacity hover:opacity-100"
          style={{ pointerEvents: 'stroke' }}
        />
      ))}
    </svg>
  )
}
