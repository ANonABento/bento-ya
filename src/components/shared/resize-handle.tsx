/**
 * Shared resize handle bar for draggable panels.
 * Renders a thin interactive strip that shows a highlight on hover.
 */

type ResizeHandleProps = {
  /** 'horizontal' = left/right edge, 'vertical' = top/bottom edge */
  direction: 'horizontal' | 'vertical'
  /** Which edge the handle sits on */
  position: 'top' | 'left' | 'right'
  /** Mouse down handler from useResizablePanel */
  onMouseDown: (e: React.MouseEvent) => void
}

export function ResizeHandle({ direction, position, onMouseDown }: ResizeHandleProps) {
  if (direction === 'horizontal') {
    const isLeft = position === 'left'
    return (
      <div
        onMouseDown={onMouseDown}
        className={`absolute ${isLeft ? '-left-1.5' : '-right-1.5'} top-0 bottom-0 w-3 z-50 group`}
        style={{ cursor: 'col-resize' }}
      >
        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-transparent group-hover:bg-accent/60 transition-colors -translate-x-1/2" />
      </div>
    )
  }

  return (
    <div
      onMouseDown={onMouseDown}
      className="absolute -top-1.5 left-0 right-0 h-3 z-50 group"
      style={{ cursor: 'row-resize' }}
    >
      <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-transparent group-hover:bg-accent/60 transition-colors -translate-y-1/2" />
    </div>
  )
}
