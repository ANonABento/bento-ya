/**
 * Preview bezier line rendered during Cmd+drag dependency linking.
 * Shows a line from the source card to the cursor (or snapped to target card).
 */

import type { DepDragState } from '@/hooks/use-dep-drag'
import type { CardRect } from '@/hooks/use-card-positions'
import { svgPath } from './dependency-lines'

type Props = {
  dragState: DepDragState
  positions: Map<string, CardRect>
}

export function DepDragPreview({ dragState, positions }: Props) {
  const { sourceX, sourceY, cursorX, cursorY, targetId } = dragState

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
  const color = targetId ? '#4ade80' : '#a78bfa'

  return (
    <svg
      className="absolute inset-0 pointer-events-none overflow-visible"
      style={{ zIndex: 50 }}
    >
      <path
        d={path}
        stroke={color}
        strokeWidth="2"
        strokeDasharray={targetId ? 'none' : '6 4'}
        fill="none"
        opacity={targetId ? 0.9 : 0.5}
        strokeLinecap="round"
      />
    </svg>
  )
}
