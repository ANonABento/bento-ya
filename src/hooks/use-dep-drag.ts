/**
 * Hook for Cmd/Ctrl+drag dependency linking between task cards.
 *
 * When the user holds Cmd (Mac) or Ctrl (Win) and drags from one card
 * to another, it creates a dependency between the two tasks.
 * A preview bezier line follows the cursor during the drag.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import type { Task } from '@/types'
import * as ipc from '@/lib/ipc'

export type DepDragState = {
  /** Source task being dragged from */
  sourceId: string
  /** Source card center position (relative to board) */
  sourceX: number
  sourceY: number
  /** Current cursor position (relative to board) */
  cursorX: number
  cursorY: number
  /** Target task being hovered over (if any) */
  targetId: string | null
}

type CardRect = { x: number; y: number; width: number; height: number }

type DepEntry = { task_id: string; condition: string }

export function useDepDrag(
  tasks: Task[],
  positions: Map<string, CardRect>,
) {
  const [dragState, setDragState] = useState<DepDragState | null>(null)
  const boardRef = useRef<HTMLElement | null>(null)
  const dragActive = useRef(false)

  // Resolve board element once
  useEffect(() => {
    boardRef.current = document.querySelector('[data-board-scroll]')
  }, [])

  const getBoardOffset = useCallback(() => {
    const board = boardRef.current
    if (!board) return { x: 0, y: 0 }
    const rect = board.getBoundingClientRect()
    return { x: rect.x - board.scrollLeft, y: rect.y - board.scrollTop }
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent, taskId: string) => {
    if (!(e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    e.stopPropagation()

    const pos = positions.get(taskId)
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
  }, [positions, getBoardOffset])

  // Stable refs for async handler
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const dragStateRef = useRef(dragState)
  dragStateRef.current = dragState

  // Global pointer move/up listeners during drag
  useEffect(() => {
    if (!dragState) return

    const sourceId = dragState.sourceId

    const handleMove = (e: PointerEvent) => {
      if (!dragActive.current) return
      const board = getBoardOffset()
      const cursorX = e.clientX - board.x
      const cursorY = e.clientY - board.y

      // Find which card the cursor is over
      let targetId: string | null = null
      for (const [id, rect] of positions) {
        if (id === sourceId) continue
        if (cursorX >= rect.x && cursorX <= rect.x + rect.width &&
            cursorY >= rect.y && cursorY <= rect.y + rect.height) {
          targetId = id
          break
        }
      }

      setDragState((prev) => prev ? {
        ...prev,
        cursorX,
        cursorY,
        targetId,
      } : null)
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

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [dragState, positions, getBoardOffset])

  return { dragState, handlePointerDown }
}

/** Add a dependency: targetId depends on sourceId with condition "completed". */
async function createDependency(sourceId: string, targetId: string, tasks: Task[]) {
  const target = tasks.find((t) => t.id === targetId)
  if (!target) return

  // Parse existing deps
  let deps: DepEntry[] = []
  if (target.dependencies) {
    try {
      const parsed: unknown = JSON.parse(target.dependencies)
      if (Array.isArray(parsed)) deps = parsed as DepEntry[]
    } catch { /* empty */ }
  }

  // Skip if already exists
  if (deps.some((d) => d.task_id === sourceId)) return

  // Add new dependency with default condition
  deps.push({ task_id: sourceId, condition: 'completed' })

  // Validate (cycle detection)
  try {
    await ipc.validateTaskDependencies(targetId, JSON.stringify(deps))
  } catch {
    return
  }

  // Save
  await ipc.updateTaskTriggers(targetId, {
    dependencies: JSON.stringify(deps),
    blocked: deps.length > 0,
  })
}
