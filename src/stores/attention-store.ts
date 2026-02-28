import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

export type AttentionReason = 'question' | 'error' | 'timeout' | 'needs_input' | 'blocked'

export type AttentionItem = {
  taskId: string
  workspaceId: string
  reason: AttentionReason
  message?: string
  createdAt: string
  viewed: boolean
}

type AttentionState = {
  items: AttentionItem[]
  soundEnabled: boolean

  // Actions
  addAttention: (taskId: string, workspaceId: string, reason: AttentionReason, message?: string) => void
  clearAttention: (taskId: string) => void
  markViewed: (taskId: string) => void
  getByWorkspace: (workspaceId: string) => AttentionItem[]
  getUnviewedCount: (workspaceId: string) => number
  hasAttention: (taskId: string) => boolean
  getAttention: (taskId: string) => AttentionItem | undefined
  setSoundEnabled: (enabled: boolean) => void
}

export const useAttentionStore = create<AttentionState>()(
  devtools(
    persist(
      (set, get) => ({
        items: [],
        soundEnabled: true,

        addAttention: (taskId, workspaceId, reason, message) => {
          const existing = get().items.find((i) => i.taskId === taskId)
          if (existing) {
            // Update existing attention
            set((s) => ({
              items: s.items.map((i) =>
                i.taskId === taskId
                  ? { ...i, reason, message, createdAt: new Date().toISOString(), viewed: false }
                  : i
              ),
            }))
          } else {
            // Add new attention
            set((s) => ({
              items: [
                ...s.items,
                {
                  taskId,
                  workspaceId,
                  reason,
                  message,
                  createdAt: new Date().toISOString(),
                  viewed: false,
                },
              ],
            }))
          }

          // Play sound if enabled
          if (get().soundEnabled) {
            // Create a subtle notification sound
            try {
              const audioContext = new AudioContext()
              const oscillator = audioContext.createOscillator()
              const gain = audioContext.createGain()
              oscillator.connect(gain)
              gain.connect(audioContext.destination)
              oscillator.frequency.value = 440
              oscillator.type = 'sine'
              gain.gain.value = 0.1
              gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2)
              oscillator.start()
              oscillator.stop(audioContext.currentTime + 0.2)
            } catch {
              // Audio not available
            }
          }
        },

        clearAttention: (taskId) => {
          set((s) => ({
            items: s.items.filter((i) => i.taskId !== taskId),
          }))
        },

        markViewed: (taskId) => {
          set((s) => ({
            items: s.items.map((i) =>
              i.taskId === taskId ? { ...i, viewed: true } : i
            ),
          }))
        },

        getByWorkspace: (workspaceId) => {
          return get().items.filter((i) => i.workspaceId === workspaceId)
        },

        getUnviewedCount: (workspaceId) => {
          return get().items.filter(
            (i) => i.workspaceId === workspaceId && !i.viewed
          ).length
        },

        hasAttention: (taskId) => {
          return get().items.some((i) => i.taskId === taskId && !i.viewed)
        },

        getAttention: (taskId) => {
          return get().items.find((i) => i.taskId === taskId)
        },

        setSoundEnabled: (enabled) => {
          set({ soundEnabled: enabled })
        },
      }),
      {
        name: 'attention-store',
        partialize: (state) => ({
          items: state.items,
          soundEnabled: state.soundEnabled,
        }),
      }
    ),
    { name: 'attention-store' }
  )
)

// Helper labels for attention reasons
export const ATTENTION_LABELS: Record<AttentionReason, string> = {
  question: 'Has a question',
  error: 'Error occurred',
  timeout: 'Idle timeout',
  needs_input: 'Needs input',
  blocked: 'Blocked',
}

export const ATTENTION_ICONS: Record<AttentionReason, string> = {
  question: '?',
  error: '!',
  timeout: '⏱',
  needs_input: '✎',
  blocked: '⛔',
}
