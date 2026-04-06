import { useMemo, useState } from 'react'
import type { Task } from '@/types'

type CardRect = { x: number; y: number; width: number; height: number }

type DependencyLinesProps = {
  tasks: Task[]
  positions: Map<string, CardRect>
}

type ParsedDep = {
  task_id: string
  condition: string
  target_column?: string
}

type LineData = {
  id: string
  fromId: string
  toId: string
  fromTitle: string
  toTitle: string
  condition: string
  path: string
  color: string
  midX: number
  midY: number
}

const CONDITION_COLORS: Record<string, string> = {
  completed: '#4ade80',       // green
  moved_to_column: '#60a5fa', // blue
  agent_complete: '#f59e0b',  // amber
}
const DEFAULT_COLOR = '#a78bfa' // purple fallback

const CONDITION_LABELS: Record<string, string> = {
  completed: 'completed',
  moved_to_column: 'moved to column',
  agent_complete: 'agent complete',
}

/** Build an SVG cubic bezier path string (lint-safe, no number-in-template). */
export function svgPath(
  mx: number, my: number,
  c1x: number, c1y: number,
  c2x: number, c2y: number,
  ex: number, ey: number,
): string {
  return `M ${String(mx)},${String(my)} C ${String(c1x)},${String(c1y)} ${String(c2x)},${String(c2y)} ${String(ex)},${String(ey)}`
}

function parseDeps(json: string | null): ParsedDep[] {
  if (!json) return []
  try { return JSON.parse(json) as ParsedDep[] } catch { return [] }
}

function getColor(condition: string): string {
  return CONDITION_COLORS[condition] || DEFAULT_COLOR
}

export function DependencyLines({ tasks, positions }: DependencyLinesProps) {
  const [hoveredLine, setHoveredLine] = useState<string | null>(null)

  const taskMap = useMemo(() => {
    const m = new Map<string, Task>()
    for (const t of tasks) m.set(t.id, t)
    return m
  }, [tasks])

  const lines = useMemo(() => {
    const result: LineData[] = []

    for (const task of tasks) {
      const deps = parseDeps(task.dependencies)
      const toRect = positions.get(task.id)
      if (!toRect || deps.length === 0) continue

      for (const dep of deps) {
        const fromRect = positions.get(dep.task_id)
        if (!fromRect) continue

        const fromTask = taskMap.get(dep.task_id)

        // "from" = blocker card, "to" = dependent card
        const fromX = fromRect.x + fromRect.width
        const fromY = fromRect.y + fromRect.height / 2
        const toX = toRect.x
        const toY = toRect.y + toRect.height / 2

        const sameColumn = Math.abs(fromRect.x - toRect.x) < 20

        let path: string
        let midX: number
        let midY: number

        if (sameColumn) {
          const offset = 50
          path = svgPath(fromX, fromY, fromX + offset, fromY, fromX + offset, toY, fromX, toY)
          midX = fromX + offset
          midY = (fromY + toY) / 2
        } else if (toX < fromRect.x) {
          const altFromX = fromRect.x
          const altToX = toRect.x + toRect.width
          midX = (altFromX + altToX) / 2
          midY = (fromY + toY) / 2
          path = svgPath(altFromX, fromY, midX, fromY, midX, toY, altToX, toY)
        } else {
          midX = (fromX + toX) / 2
          midY = (fromY + toY) / 2
          path = svgPath(fromX, fromY, midX, fromY, midX, toY, toX, toY)
        }

        result.push({
          id: `${dep.task_id}-${task.id}`,
          fromId: dep.task_id,
          toId: task.id,
          fromTitle: fromTask?.title || dep.task_id,
          toTitle: task.title,
          condition: dep.condition,
          path,
          color: getColor(dep.condition),
          midX,
          midY,
        })
      }
    }

    return result
  }, [tasks, positions, taskMap])

  if (lines.length === 0) return null

  return (
    <svg
      className="absolute inset-0 pointer-events-none overflow-visible"
      style={{ zIndex: 5 }}
    >
      <defs>
        {/* One arrow marker per condition color */}
        {Object.entries(CONDITION_COLORS).map(([condition, color]) => (
          <marker
            key={condition}
            id={`dep-arrow-${condition}`}
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={color} opacity="0.8" />
          </marker>
        ))}
        <marker
          id="dep-arrow-default"
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={DEFAULT_COLOR} opacity="0.8" />
        </marker>
      </defs>

      {lines.map((line) => {
        const isHovered = hoveredLine === line.id
        const markerId = CONDITION_COLORS[line.condition]
          ? `dep-arrow-${line.condition}`
          : 'dep-arrow-default'

        return (
          <g key={line.id}>
            {/* Wider invisible hit area for easier hover */}
            <path
              d={line.path}
              stroke="transparent"
              strokeWidth="12"
              fill="none"
              style={{ pointerEvents: 'stroke', cursor: 'default' }}
              onMouseEnter={() => { setHoveredLine(line.id) }}
              onMouseLeave={() => { setHoveredLine(null) }}
            />
            {/* Visible line */}
            <path
              d={line.path}
              stroke={line.color}
              strokeWidth={isHovered ? 2.5 : 1.5}
              strokeDasharray={isHovered ? 'none' : '6 4'}
              fill="none"
              opacity={isHovered ? 1 : 0.5}
              markerEnd={`url(#${markerId})`}
              className="transition-all duration-200"
              style={{ pointerEvents: 'none' }}
            />
            {/* Tooltip on hover */}
            {isHovered && (
              <foreignObject
                x={line.midX - 100}
                y={line.midY - 32}
                width="200"
                height="48"
                style={{ pointerEvents: 'none', overflow: 'visible' }}
              >
                <div className="flex items-center justify-center">
                  <div className="rounded-lg border border-border-default bg-surface px-2.5 py-1.5 text-[11px] text-text-primary shadow-lg whitespace-nowrap">
                    <span className="font-medium">{line.fromTitle}</span>
                    <span className="mx-1.5 text-text-secondary">→</span>
                    <span className="font-medium">{line.toTitle}</span>
                    <span
                      className="ml-1.5 rounded px-1 py-0.5 text-[10px] font-medium"
                      style={{ backgroundColor: `${line.color}20`, color: line.color }}
                    >
                      {CONDITION_LABELS[line.condition] || line.condition}
                    </span>
                  </div>
                </div>
              </foreignObject>
            )}
          </g>
        )
      })}
    </svg>
  )
}
