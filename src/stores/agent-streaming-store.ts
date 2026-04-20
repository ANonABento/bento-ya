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
  /** Last ~200 chars of streamed content (card preview) */
  lastContent: string
  /** Full accumulated content (chat panel catchup) */
  fullContent: string
  /** Full thinking content (chat panel catchup) */
  thinkingContent: string
  /** Currently active tool (most recent non-completed) */
  activeTool: LiveToolCall | null
  /** All tool calls in this session (chat panel catchup) */
  allToolCalls: LiveToolCall[]
  /** Total tool calls in this session */
  toolCount: number
  /** When streaming started */
  startTime: number
}

type AgentStreamingState = {
  streams: Map<string, AgentStream>

  /** Called on agent:stream events */
  appendContent: (taskId: string, content: string) => void
  /** Called on agent:thinking events */
  appendThinking: (taskId: string, content: string) => void
  /** Called on agent:tool_call events */
  updateTool: (taskId: string, toolId: string, toolName: string, status: string) => void
  /** Called on agent:complete — removes the stream entry */
  complete: (taskId: string) => void
  /** Called when streaming starts (first event for a task) */
  ensureStream: (taskId: string) => void
  /** Get stream for a task */
  getStream: (taskId: string) => AgentStream | undefined
}

const DEFAULT_STREAM: AgentStream = {
  lastContent: '',
  fullContent: '',
  thinkingContent: '',
  activeTool: null,
  allToolCalls: [],
  toolCount: 0,
  startTime: Date.now(),
}

export const useAgentStreamingStore = create<AgentStreamingState>((set, get) => ({
  streams: new Map(),

  ensureStream: (taskId) => {
    if (get().streams.has(taskId)) return
    set((state) => {
      const next = new Map(state.streams)
      next.set(taskId, { ...DEFAULT_STREAM, startTime: Date.now() })
      return { streams: next }
    })
  },

  appendContent: (taskId, content) => {
    set((state) => {
      const next = new Map(state.streams)
      const stream = next.get(taskId) ?? { ...DEFAULT_STREAM, startTime: Date.now() }
      const preview = stream.lastContent + content
      next.set(taskId, {
        ...stream,
        lastContent: preview.length > 200 ? preview.slice(-200) : preview,
        fullContent: stream.fullContent + content,
      })
      return { streams: next }
    })
  },

  appendThinking: (taskId, content) => {
    set((state) => {
      const next = new Map(state.streams)
      const stream = next.get(taskId) ?? { ...DEFAULT_STREAM, startTime: Date.now() }
      next.set(taskId, {
        ...stream,
        thinkingContent: stream.thinkingContent + content,
      })
      return { streams: next }
    })
  },

  updateTool: (taskId, toolId, toolName, status) => {
    set((state) => {
      const next = new Map(state.streams)
      const stream = next.get(taskId) ?? { ...DEFAULT_STREAM, startTime: Date.now() }

      const toolStatus = status as LiveToolCall['status']
      const isActive = toolStatus === 'pending' || toolStatus === 'running'
      const isNew = !stream.allToolCalls.some((t) => t.id === toolId)
      const tool: LiveToolCall = { id: toolId, name: toolName, status: toolStatus }

      next.set(taskId, {
        ...stream,
        activeTool: isActive ? tool : null,
        allToolCalls: isNew
          ? [...stream.allToolCalls, tool]
          : stream.allToolCalls.map((t) => t.id === toolId ? tool : t),
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
