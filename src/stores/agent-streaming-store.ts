/**
 * Ephemeral store for live agent streaming state.
 * Holds per-task streaming data (content, tool calls, timing) that
 * is NOT persisted — it only lives while agents are actively running.
 * Task cards read from this store to show live agent activity.
 */

import { create } from 'zustand'

export type LiveToolCall = {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'error'
}

export type AgentStream = {
  /** Last ~200 chars of streamed content */
  lastContent: string
  /** Currently active tool (most recent non-completed) */
  activeTool: LiveToolCall | null
  /** Total tool calls in this session */
  toolCount: number
  /** When streaming started */
  startTime: number
}

type AgentStreamingState = {
  streams: Map<string, AgentStream>

  /** Called on agent:stream events */
  appendContent: (taskId: string, content: string) => void
  /** Called on agent:tool_call events */
  updateTool: (taskId: string, toolId: string, toolName: string, status: string) => void
  /** Called on agent:complete — removes the stream entry */
  complete: (taskId: string) => void
  /** Called when streaming starts (first event for a task) */
  ensureStream: (taskId: string) => void
  /** Get stream for a task */
  getStream: (taskId: string) => AgentStream | undefined
}

export const useAgentStreamingStore = create<AgentStreamingState>((set, get) => ({
  streams: new Map(),

  ensureStream: (taskId) => {
    if (get().streams.has(taskId)) return
    set((state) => {
      const next = new Map(state.streams)
      next.set(taskId, {
        lastContent: '',
        activeTool: null,
        toolCount: 0,
        startTime: Date.now(),
      })
      return { streams: next }
    })
  },

  appendContent: (taskId, content) => {
    set((state) => {
      const next = new Map(state.streams)
      const stream = next.get(taskId) ?? {
        lastContent: '', activeTool: null, toolCount: 0, startTime: Date.now(),
      }
      // Keep last 200 chars for card preview
      const updated = stream.lastContent + content
      next.set(taskId, {
        ...stream,
        lastContent: updated.length > 200 ? updated.slice(-200) : updated,
      })
      return { streams: next }
    })
  },

  updateTool: (taskId, toolId, toolName, status) => {
    set((state) => {
      const next = new Map(state.streams)
      const stream = next.get(taskId) ?? {
        lastContent: '', activeTool: null, toolCount: 0, startTime: Date.now(),
      }

      const toolStatus = status as LiveToolCall['status']
      const isActive = toolStatus === 'pending' || toolStatus === 'running'
      const isNew = !stream.activeTool || stream.activeTool.id !== toolId

      next.set(taskId, {
        ...stream,
        activeTool: isActive ? { id: toolId, name: toolName, status: toolStatus } : null,
        toolCount: isNew ? stream.toolCount + 1 : stream.toolCount,
      })
      return { streams: next }
    })
  },

  complete: (taskId) => {
    set((state) => {
      const next = new Map(state.streams)
      next.delete(taskId)
      return { streams: next }
    })
  },

  getStream: (taskId) => get().streams.get(taskId),
}))
