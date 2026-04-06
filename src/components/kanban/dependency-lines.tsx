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
  path: string
}

const LINE_COLOR = '#f59e0b' // amber-400

/**
 * React Flow-inspired bezier path calculation.
 *
 * Forward:  cpOffset = max(dx * 0.5, 50)
 * Reverse:  cpOffset = 25 * sqrt(abs(dx))  (prevents collapse on close nodes)
 *
 * Control points are always horizontal from the endpoints,
 * so arrows approach the card edge cleanly.
 */
function calcPath(
  fromRect: CardRect, fromY: number,
  toRect: CardRect, toY: number,
): string {
  const fromCx = fromRect.x + fromRect.width / 2
  const toCx = toRect.x + toRect.width / 2

  // Pick exit/entry edges based on relative position — always face each other
  let sx: number, tx: number, exitDir: number, entryDir: number

  if (toCx >= fromCx) {
    // Target is to the RIGHT: exit right, enter left
    sx = fromRect.x + fromRect.width
    tx = toRect.x
    exitDir = 1
    entryDir = -1
  } else {
    // Target is to the LEFT: exit left, enter right
    sx = fromRect.x
    tx = toRect.x + toRect.width
    exitDir = -1
    entryDir = 1
  }

  const gap = Math.abs(tx - sx)
  const offset = Math.max(gap * 0.5, 60)

  return [
    'M', String(sx), String(fromY),
    'C', String(sx + offset * exitDir), String(fromY) + ',',
    String(tx + offset * entryDir), String(toY) + ',',
    String(tx), String(toY),
  ].join(' ')
}

/** Also exported for dep-drag-preview. */
export function svgPath(
  mx: number, my: number,
  c1x: number, c1y: number,
  c2x: number, c2y: number,
  ex: number, ey: number,
): string {
  return [
    'M', String(mx), String(my),
    'C', String(c1x), String(c1y) + ',',
    String(c2x), String(c2y) + ',',
    String(ex), String(ey),
  ].join(' ')
}

function parseDeps(json: string | null): ParsedDep[] {
  if (!json) return []
  try { return JSON.parse(json) as ParsedDep[] } catch { return [] }
}

/**
 * Spread multiple connection ports evenly along a card edge.
 */
type PortTracker = Map<string, number>
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

  const padding = 10
  const usableHeight = rect.height - padding * 2
  const spacing = usableHeight / (total + 1)
  return rect.y + padding + spacing * (idx + 1)
}

export function DependencyLines({ tasks, positions, hoveredTaskId }: DependencyLinesProps) {
  const lines = useMemo(() => {
    const result: LineData[] = []

    // Count ports per card edge
    const outPorts = new Map<string, number>()
    const inPorts = new Map<string, number>()

    for (const task of tasks) {
      const deps = parseDeps(task.dependencies)
      if (deps.length === 0) continue
      inPorts.set(task.id, (inPorts.get(task.id) ?? 0) + deps.length)
      for (const dep of deps) {
        outPorts.set(dep.task_id, (outPorts.get(dep.task_id) ?? 0) + 1)
      }
    }

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

        result.push({
          id: `${dep.task_id}-${task.id}`,
          fromId: dep.task_id,
          toId: task.id,
          path: calcPath(fromRect, fromY, toRect, toY),
        })
      }
    }

    return result
  }, [tasks, positions])

  // Only show lines for the hovered card
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
      {visibleLines.map((line) => (
        <g key={line.id}>
          <path
            d={line.path}
            stroke={LINE_COLOR}
            strokeWidth="2"
            fill="none"
            opacity="0.7"
            strokeLinecap="round"
          />
        </g>
      ))}
    </svg>
  )
}
