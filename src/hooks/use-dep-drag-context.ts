import { createContext, useContext } from 'react'

type DepDragContextValue = {
  onDepDragStart: (e: React.PointerEvent, taskId: string) => void
  isDraggingDep: boolean
}

export const DepDragContext = createContext<DepDragContextValue>({
  onDepDragStart: () => {},
  isDraggingDep: false,
})

export function useDepDragContext() {
  return useContext(DepDragContext)
}
