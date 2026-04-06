/**
 * Preview bezier line rendered during Cmd+drag dependency linking.
 * Shows a line from the source card to the cursor (or snapped to target card).
 */

import type { DepDragState } from '@/hooks/use-dep-drag'
import { svgPath } from './dependency-lines'

type CardRect = { x: number; y: number; width: number; height: number }

type Props = {
  dragState: DepDragState
  positions: Map<string, CardRect>
}

export function DepDragPreview({ dragState, positions }: Props) {
  const { sourceX, sourceY, cursorX, cursorY, targetId } = dragState

  // Snap to target card center if hovering over one
  let toX = cursorX
  let toY = cursorY
  if (targetId) {
    const targetRect = positions.get(targetId)
    if (targetRect) {
      toX = targetRect.x
      toY = targetRect.y + targetRect.height / 2
    }
  }

  const midX = (sourceX + toX) / 2
  const path = svgPath(sourceX, sourceY, midX, sourceY, midX, toY, toX, toY)

  return (
    <svg
      className="absolute inset-0 pointer-events-none overflow-visible"
      style={{ zIndex: 50 }}
    >
      <defs>
        <marker
          id="dep-drag-arrow"
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path
            d="M 0 0 L 10 5 L 0 10 z"
            fill={targetId ? '#4ade80' : '#a78bfa'}
            opacity="0.9"
          />
        </marker>
      </defs>
      <path
        d={path}
        stroke={targetId ? '#4ade80' : '#a78bfa'}
        strokeWidth="2.5"
        strokeDasharray={targetId ? 'none' : '8 4'}
        fill="none"
        opacity={targetId ? 0.9 : 0.6}
        markerEnd="url(#dep-drag-arrow)"
        className="transition-colors duration-150"
      />
      {/* Glow on valid target */}
      {targetId && (
        <path
          d={path}
          stroke="#4ade80"
          strokeWidth="6"
          fill="none"
          opacity="0.15"
          style={{ filter: 'blur(4px)' }}
        />
      )}
    </svg>
  )
}
