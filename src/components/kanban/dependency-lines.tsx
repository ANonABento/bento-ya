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

// ─── Side normals ───────────────────────────────────────────────────────────

type Side = 'left' | 'right'
const NORMALS: Record<Side, { x: number; y: number }> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

// ─── Connection point + path calculation ────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/**
 * Choose which side each card connects from based on relative column position.
 * Returns [sourceSide, targetSide].
 */
function chooseSides(fromRect: CardRect, toRect: CardRect): [Side, Side] {
  const fromCx = fromRect.x + fromRect.width / 2
  const toCx = toRect.x + toRect.width / 2
  const sameColumn = Math.abs(fromRect.x - toRect.x) < 20

  if (sameColumn) return ['right', 'right']          // U-curve to the right
  if (toCx >= fromCx) return ['right', 'left']       // forward: right → left
  return ['left', 'right']                           // reverse: left → right
}

/** Get the anchor point on a card edge with lane offset. */
function anchor(rect: CardRect, side: Side, laneOffset: number, padding: number): { x: number; y: number } {
  const y = rect.y + rect.height / 2 + laneOffset
  if (side === 'left') return { x: rect.x - padding, y }
  return { x: rect.x + rect.width + padding, y }
}

/**
 * Build bezier path between two anchored points.
 * curvePull = clamp(euclidean_distance * 0.35, 42, 200)
 * Control points extend along the side normal by curvePull distance.
 */
function calcPath(
  sx: number, sy: number, sourceSide: Side,
  tx: number, ty: number, targetSide: Side,
): string {
  const dist = Math.hypot(tx - sx, ty - sy)
  const pull = clamp(dist * 0.35, 42, 200)

  const sn = NORMALS[sourceSide]
  const tn = NORMALS[targetSide]

  const c1x = sx + sn.x * pull
  const c1y = sy + sn.y * pull
  const c2x = tx + tn.x * pull
  const c2y = ty + tn.y * pull

  return [
    'M', String(sx), String(sy),
    'C', String(c1x), String(c1y) + ',',
    String(c2x), String(c2y) + ',',
    String(tx), String(ty),
  ].join(' ')
}

/** Build SVG cubic bezier path string (used by dep-drag-preview). */
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

// ─── Lane spacing ───────────────────────────────────────────────────────────

const LANE_SPACING = 9 // px between parallel connections on same card edge

type LaneTracker = Map<string, number>

function getLaneOffset(
  cardId: string,
  tracker: LaneTracker,
  totalLanes: Map<string, number>,
): number {
  const total = totalLanes.get(cardId) ?? 1
  const idx = tracker.get(cardId) ?? 0
  tracker.set(cardId, idx + 1)

  if (total === 1) return 0
  return (idx - (total - 1) / 2) * LANE_SPACING
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DependencyLines({ tasks, positions, hoveredTaskId }: DependencyLinesProps) {
  const lines = useMemo(() => {
    const result: LineData[] = []

    // Parse deps once, count lanes per card edge
    const taskDeps = new Map<string, ParsedDep[]>()
    const outLanes = new Map<string, number>()
    const inLanes = new Map<string, number>()

    for (const task of tasks) {
      const deps = parseDeps(task.dependencies)
      if (deps.length === 0) continue
      taskDeps.set(task.id, deps)
      inLanes.set(task.id, (inLanes.get(task.id) ?? 0) + deps.length)
      for (const dep of deps) {
        outLanes.set(dep.task_id, (outLanes.get(dep.task_id) ?? 0) + 1)
      }
    }

    // Build lines with lane-spaced connection points
    const outTracker: LaneTracker = new Map()
    const inTracker: LaneTracker = new Map()

    for (const [taskId, deps] of taskDeps) {
      const toRect = positions.get(taskId)
      if (!toRect) continue

      for (const dep of deps) {
        const fromRect = positions.get(dep.task_id)
        if (!fromRect) continue

        const [sourceSide, targetSide] = chooseSides(fromRect, toRect)
        const srcOffset = getLaneOffset(dep.task_id, outTracker, outLanes)
        const tgtOffset = getLaneOffset(taskId, inTracker, inLanes)

        const src = anchor(fromRect, sourceSide, srcOffset, 2)
        const tgt = anchor(toRect, targetSide, tgtOffset, 2)

        result.push({
          id: `${dep.task_id}-${taskId}`,
          fromId: dep.task_id,
          toId: taskId,
          path: calcPath(src.x, src.y, sourceSide, tgt.x, tgt.y, targetSide),
        })
      }
    }

    return result
  }, [tasks, positions])

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
        <path
          key={line.id}
          d={line.path}
          stroke={LINE_COLOR}
          strokeWidth="2"
          fill="none"
          opacity="0.7"
          strokeLinecap="round"
        />
      ))}
    </svg>
  )
}
