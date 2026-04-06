/**
 * Hook for Cmd/Ctrl+drag dependency linking between task cards.
 *
 * When the user holds Cmd (Mac) or Ctrl (Win) and drags from one card
 * to another, it creates a dependency between the two tasks.
 * A preview bezier line follows the cursor during the drag.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import type { Task } from '@/types'
import type { CardRect } from '@/hooks/use-card-positions'
import { parseDeps } from '@/lib/dependency-utils'
import * as ipc from '@/lib/ipc'

export type DepDragState = {
  sourceId: string
  sourceX: number
  sourceY: number
  cursorX: number
  cursorY: number
  targetId: string | null
}

export function useDepDrag(
  tasks: Task[],
  positions: Map<string, CardRect>,
) {
  const [dragState, setDragState] = useState<DepDragState | null>(null)
  const dragActive = useRef(false)

  // Keep refs current so event handlers always read latest values
  const positionsRef = useRef(positions)
  positionsRef.current = positions
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const dragStateRef = useRef(dragState)
  dragStateRef.current = dragState

  const getBoardOffset = useCallback(() => {
    const board = document.querySelector<HTMLElement>('[data-board-scroll]')
    if (!board) return { x: 0, y: 0 }
    const rect = board.getBoundingClientRect()
    return { x: rect.x - board.scrollLeft, y: rect.y - board.scrollTop }
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent, taskId: string) => {
    if (!(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    e.stopPropagation()

    const pos = positionsRef.current.get(taskId)
    if (!pos) return

    const board = getBoardOffset()

    dragActive.current = true
    setDragState({
      sourceId: taskId,
      sourceX: pos.x + pos.width,
      sourceY: pos.y + pos.height / 2,
      cursorX: e.clientX - board.x,
      cursorY: e.clientY - board.y,
      targetId: null,
    })
  }, [getBoardOffset])

  // Set up global listeners once when drag starts, tear down when it ends.
  // Uses refs to avoid re-creating listeners on every state change.
  useEffect(() => {
    if (!dragState) return

    const sourceId = dragState.sourceId

    const handleMove = (e: PointerEvent) => {
      if (!dragActive.current) return
      const board = getBoardOffset()
      const cursorX = e.clientX - board.x
      const cursorY = e.clientY - board.y

      let targetId: string | null = null
      for (const [id, rect] of positionsRef.current) {
        if (id === sourceId) continue
        if (cursorX >= rect.x && cursorX <= rect.x + rect.width &&
            cursorY >= rect.y && cursorY <= rect.y + rect.height) {
          targetId = id
          break
        }
      }

      setDragState((prev) => prev ? { ...prev, cursorX, cursorY, targetId } : null)
    }

    const handleUp = () => {
      if (!dragActive.current) {
        setDragState(null)
        return
      }

      dragActive.current = false
      const current = dragStateRef.current

      if (current?.targetId && current.targetId !== current.sourceId) {
        void createDependency(current.sourceId, current.targetId, tasksRef.current)
      }

      setDragState(null)
    }

    // Escape to cancel
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dragActive.current = false
        setDragState(null)
      }
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('keydown', handleKeyDown)
    }
    // Only re-create listeners when drag starts/stops (sourceId changes), not on every move
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState?.sourceId, getBoardOffset])

  return { dragState, handlePointerDown }
}

/** Add a dependency: targetId depends on sourceId with condition "completed". */
async function createDependency(sourceId: string, targetId: string, tasks: Task[]) {
  const target = tasks.find((t) => t.id === targetId)
  if (!target) return

  const deps = parseDeps(target.dependencies)

  if (deps.some((d) => d.task_id === sourceId)) return

  deps.push({ task_id: sourceId, condition: 'completed' })

  try {
    await ipc.validateTaskDependencies(targetId, JSON.stringify(deps))
  } catch {
    return
  }

  // Save deps — set blocked as safe default, check_dependents will unblock if deps already met
  await ipc.updateTaskTriggers(targetId, {
    dependencies: JSON.stringify(deps),
    blocked: true,
  })
}
