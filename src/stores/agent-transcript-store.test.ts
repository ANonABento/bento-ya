import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentTranscriptStore } from './agent-transcript-store'
import type { AgentTranscriptEvent } from '@/types/events'

const liveHandlers = new Map<string, (event: AgentTranscriptEvent) => void>()
const unlistenMock = vi.fn()

vi.mock('@/lib/ipc', () => ({
  getAgentTranscriptEvents: vi.fn(),
  onAgentTranscriptEvent: vi.fn((taskId: string, cb: (event: AgentTranscriptEvent) => void) => {
    liveHandlers.set(taskId, cb)
    return Promise.resolve(unlistenMock)
  }),
}))

import { getAgentTranscriptEvents, onAgentTranscriptEvent } from '@/lib/ipc'

function event(overrides: Partial<AgentTranscriptEvent>): AgentTranscriptEvent {
  return {
    id: 'event-1',
    taskId: 'task-1',
    sessionId: null,
    eventType: 'agent_text_delta',
    content: 'hello',
    metadataJson: null,
    sequence: 1,
    createdAt: '2026-05-07T06:00:00Z',
    ...overrides,
  }
}

describe('agent-transcript-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    liveHandlers.clear()
    useAgentTranscriptStore.getState().reset()
  })

  it('loads persisted events for a task', async () => {
    vi.mocked(getAgentTranscriptEvents).mockResolvedValue([
      event({ id: 'e2', sequence: 2, content: 'second' }),
      event({ id: 'e1', sequence: 1, content: 'first' }),
    ])

    await useAgentTranscriptStore.getState().load('task-1')

    const state = useAgentTranscriptStore.getState().getTaskState('task-1')
    expect(state.isLoading).toBe(false)
    expect(state.events.map((item) => item.content)).toEqual(['first', 'second'])
  })

  it('appends live events from the subscribed task', async () => {
    vi.mocked(getAgentTranscriptEvents).mockResolvedValue([])

    await useAgentTranscriptStore.getState().subscribe('task-1')
    liveHandlers.get('task-1')?.(event({ id: 'live-1', content: 'live' }))

    const state = useAgentTranscriptStore.getState().getTaskState('task-1')
    expect(onAgentTranscriptEvent).toHaveBeenCalledWith('task-1', expect.any(Function))
    expect(state.events).toHaveLength(1)
    expect(state.events[0]?.content).toBe('live')
  })

  it('dedupes persisted and live events by id', async () => {
    const same = event({ id: 'same', content: 'same' })
    vi.mocked(getAgentTranscriptEvents).mockResolvedValue([same])

    await useAgentTranscriptStore.getState().load('task-1')
    useAgentTranscriptStore.getState().append(same)

    const state = useAgentTranscriptStore.getState().getTaskState('task-1')
    expect(state.events).toHaveLength(1)
  })

  it('ignores late live events after switching tasks', async () => {
    await useAgentTranscriptStore.getState().subscribe('task-1')
    await useAgentTranscriptStore.getState().subscribe('task-2')

    liveHandlers.get('task-1')?.(event({ id: 'old', taskId: 'task-1' }))
    liveHandlers.get('task-2')?.(event({ id: 'new', taskId: 'task-2' }))

    expect(useAgentTranscriptStore.getState().getTaskState('task-1').events).toHaveLength(0)
    expect(useAgentTranscriptStore.getState().getTaskState('task-2').events).toHaveLength(1)
    expect(unlistenMock).toHaveBeenCalled()
  })
})
