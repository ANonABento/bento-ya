import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useChatSession, type ChatSessionConfig } from './chat-session'

// Mock IPC module
vi.mock('@/lib/ipc', () => ({
  // Agent IPC
  streamAgentChat: vi.fn(),
  cancelAgentChat: vi.fn(),
  getAgentMessages: vi.fn(),
  clearAgentMessages: vi.fn(),
  onAgentStream: vi.fn(() => Promise.resolve(() => {})),
  onAgentThinking: vi.fn(() => Promise.resolve(() => {})),
  onAgentToolCall: vi.fn(() => Promise.resolve(() => {})),
  onAgentComplete: vi.fn(() => Promise.resolve(() => {})),
  // Orchestrator IPC
  streamOrchestratorChat: vi.fn(),
  cancelOrchestratorChat: vi.fn(),
  getChatHistory: vi.fn(),
  clearChatHistory: vi.fn(),
}))

// Mock Tauri event listen (for orchestrator mode)
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

import * as ipc from '@/lib/ipc'
import { listen } from '@tauri-apps/api/event'

const mockIpc = vi.mocked(ipc)
const mockListen = vi.mocked(listen)

// Store event handlers for simulating events
const eventHandlers: Map<string, ((event: unknown) => void)[]> = new Map()

function emitEvent(eventName: string, payload: unknown) {
  const handlers = eventHandlers.get(eventName) ?? []
  for (const handler of handlers) {
    handler({ payload })
  }
}

