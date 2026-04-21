import { useMemo } from 'react'
import type { Task } from '@/types'
import type { CardRect } from '@/hooks/use-card-positions'
import { parseDeps, type DepEntry } from '@/lib/dependency-utils'
import { svgPath } from './dependency-path'

type DependencyLinesProps = {
  tasks: Task[]
  positions: Map<string, CardRect>
  hoveredTaskId: string | null
}

type LineData = {
  id: string
  fromId: string
  toId: string
  path: string
}

// ─── Visual constants ───────────────────────────────────────────────────────

const LINE_COLOR = '#f59e0b'      // amber-400
const SAME_COL_THRESHOLD = 20     // px — cards closer than this are "same column"
const CURVE_PULL_FACTOR = 0.35    // control point distance as fraction of euclidean distance
const CURVE_PULL_MIN = 42         // px — minimum control point distance
const CURVE_PULL_MAX = 200        // px — maximum control point distance
/** Horizontal offset: how far the bezier start sits from the source card edge */
const SOURCE_OFFSET_X = 2
/** Horizontal offset: how far the bezier end sits from the target card edge.
 *  The arrowhead marker extends from this point toward the card (refX=10). */
const TARGET_OFFSET_X = 2
/** Vertical spacing between multiple arrows connecting to the same card edge */
const LANE_SPACING_Y = 16
const LINE_OPACITY = 0.7
const LINE_WIDTH = 2
const SVG_Z_INDEX = 10

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
  const sameColumn = Math.abs(fromRect.x - toRect.x) < SAME_COL_THRESHOLD

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
  const pull = clamp(dist * CURVE_PULL_FACTOR, CURVE_PULL_MIN, CURVE_PULL_MAX)

  const sn = NORMALS[sourceSide]
  const tn = NORMALS[targetSide]

  return svgPath(
    sx, sy,
    sx + sn.x * pull, sy + sn.y * pull,
    tx + tn.x * pull, ty + tn.y * pull,
    tx, ty,
  )
}

// ─── Lane spacing ───────────────────────────────────────────────────────────

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
  return (idx - (total - 1) / 2) * LANE_SPACING_Y
}

// ─── Component ──────────────────────────────────────────────────────────────

export function DependencyLines({ tasks, positions, hoveredTaskId }: DependencyLinesProps) {
  const lines = useMemo(() => {
    const result: LineData[] = []

    // Parse deps once, count lanes per card edge
    const taskDeps = new Map<string, DepEntry[]>()
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

        const src = anchor(fromRect, sourceSide, srcOffset, SOURCE_OFFSET_X)
        const tgt = anchor(toRect, targetSide, tgtOffset, TARGET_OFFSET_X)

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

  // Get scroll content dimensions so SVG covers full content area
  const boardEl = document.querySelector('[data-board-scroll]')
  const svgWidth = boardEl ? boardEl.scrollWidth : '100%'
  const svgHeight = boardEl ? boardEl.scrollHeight : '100%'

  return (
    <svg
      className="absolute top-0 left-0 pointer-events-none"
      style={{ zIndex: SVG_Z_INDEX, width: svgWidth, height: svgHeight }}
    >
      <defs>
        <marker
          id="dep-arrow"
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path
            d="M 0 0 L 10 5 L 0 10 z"
            fill={LINE_COLOR}
            stroke={LINE_COLOR}
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </marker>
      </defs>
      {visibleLines.map((line) => (
        <path
          key={line.id}
          d={line.path}
          stroke={LINE_COLOR}
          strokeWidth={LINE_WIDTH}
          fill="none"
          opacity={LINE_OPACITY}
          strokeLinecap="round"
          markerEnd="url(#dep-arrow)"
        />
      ))}
    </svg>
  )
}
