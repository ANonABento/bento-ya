import { useMemo } from 'react'
import type { Task } from '@/types'

type CardRect = { x: number; y: number; width: number; height: number }

type DependencyLinesProps = {
  tasks: Task[]
  positions: Map<string, CardRect>
  hoveredTaskId: string | null
}

type ParsedDep = {
  task_id: string
  condition: string
}

type LineData = {
  id: string
  fromId: string
  toId: string
  condition: string
  path: string
  color: string
}

const CONDITION_COLORS: Record<string, string> = {
  completed: '#4ade80',
  moved_to_column: '#60a5fa',
  agent_complete: '#f59e0b',
}
const DEFAULT_COLOR = '#a78bfa'

/** Build SVG cubic bezier path string. */
export function svgPath(
  mx: number, my: number,
  c1x: number, c1y: number,
  c2x: number, c2y: number,
  ex: number, ey: number,
): string {
  return [
    'M', String(mx), String(my),
    'C', String(c1x), String(c1y),
    String(c2x), String(c2y),
    String(ex), String(ey),
  ].join(' ')
}

function parseDeps(json: string | null): ParsedDep[] {
  if (!json) return []
  try { return JSON.parse(json) as ParsedDep[] } catch { return [] }
}

/**
 * Count how many lines connect to each card edge, and return the Y offset
 * for a specific connection index. Spreads ports evenly along the card edge.
 */
type PortTracker = Map<string, number> // cardId → next port index
function getPortY(
  rect: CardRect,
  cardId: string,
  tracker: PortTracker,
  totalPorts: Map<string, number>,
): number {
  const total = totalPorts.get(cardId) ?? 1
  const idx = tracker.get(cardId) ?? 0
  tracker.set(cardId, idx + 1)

  if (total === 1) return rect.y + rect.height / 2

  // Spread ports along the card's right/left edge with 8px padding top/bottom
  const padding = 8
  const usableHeight = rect.height - padding * 2
  const spacing = usableHeight / (total + 1)
  return rect.y + padding + spacing * (idx + 1)
}

export function DependencyLines({ tasks, positions, hoveredTaskId }: DependencyLinesProps) {
  const lines = useMemo(() => {
    const result: LineData[] = []

    // First pass: count ports per card edge (outgoing from right, incoming to left)
    const outPorts = new Map<string, number>() // blocker card → count of outgoing lines
    const inPorts = new Map<string, number>()  // dependent card → count of incoming lines

    for (const task of tasks) {
      const deps = parseDeps(task.dependencies)
      if (deps.length === 0) continue
      inPorts.set(task.id, (inPorts.get(task.id) ?? 0) + deps.length)
      for (const dep of deps) {
        outPorts.set(dep.task_id, (outPorts.get(dep.task_id) ?? 0) + 1)
      }
    }

    // Second pass: build lines with spread port positions
    const outTracker: PortTracker = new Map()
    const inTracker: PortTracker = new Map()

    for (const task of tasks) {
      const deps = parseDeps(task.dependencies)
      const toRect = positions.get(task.id)
      if (!toRect || deps.length === 0) continue

      for (const dep of deps) {
        const fromRect = positions.get(dep.task_id)
        if (!fromRect) continue

        const fromY = getPortY(fromRect, dep.task_id, outTracker, outPorts)
        const toY = getPortY(toRect, task.id, inTracker, inPorts)

        const fromX = fromRect.x + fromRect.width
        const toX = toRect.x

        const sameColumn = Math.abs(fromRect.x - toRect.x) < 20

        let path: string
        if (sameColumn) {
          // Same column: curve outward to the right
          const offset = 35
          path = svgPath(fromX, fromY, fromX + offset, fromY, fromX + offset, toY, fromX, toY)
        } else if (toX < fromRect.x) {
          // Reversed: blocker right of dependent
          const ax = fromRect.x
          const bx = toRect.x + toRect.width
          const mx = (ax + bx) / 2
          path = svgPath(ax, fromY, mx, fromY, mx, toY, bx, toY)
        } else {
          // Normal: clean bezier with control points pulled toward the midpoint
          const gap = toX - fromX
          const cpOffset = Math.min(gap * 0.4, 80) // control point distance, capped
          path = svgPath(
            fromX, fromY,
            fromX + cpOffset, fromY,
            toX - cpOffset, toY,
            toX, toY,
          )
        }

        result.push({
          id: `${dep.task_id}-${task.id}`,
          fromId: dep.task_id,
          toId: task.id,
          condition: dep.condition,
          path,
          color: CONDITION_COLORS[dep.condition] || DEFAULT_COLOR,
        })
      }
    }

    return result
  }, [tasks, positions])

  // Only show lines connected to the hovered card
  if (!hoveredTaskId || lines.length === 0) return null

  const visibleLines = lines.filter(
    (l) => l.fromId === hoveredTaskId || l.toId === hoveredTaskId,
  )

  if (visibleLines.length === 0) return null

  return (
    <svg
      className="absolute inset-0 pointer-events-none overflow-visible"
      style={{ zIndex: 10 }}
    >
      <defs>
        {Object.entries(CONDITION_COLORS).map(([condition, color]) => (
          <marker
            key={condition}
            id={`dep-arrow-${condition}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 1 1.5 L 9 5 L 1 8.5 z" fill={color} opacity="0.9" />
          </marker>
        ))}
        <marker
          id="dep-arrow-default"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 1 1.5 L 9 5 L 1 8.5 z" fill={DEFAULT_COLOR} opacity="0.9" />
        </marker>
      </defs>

      {visibleLines.map((line) => {
        const markerId = CONDITION_COLORS[line.condition]
          ? `dep-arrow-${line.condition}`
          : 'dep-arrow-default'

        return (
          <g key={line.id}>
            <path
              d={line.path}
              stroke={line.color}
              strokeWidth="6"
              fill="none"
              opacity="0.1"
              strokeLinecap="round"
            />
            <path
              d={line.path}
              stroke={line.color}
              strokeWidth="2"
              fill="none"
              opacity="0.85"
              strokeLinecap="round"
              markerEnd={`url(#${markerId})`}
            />
          </g>
        )
      })}
    </svg>
  )
}
