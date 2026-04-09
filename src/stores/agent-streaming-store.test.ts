import { describe, it, expect, beforeEach } from 'vitest'
import { useAgentStreamingStore } from './agent-streaming-store'

function getStreamOrThrow(taskId: string) {
  const stream = useAgentStreamingStore.getState().getStream(taskId)
  expect(stream).toBeDefined()
  if (!stream) {
    throw new Error(`Expected stream for ${taskId}`)
  }
  return stream
}

describe('agent-streaming-store', () => {
  beforeEach(() => {
    useAgentStreamingStore.setState({ streams: new Map() })
  })

  describe('ensureStream', () => {
    it('should create a new stream entry for a task', () => {
      useAgentStreamingStore.getState().ensureStream('task-1')

      const stream = getStreamOrThrow('task-1')
      expect(stream.lastContent).toBe('')
      expect(stream.activeTool).toBeNull()
      expect(stream.toolCount).toBe(0)
      expect(stream.startTime).toBeGreaterThan(0)
    })

    it('should not overwrite existing stream', () => {
      useAgentStreamingStore.getState().ensureStream('task-1')
      const original = getStreamOrThrow('task-1')

      // Modify the stream
      useAgentStreamingStore.getState().appendContent('task-1', 'hello')

      // ensureStream again should not reset it
      useAgentStreamingStore.getState().ensureStream('task-1')
      const after = getStreamOrThrow('task-1')
      expect(after.lastContent).toBe('hello')
      expect(after.startTime).toBe(original.startTime)
    })
  })

  describe('appendContent', () => {
    it('should append content to existing stream', () => {
      useAgentStreamingStore.getState().ensureStream('task-1')
      useAgentStreamingStore.getState().appendContent('task-1', 'hello ')
      useAgentStreamingStore.getState().appendContent('task-1', 'world')

      const stream = getStreamOrThrow('task-1')
      expect(stream.lastContent).toBe('hello world')
    })

    it('should create stream if not exists', () => {
      useAgentStreamingStore.getState().appendContent('task-new', 'content')

      const stream = getStreamOrThrow('task-new')
      expect(stream.lastContent).toBe('content')
    })

    it('should truncate content to last 200 chars', () => {
      useAgentStreamingStore.getState().ensureStream('task-1')

      const longContent = 'a'.repeat(250)
      useAgentStreamingStore.getState().appendContent('task-1', longContent)

      const stream = getStreamOrThrow('task-1')
      expect(stream.lastContent).toHaveLength(200)
      expect(stream.lastContent).toBe('a'.repeat(200))
    })
  })

  describe('updateTool', () => {
    it('should set active tool when status is running', () => {
      useAgentStreamingStore.getState().ensureStream('task-1')
      useAgentStreamingStore.getState().updateTool('task-1', 'tool-1', 'read_file', 'running')

      const stream = getStreamOrThrow('task-1')
      expect(stream.activeTool).toEqual({
        id: 'tool-1',
        name: 'read_file',
        status: 'running',
      })
    })

    it('should clear active tool when status is completed', () => {
      useAgentStreamingStore.getState().ensureStream('task-1')
      useAgentStreamingStore.getState().updateTool('task-1', 'tool-1', 'read_file', 'running')
      useAgentStreamingStore.getState().updateTool('task-1', 'tool-1', 'read_file', 'completed')

      const stream = getStreamOrThrow('task-1')
      expect(stream.activeTool).toBeNull()
    })

    it('should increment tool count for new tools', () => {
      useAgentStreamingStore.getState().ensureStream('task-1')
      useAgentStreamingStore.getState().updateTool('task-1', 'tool-1', 'read_file', 'running')
      useAgentStreamingStore.getState().updateTool('task-1', 'tool-2', 'write_file', 'running')

      const stream = getStreamOrThrow('task-1')
      expect(stream.toolCount).toBe(2)
    })

    it('should not increment tool count for same tool status update', () => {
      useAgentStreamingStore.getState().ensureStream('task-1')
      useAgentStreamingStore.getState().updateTool('task-1', 'tool-1', 'read_file', 'pending')
      useAgentStreamingStore.getState().updateTool('task-1', 'tool-1', 'read_file', 'running')
      useAgentStreamingStore.getState().updateTool('task-1', 'tool-1', 'read_file', 'completed')

      const stream = getStreamOrThrow('task-1')
      expect(stream.toolCount).toBe(1)
    })
  })

  describe('complete', () => {
    it('should remove stream entry for task', () => {
      useAgentStreamingStore.getState().ensureStream('task-1')
      useAgentStreamingStore.getState().complete('task-1')

      const stream = useAgentStreamingStore.getState().getStream('task-1')
      expect(stream).toBeUndefined()
    })

    it('should not error if task has no stream', () => {
      expect(() => {
        useAgentStreamingStore.getState().complete('nonexistent')
      }).not.toThrow()
    })
  })

  describe('getStream', () => {
    it('should return stream for existing task', () => {
      useAgentStreamingStore.getState().ensureStream('task-1')

      const stream = getStreamOrThrow('task-1')
      expect(stream.toolCount).toBe(0)
    })

    it('should return undefined for unknown task', () => {
      const stream = useAgentStreamingStore.getState().getStream('nonexistent')
      expect(stream).toBeUndefined()
    })
  })
})
