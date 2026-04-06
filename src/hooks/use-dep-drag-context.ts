import { createContext, useContext } from 'react'

type DepDragContextValue = {
  onDepDragStart: (e: React.PointerEvent, taskId: string) => void
  isDraggingDep: boolean
  hoveredTaskId: string | null
  setHoveredTaskId: (id: string | null) => void
}

export const DepDragContext = createContext<DepDragContextValue>({
  onDepDragStart: () => {},
  isDraggingDep: false,
  hoveredTaskId: null,
  setHoveredTaskId: () => {},
})

export function useDepDragContext() {
  return useContext(DepDragContext)
}
