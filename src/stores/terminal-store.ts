import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

type TerminalInstance = {
  taskId: string
  alive: boolean
}

type TerminalState = {
  activeTaskId: string | null
  instances: Map<string, TerminalInstance>

  setActive: (taskId: string | null) => void
  register: (taskId: string) => void
  unregister: (taskId: string) => void
  setAlive: (taskId: string, alive: boolean) => void
  isAlive: (taskId: string) => boolean
}

export const useTerminalStore = create<TerminalState>()(
  devtools(
    (set, get) => ({
      activeTaskId: null,
      instances: new Map(),

      setActive: (taskId) => {
        set({ activeTaskId: taskId })
      },

      register: (taskId) => {
        set((s) => {
          const next = new Map(s.instances)
          next.set(taskId, { taskId, alive: true })
          return { instances: next }
        })
      },

      unregister: (taskId) => {
        set((s) => {
          const next = new Map(s.instances)
          next.delete(taskId)
          return {
            instances: next,
            activeTaskId: s.activeTaskId === taskId ? null : s.activeTaskId,
          }
        })
      },

      setAlive: (taskId, alive) => {
        set((s) => {
          const next = new Map(s.instances)
          const inst = next.get(taskId)
          if (inst) next.set(taskId, { ...inst, alive })
          return { instances: next }
        })
      },

      isAlive: (taskId) => {
        return get().instances.get(taskId)?.alive ?? false
      },
    }),
    { name: 'terminal-store' },
  ),
)