describe('useChatSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventHandlers.clear()

    // Default mock implementations
    mockIpc.getAgentMessages.mockResolvedValue([])
    mockIpc.getChatHistory.mockResolvedValue([])
    mockIpc.streamAgentChat.mockResolvedValue(undefined)
    mockIpc.streamOrchestratorChat.mockResolvedValue(undefined)
    mockIpc.cancelAgentChat.mockResolvedValue(undefined)
    mockIpc.cancelOrchestratorChat.mockResolvedValue(undefined)
    mockIpc.clearAgentMessages.mockResolvedValue(undefined)
    mockIpc.clearChatHistory.mockResolvedValue(undefined)

    // Capture event listeners for orchestrator mode
    mockListen.mockImplementation((eventName, handler) => {
      const name = String(eventName)
      const h = handler as (event: unknown) => void
      const handlers = eventHandlers.get(name) || []
      handlers.push(h)
      eventHandlers.set(name, handlers)
      return Promise.resolve(() => {
        const idx = handlers.indexOf(h)
        if (idx >= 0) handlers.splice(idx, 1)
      })
    })

    // Capture event listeners for agent mode
    mockIpc.onAgentStream.mockImplementation((handler) => {
      const handlers = eventHandlers.get('agent:stream') || []
      handlers.push(handler as (event: unknown) => void)
      eventHandlers.set('agent:stream', handlers)
      return Promise.resolve(() => {})
    })
    mockIpc.onAgentThinking.mockImplementation((handler) => {
      const handlers = eventHandlers.get('agent:thinking') || []
      handlers.push(handler as (event: unknown) => void)
      eventHandlers.set('agent:thinking', handlers)
      return Promise.resolve(() => {})
    })
    mockIpc.onAgentToolCall.mockImplementation((handler) => {
      const handlers = eventHandlers.get('agent:tool_call') || []
      handlers.push(handler as (event: unknown) => void)
      eventHandlers.set('agent:tool_call', handlers)
      return Promise.resolve(() => {})
    })
    mockIpc.onAgentComplete.mockImplementation((handler) => {
      const handlers = eventHandlers.get('agent:complete') || []
      handlers.push(handler as (event: unknown) => void)
      eventHandlers.set('agent:complete', handlers)
      return Promise.resolve(() => {})
    })
  })

  describe('canSend', () => {
    it('should return canSend=true when agent mode has taskId', async () => {
      const config: ChatSessionConfig = {
        mode: 'agent',
        taskId: 'task-1',
        workingDir: '/tmp',
      }
      const { result } = renderHook(() => useChatSession(config))
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      expect(result.current.canSend).toBe(true)
    })

    it('should return canSend=false when agent mode has no taskId', async () => {
      const config: ChatSessionConfig = {
        mode: 'agent',
        workingDir: '/tmp',
      }
      const { result } = renderHook(() => useChatSession(config))
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      expect(result.current.canSend).toBe(false)
    })

    it('should return canSend=true when orchestrator mode has workspaceId and sessionId', async () => {
      const config: ChatSessionConfig = {
        mode: 'orchestrator',
        workspaceId: 'ws-1',
        sessionId: 'session-1',
      }
      const { result } = renderHook(() => useChatSession(config))
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      expect(result.current.canSend).toBe(true)
    })

    it('should return canSend=false when orchestrator mode is missing sessionId', async () => {
      const config: ChatSessionConfig = {
        mode: 'orchestrator',
        workspaceId: 'ws-1',
        // sessionId is undefined
      }
      const { result } = renderHook(() => useChatSession(config))
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      expect(result.current.canSend).toBe(false)
    })

    it('should return canSend=false when orchestrator mode is missing workspaceId', async () => {
      const config: ChatSessionConfig = {
        mode: 'orchestrator',
        sessionId: 'session-1',
      }
      const { result } = renderHook(() => useChatSession(config))
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
      expect(result.current.canSend).toBe(false)
    })
  })

  describe('sendMessage - agent mode', () => {
    it('should send message via streamAgentChat when canSend=true', async () => {
      const config: ChatSessionConfig = {
        mode: 'agent',
        taskId: 'task-1',
        workingDir: '/tmp',
        cliPath: 'claude',
      }
      const { result } = renderHook(() => useChatSession(config))

      await act(async () => {
        await result.current.sendMessage('Hello')
      })

      expect(mockIpc.streamAgentChat).toHaveBeenCalledWith(
        'task-1',
        'Hello',
        '/tmp',
        'claude',
        undefined,
        undefined
      )
    })

    it('should not send message when canSend=false', async () => {
      const config: ChatSessionConfig = {
        mode: 'agent',
        // No taskId - canSend should be false
      }
      const { result } = renderHook(() => useChatSession(config))

      await act(async () => {
        await result.current.sendMessage('Hello')
      })

      expect(mockIpc.streamAgentChat).not.toHaveBeenCalled()
    })

    it('should start streaming state after send', async () => {
      const config: ChatSessionConfig = {
        mode: 'agent',
        taskId: 'task-1',
        workingDir: '/tmp',
      }
      const { result } = renderHook(() => useChatSession(config))

      await act(async () => {
        await result.current.sendMessage('Hello')
      })

      // Streaming should have started
      expect(result.current.streaming.isStreaming).toBe(true)
      expect(result.current.streaming.startTime).not.toBeNull()
    })

    it('should set streaming state when sending', async () => {
      const config: ChatSessionConfig = {
        mode: 'agent',
        taskId: 'task-1',
        workingDir: '/tmp',
      }
      const { result } = renderHook(() => useChatSession(config))

      await act(async () => {
        await result.current.sendMessage('Hello')
      })

      expect(result.current.streaming.isStreaming).toBe(true)
      expect(result.current.streaming.startTime).not.toBeNull()
    })
  })

  describe('sendMessage - orchestrator mode', () => {
    it('should send message via streamOrchestratorChat when canSend=true', async () => {
      const config: ChatSessionConfig = {
        mode: 'orchestrator',
        workspaceId: 'ws-1',
        sessionId: 'session-1',
        connectionMode: 'cli',
        cliPath: 'claude',
      }
      const { result } = renderHook(() => useChatSession(config))

      await act(async () => {
        await result.current.sendMessage('Hello', 'sonnet')
      })

      expect(mockIpc.streamOrchestratorChat).toHaveBeenCalledWith(
        'ws-1',
        'session-1',
        'Hello',
        'cli',
        undefined,
        undefined,
        'sonnet',
        'claude'
      )
    })

    it('should not send message when sessionId is missing', async () => {
      const config: ChatSessionConfig = {
        mode: 'orchestrator',
        workspaceId: 'ws-1',
        // No sessionId
      }
      const { result } = renderHook(() => useChatSession(config))

      await act(async () => {
        await result.current.sendMessage('Hello')
      })

      expect(mockIpc.streamOrchestratorChat).not.toHaveBeenCalled()
    })
  })

  describe('message queue', () => {
    it('should queue messages when already processing', async () => {
      const config: ChatSessionConfig = {
        mode: 'agent',
        taskId: 'task-1',
        workingDir: '/tmp',
      }
      const { result } = renderHook(() => useChatSession(config))

      // Send first message
      await act(async () => {
        await result.current.sendMessage('First')
      })

      // Send second message while first is processing
      await act(async () => {
        await result.current.sendMessage('Second')
      })

      // First message should be sent, second should be queued
      expect(mockIpc.streamAgentChat).toHaveBeenCalledTimes(1)
      expect(result.current.queue).toHaveLength(1)
      expect(result.current.queue[0]?.content).toBe('Second')
    })

    it('should track queued message count', async () => {
      const config: ChatSessionConfig = {
        mode: 'agent',
        taskId: 'task-1',
        workingDir: '/tmp',
      }
      const { result } = renderHook(() => useChatSession(config))

      // Send first message (will start streaming)
      await act(async () => {
        await result.current.sendMessage('First')
      })

      // Verify first message was sent
      expect(mockIpc.streamAgentChat).toHaveBeenCalledTimes(1)

      // Send second message (should be queued since first is processing)
      await act(async () => {
        await result.current.sendMessage('Second')
      })

      // Second message should be in the queue
      expect(result.current.queue.length).toBe(1)
      expect(result.current.queue[0]?.content).toBe('Second')
    })
  })

  describe('cancel', () => {
    it('should cancel agent chat and clear queue', async () => {
      const config: ChatSessionConfig = {
        mode: 'agent',
        taskId: 'task-1',
        workingDir: '/tmp',
      }
      const { result } = renderHook(() => useChatSession(config))

      // Send messages
      await act(async () => {
        await result.current.sendMessage('First')
        await result.current.sendMessage('Second')
      })

      expect(result.current.queue).toHaveLength(1)

      // Cancel
      await act(async () => {
        await result.current.cancel()
      })

      expect(mockIpc.cancelAgentChat).toHaveBeenCalledWith('task-1')
      expect(result.current.queue).toHaveLength(0)
    })

    it('should cancel orchestrator chat and clear queue', async () => {
      const config: ChatSessionConfig = {
        mode: 'orchestrator',
        workspaceId: 'ws-1',
        sessionId: 'session-1',
      }
      const { result } = renderHook(() => useChatSession(config))

      await act(async () => {
        await result.current.sendMessage('First')
        await result.current.sendMessage('Second')
      })

      await act(async () => {
        await result.current.cancel()
      })

      expect(mockIpc.cancelOrchestratorChat).toHaveBeenCalledWith('session-1', 'ws-1')
      expect(result.current.queue).toHaveLength(0)
    })

    it('should clear state even when canSend=false', async () => {
      const config: ChatSessionConfig = {
        mode: 'orchestrator',
        workspaceId: 'ws-1',
        // No sessionId
      }
      const { result } = renderHook(() => useChatSession(config))

      await act(async () => {
        await result.current.cancel()
      })

      // Should not throw, and state should be reset
      expect(mockIpc.cancelOrchestratorChat).not.toHaveBeenCalled()
      expect(result.current.streaming.isStreaming).toBe(false)
    })
  })

  describe('clearMessages', () => {
    it('should clear agent messages', async () => {
      const config: ChatSessionConfig = {
        mode: 'agent',
        taskId: 'task-1',
      }
      mockIpc.getAgentMessages.mockResolvedValueOnce([
        { id: 'msg-1', taskId: 'task-1', role: 'user', content: 'Hello', model: null, effortLevel: null, toolCalls: null, thinkingContent: null, createdAt: '2024-01-01' },
      ])

      const { result } = renderHook(() => useChatSession(config))

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1)
      })

      await act(async () => {
        await result.current.clearMessages()
      })

      expect(mockIpc.clearAgentMessages).toHaveBeenCalledWith('task-1')
      expect(result.current.messages).toHaveLength(0)
    })

    it('should clear orchestrator messages', async () => {
      const config: ChatSessionConfig = {
        mode: 'orchestrator',
        workspaceId: 'ws-1',
        sessionId: 'session-1',
      }
      mockIpc.getChatHistory.mockResolvedValueOnce([
        { id: 'msg-1', workspaceId: 'ws-1', sessionId: 'session-1', role: 'user', content: 'Hello', createdAt: '2024-01-01' },
      ])

      const { result } = renderHook(() => useChatSession(config))

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(1)
      })

      await act(async () => {
        await result.current.clearMessages()
      })

      expect(mockIpc.clearChatHistory).toHaveBeenCalledWith('session-1')
      expect(result.current.messages).toHaveLength(0)
    })
  })

  describe('error handling', () => {
    it('should set failedMessage on send error', async () => {
      const onError = vi.fn()
      const config: ChatSessionConfig = {
        mode: 'agent',
        taskId: 'task-1',
        workingDir: '/tmp',
        onError,
      }
      mockIpc.streamAgentChat.mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useChatSession(config))

      await act(async () => {
        await result.current.sendMessage('Hello')
      })

      expect(result.current.failedMessage).not.toBeNull()
      expect(result.current.failedMessage?.content).toBe('Hello')
      expect(result.current.failedMessage?.error).toBe('Network error')
      expect(onError).toHaveBeenCalled()
    })

    it('should reset streaming state on error', async () => {
      const config: ChatSessionConfig = {
        mode: 'agent',
        taskId: 'task-1',
        workingDir: '/tmp',
      }
      mockIpc.streamAgentChat.mockRejectedValueOnce(new Error('Error'))

      const { result } = renderHook(() => useChatSession(config))

      await act(async () => {
        await result.current.sendMessage('Hello')
      })

      expect(result.current.streaming.isStreaming).toBe(false)
      expect(result.current.streaming.content).toBe('')
    })
  })

  describe('retry and dismiss', () => {
    it('should retry failed message', async () => {
      const config: ChatSessionConfig = {
        mode: 'agent',
        taskId: 'task-1',
        workingDir: '/tmp',
      }
      // First call fails, second succeeds
      mockIpc.streamAgentChat
        .mockRejectedValueOnce(new Error('Error'))
        .mockResolvedValueOnce(undefined)

      const { result } = renderHook(() => useChatSession(config))

      // Send and fail
      await act(async () => {
        await result.current.sendMessage('Hello')
      })

      expect(result.current.failedMessage).not.toBeNull()

      // Retry
      await act(async () => {
        await result.current.retryFailed()
      })

      expect(result.current.failedMessage).toBeNull()
      expect(mockIpc.streamAgentChat).toHaveBeenCalledTimes(2)
    })

    it('should dismiss failed message', async () => {
      const config: ChatSessionConfig = {
        mode: 'agent',
        taskId: 'task-1',
        workingDir: '/tmp',
      }
      mockIpc.streamAgentChat.mockRejectedValueOnce(new Error('Error'))

      const { result } = renderHook(() => useChatSession(config))

      await act(async () => {
        await result.current.sendMessage('Hello')
      })

      expect(result.current.failedMessage).not.toBeNull()

      act(() => {
        result.current.dismissFailed()
      })

      expect(result.current.failedMessage).toBeNull()
    })
  })

  describe('streaming events - agent', () => {
    it('should set up event listeners on mount', async () => {
      const config: ChatSessionConfig = {
        mode: 'agent',
        taskId: 'task-1',
        workingDir: '/tmp',
      }
      renderHook(() => useChatSession(config))

      // Wait for listeners to be set up
      await waitFor(() => {
        expect(mockIpc.onAgentStream).toHaveBeenCalled()
        expect(mockIpc.onAgentThinking).toHaveBeenCalled()
        expect(mockIpc.onAgentToolCall).toHaveBeenCalled()
        expect(mockIpc.onAgentComplete).toHaveBeenCalled()
      })
    })

    it('should initialize with empty streaming content', async () => {
      const config: ChatSessionConfig = {
        mode: 'agent',
        taskId: 'task-1',
        workingDir: '/tmp',
      }
      const { result } = renderHook(() => useChatSession(config))
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Stream handler is set up, content starts empty
      expect(result.current.streaming.content).toBe('')
      expect(result.current.streaming.isStreaming).toBe(false)
    })
  })

  describe('load messages', () => {
    it('should load agent messages on mount', async () => {
      const config: ChatSessionConfig = {
        mode: 'agent',
        taskId: 'task-1',
      }
      mockIpc.getAgentMessages.mockResolvedValueOnce([
        { id: 'msg-1', taskId: 'task-1', role: 'user', content: 'Hello', model: null, effortLevel: null, toolCalls: null, thinkingContent: null, createdAt: '2024-01-01' },
        { id: 'msg-2', taskId: 'task-1', role: 'assistant', content: 'Hi!', model: null, effortLevel: null, toolCalls: null, thinkingContent: null, createdAt: '2024-01-01' },
      ])

      const { result } = renderHook(() => useChatSession(config))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.messages).toHaveLength(2)
      expect(mockIpc.getAgentMessages).toHaveBeenCalledWith('task-1')
    })

    it('should load orchestrator messages on mount', async () => {
      const config: ChatSessionConfig = {
        mode: 'orchestrator',
        workspaceId: 'ws-1',
        sessionId: 'session-1',
      }
      mockIpc.getChatHistory.mockResolvedValueOnce([
        { id: 'msg-1', workspaceId: 'ws-1', sessionId: 'session-1', role: 'user', content: 'Hello', createdAt: '2024-01-01' },
      ])

      const { result } = renderHook(() => useChatSession(config))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.messages).toHaveLength(1)
      expect(mockIpc.getChatHistory).toHaveBeenCalledWith('session-1', 100)
    })

    it('should not load messages when primaryId is missing', async () => {
      const config: ChatSessionConfig = {
        mode: 'agent',
        // No taskId
      }

      const { result } = renderHook(() => useChatSession(config))

      // Give it time to potentially call the API
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(mockIpc.getAgentMessages).not.toHaveBeenCalled()
      expect(result.current.isLoading).toBe(false)
      expect(result.current.messages).toEqual([])
    })
  })

  describe('orchestrator session scoping', () => {
    it('ignores orchestrator events for other sessions in the same workspace', async () => {
      const config: ChatSessionConfig = {
        mode: 'orchestrator',
        workspaceId: 'ws-1',
        sessionId: 'session-1',
      }

      const { result } = renderHook(() => useChatSession(config))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      act(() => {
        emitEvent('orchestrator:processing', {
          workspaceId: 'ws-1',
          sessionId: 'session-2',
          eventType: 'processing',
          message: 'wrong session',
        })
      })
      expect(result.current.streaming.isStreaming).toBe(false)

      act(() => {
        emitEvent('orchestrator:processing', {
          workspaceId: 'ws-1',
          sessionId: 'session-1',
          eventType: 'processing',
          message: 'right session',
        })
      })
      expect(result.current.streaming.isStreaming).toBe(true)

      act(() => {
        emitEvent('orchestrator:stream', {
          workspaceId: 'ws-1',
          sessionId: 'session-2',
          delta: 'ignored',
          finishReason: null,
        })
      })
      expect(result.current.streaming.content).toBe('')

      act(() => {
        emitEvent('orchestrator:stream', {
          workspaceId: 'ws-1',
          delta: 'missing session should be ignored',
          finishReason: null,
        })
      })
      expect(result.current.streaming.content).toBe('')

      act(() => {
        emitEvent('orchestrator:stream', {
          workspaceId: 'ws-1',
          sessionId: 'session-1',
          delta: 'kept',
          finishReason: null,
        })
      })
      expect(result.current.streaming.content).toBe('kept')
    })
  })
})
