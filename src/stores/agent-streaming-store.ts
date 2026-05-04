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
  startedAt: number
  endedAt?: number
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
  /** Set when agent:complete fires — viewer keeps the final state until next run */
  completedAt?: number
}

type AgentStreamingState = {
  streams: Map<string, AgentStream>

  /** Called on agent:stream events */
  appendContent: (taskId: string, content: string) => void
  /** Called on agent:thinking events */
  appendThinking: (taskId: string, content: string) => void
  /** Called on agent:tool_call events */
  updateTool: (taskId: string, toolId: string, toolName: string, status: string) => void
  /** Called on agent:complete — marks stream as completed (preserves final state) */
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

function createStream(): AgentStream {
  return { ...DEFAULT_STREAM, startTime: Date.now() }
}

function normalizeToolStatus(status: string): LiveToolCall['status'] {
  if (status === 'pending' || status === 'running' || status === 'completed' || status === 'error') {
    return status
  }
  return 'running'
}

export const useAgentStreamingStore = create<AgentStreamingState>((set, get) => ({
  streams: new Map(),

  ensureStream: (taskId) => {
    const existing = get().streams.get(taskId)
    if (existing && !existing.completedAt) return
    set((state) => {
      const next = new Map(state.streams)
      next.set(taskId, createStream())
      return { streams: next }
    })
  },

  appendContent: (taskId, content) => {
    set((state) => {
      const next = new Map(state.streams)
      const stream = next.get(taskId) ?? createStream()
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
      const stream = next.get(taskId) ?? createStream()
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
      const stream = next.get(taskId) ?? createStream()

      const toolStatus = normalizeToolStatus(status)
      const isActive = toolStatus === 'pending' || toolStatus === 'running'
      const isNew = !stream.allToolCalls.some((t) => t.id === toolId)
      const existingTool = stream.allToolCalls.find((t) => t.id === toolId)
      const now = Date.now()
      const isFinished = toolStatus === 'completed' || toolStatus === 'error'
      const tool: LiveToolCall = {
        id: toolId,
        name: toolName,
        status: toolStatus,
        startedAt: existingTool?.startedAt ?? now,
        endedAt: isFinished ? (existingTool?.endedAt ?? now) : undefined,
      }

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
    // Don't delete — mark as completed so the panel can show final state.
    // Stream is reset on next ensureStream() (i.e. when agent re-runs).
    set((state) => {
      const stream = state.streams.get(taskId)
      if (!stream) return state
      const completedAt = Date.now()
      const allToolCalls = stream.allToolCalls.map((tool) =>
        tool.status === 'pending' || tool.status === 'running'
          ? { ...tool, status: 'completed' as const, endedAt: tool.endedAt ?? completedAt }
          : tool,
      )
      const next = new Map(state.streams)
      next.set(taskId, {
        ...stream,
        activeTool: null,
        allToolCalls,
        completedAt,
      })
      return { streams: next }
    })
  },

  getStream: (taskId) => get().streams.get(taskId),
}))

// Expose store globally for Playwright/webdriver tests so they can inject
// stream events without firing real Tauri events. Lives only when running
// in browser mock mode (no Tauri runtime present).
if (typeof window !== 'undefined') {
  ;(window as unknown as { __bentoyaAgentStreamingStore?: typeof useAgentStreamingStore }).__bentoyaAgentStreamingStore = useAgentStreamingStore
}
