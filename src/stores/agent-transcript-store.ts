import { create } from 'zustand'
import { getAgentTranscriptEvents, onAgentTranscriptEvent, type UnlistenFn } from '@/lib/ipc'
import type { AgentTranscriptEvent } from '@/types/events'

type TaskTranscriptState = {
  events: AgentTranscriptEvent[]
  isLoading: boolean
  error: string | null
}

type AgentTranscriptStore = {
  transcripts: Map<string, TaskTranscriptState>
  activeTaskId: string | null
  loadRequestId: number
  unlisten: UnlistenFn | null
  getTaskState: (taskId: string) => TaskTranscriptState
  load: (taskId: string) => Promise<void>
  append: (event: AgentTranscriptEvent) => void
  subscribe: (taskId: string) => Promise<void>
  unsubscribe: () => void
  reset: () => void
}

const EMPTY_TASK_STATE: TaskTranscriptState = {
  events: [],
  isLoading: false,
  error: null,
}

function sortAndDedupe(events: AgentTranscriptEvent[]): AgentTranscriptEvent[] {
  const byId = new Map<string, AgentTranscriptEvent>()
  for (const event of events) {
    byId.set(event.id, event)
  }
  return [...byId.values()].sort((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence
    return a.createdAt.localeCompare(b.createdAt)
  })
}

function getExisting(transcripts: Map<string, TaskTranscriptState>, taskId: string): TaskTranscriptState {
  return transcripts.get(taskId) ?? EMPTY_TASK_STATE
}

export const useAgentTranscriptStore = create<AgentTranscriptStore>((set, get) => ({
  transcripts: new Map(),
  activeTaskId: null,
  loadRequestId: 0,
  unlisten: null,

  getTaskState: (taskId) => get().transcripts.get(taskId) ?? EMPTY_TASK_STATE,

  load: async (taskId) => {
    const requestId = get().loadRequestId + 1
    set((state) => {
      const transcripts = new Map(state.transcripts)
      const current = getExisting(transcripts, taskId)
      transcripts.set(taskId, { ...current, isLoading: true, error: null })
      return { transcripts, loadRequestId: requestId }
    })

    try {
      const persisted = await getAgentTranscriptEvents(taskId)
      if (get().loadRequestId !== requestId) return
      set((state) => {
        const transcripts = new Map(state.transcripts)
        const current = getExisting(transcripts, taskId)
        transcripts.set(taskId, {
          events: sortAndDedupe([...current.events, ...persisted]),
          isLoading: false,
          error: null,
        })
        return { transcripts }
      })
    } catch (err) {
      if (get().loadRequestId !== requestId) return
      set((state) => {
        const transcripts = new Map(state.transcripts)
        const current = getExisting(transcripts, taskId)
        transcripts.set(taskId, {
          ...current,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to load transcript',
        })
        return { transcripts }
      })
    }
  },

  append: (event) => {
    set((state) => {
      const transcripts = new Map(state.transcripts)
      const current = getExisting(transcripts, event.taskId)
      transcripts.set(event.taskId, {
        ...current,
        events: sortAndDedupe([...current.events, event]),
      })
      return { transcripts }
    })
  },

  subscribe: async (taskId) => {
    const existing = get().unlisten
    if (existing) existing()
    set({ activeTaskId: taskId, unlisten: null })

    const unlisten = await onAgentTranscriptEvent(taskId, (event) => {
      if (get().activeTaskId !== taskId) return
      get().append(event)
    })

    if (get().activeTaskId !== taskId) {
      unlisten()
      return
    }
    set({ unlisten })
  },

  unsubscribe: () => {
    const unlisten = get().unlisten
    if (unlisten) unlisten()
    set({ activeTaskId: null, unlisten: null })
  },

  reset: () => {
    const unlisten = get().unlisten
    if (unlisten) unlisten()
    set({
      transcripts: new Map(),
      activeTaskId: null,
      loadRequestId: 0,
      unlisten: null,
    })
  },
}))
