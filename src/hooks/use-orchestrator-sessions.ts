/**
 * Hook for managing orchestrator chat sessions.
 * Handles session lifecycle: load, create, switch, delete.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  getActiveChatSession,
  createChatSession,
  listChatSessions,
  deleteChatSession,
  resetCliSession,
  type ChatSession,
} from '@/lib/ipc'

export type OrchestratorSessionsState = {
  sessions: ChatSession[]
  activeSession: ChatSession | null
  isLoading: boolean
}

export type OrchestratorSessionsActions = {
  createSession: (title?: string) => Promise<ChatSession>
  switchSession: (session: ChatSession) => void
  deleteSession: (sessionId: string) => Promise<void>
  refreshSessions: () => Promise<void>
  resetSession: () => Promise<void>
}

export function useOrchestratorSessions(
  workspaceId: string
): OrchestratorSessionsState & OrchestratorSessionsActions {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Load active session and sessions list on mount
  useEffect(() => {
    async function loadInitialSession() {
      setIsLoading(true)
      try {
        const session = await getActiveChatSession(workspaceId)
        setActiveSession(session)
        const sessionList = await listChatSessions(workspaceId)
        setSessions(sessionList)
      } catch {
        // Session load failure handled by empty state
      } finally {
        setIsLoading(false)
      }
    }
    void loadInitialSession()
  }, [workspaceId])

  const refreshSessions = useCallback(async () => {
    try {
      const sessionList = await listChatSessions(workspaceId)
      setSessions(sessionList)
    } catch {
      // Refresh failure is non-critical
    }
  }, [workspaceId])

  const createSession = useCallback(
    async (title?: string): Promise<ChatSession> => {
      const session = await createChatSession(workspaceId, title)
      setActiveSession(session)
      await refreshSessions()
      return session
    },
    [workspaceId, refreshSessions]
  )

  const switchSession = useCallback((session: ChatSession) => {
    setActiveSession(session)
  }, [])

  const deleteSession = useCallback(
    async (sessionId: string) => {
      await deleteChatSession(sessionId)

      // If we deleted the active session, switch to another
      if (activeSession?.id === sessionId) {
        const remaining = sessions.filter((s) => s.id !== sessionId)
        const nextSession = remaining[0]
        if (nextSession) {
          setActiveSession(nextSession)
        } else {
          // Create a new session if none left
          await createSession()
        }
      }
      await refreshSessions()
    },
    [activeSession?.id, sessions, refreshSessions, createSession]
  )

  const resetSession = useCallback(async () => {
    if (activeSession) {
      try {
        await resetCliSession(activeSession.id)
      } catch {
        // Reset failure is non-critical
      }
    }
  }, [activeSession])

  return {
    sessions,
    activeSession,
    isLoading,
    createSession,
    switchSession,
    deleteSession,
    refreshSessions,
    resetSession,
  }
}
