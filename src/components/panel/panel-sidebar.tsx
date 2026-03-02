import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { ChatSession } from '@/lib/ipc'

type SidebarMode = 'history' | 'files' | null

type PanelSidebarProps = {
  mode: SidebarMode
  sessions: ChatSession[]
  activeSessionId?: string
  workspaceId: string
  onNewChat?: () => void
  onSelectSession?: (session: ChatSession) => void
  onDeleteSession?: (sessionId: string) => void
}

// Different constraints per mode
const SIDEBAR_CONFIG = {
  history: { min: 160, max: 280, default: 200 },
  files: { min: 200, max: 600, default: 280 },
} as const

const STORAGE_KEY = 'chef-sidebar-widths'

function loadWidths(): Record<string, number> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

function saveWidths(widths: Record<string, number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
  } catch {
    // Ignore storage errors
  }
}

export function PanelSidebar({
  mode,
  sessions,
  activeSessionId,
  workspaceId,
  onNewChat,
  onSelectSession,
  onDeleteSession,
}: PanelSidebarProps) {
  // Per-mode widths with persistence
  const [widths, setWidths] = useState<Record<string, number>>(() => loadWidths())
  const [isDragging, setIsDragging] = useState(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  // Get current width for active mode
  const config = mode ? SIDEBAR_CONFIG[mode] : SIDEBAR_CONFIG.history
  const width = mode ? (widths[mode] ?? config.default) : config.default

  // Handle resize drag
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragStartX.current = e.clientX
    dragStartWidth.current = width
    setIsDragging(true)
  }, [width])

  useEffect(() => {
    if (!isDragging || !mode) return

    const currentConfig = SIDEBAR_CONFIG[mode]
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartX.current
      const newWidth = Math.min(currentConfig.max, Math.max(currentConfig.min, dragStartWidth.current + deltaX))
      setWidths(prev => {
        const updated = { ...prev, [mode]: newWidth }
        saveWidths(updated)
        return updated
      })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging, mode])

  return (
    <AnimatePresence>
      {mode !== null && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={isDragging ? { duration: 0 } : { duration: 0.15 }}
          className="relative flex flex-col border-r border-border-default bg-bg overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
            <span className="text-xs font-medium text-text-secondary">
              {mode === 'history' ? 'History' : 'Files'}
            </span>
          </div>

          {/* Content */}
          {mode === 'history' ? (
            <HistoryContent
              sessions={sessions}
              activeSessionId={activeSessionId}
              onNewChat={onNewChat}
              onSelectSession={onSelectSession}
              onDeleteSession={onDeleteSession}
            />
          ) : (
            <FilesContent workspaceId={workspaceId} />
          )}

          {/* Resize handle */}
          <div
            onMouseDown={handleResizeMouseDown}
            className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-accent/30 transition-colors"
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// History sidebar content
function HistoryContent({
  sessions,
  activeSessionId,
  onNewChat,
  onSelectSession,
  onDeleteSession,
}: {
  sessions: ChatSession[]
  activeSessionId?: string
  onNewChat?: () => void
  onSelectSession?: (session: ChatSession) => void
  onDeleteSession?: (sessionId: string) => void
}) {
  return (
    <>
      {/* New Chat Button */}
      <div className="p-2">
        <button
          type="button"
          onClick={onNewChat}
          className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 ? (
          <div className="py-4 text-center">
            <p className="text-xs text-text-secondary/70">No chats yet</p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {sessions.map((session) => (
              <li key={session.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelectSession?.(session)}
                  className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                    session.id === activeSessionId
                      ? 'bg-surface-hover text-text-primary'
                      : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0">
                    <path fillRule="evenodd" d="M1 8.74c0 .983.713 1.825 1.69 1.943.904.108 1.817.19 2.737.243.363.02.688.231.85.556l1.052 2.103a.75.75 0 0 0 1.342 0l1.052-2.103c.162-.325.487-.535.85-.556.92-.053 1.833-.134 2.738-.243.976-.118 1.689-.96 1.689-1.942V4.259c0-.982-.713-1.824-1.69-1.942a44.45 44.45 0 0 0-10.62 0C1.712 2.435 1 3.277 1 4.26v4.482Z" clipRule="evenodd" />
                  </svg>
                  <span className="truncate flex-1">{session.title}</span>
                </button>
                {/* Delete button - shows on hover */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteSession?.(session.id)
                  }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 rounded text-text-secondary hover:text-red-400 hover:bg-red-500/10 transition-all"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                    <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.711Z" clipRule="evenodd" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

// Files sidebar content (placeholder for now)
function FilesContent({ workspaceId: _workspaceId }: { workspaceId: string }) {
  return (
    <div className="flex-1 overflow-y-auto p-2">
      <div className="py-8 text-center">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-8 w-8 mx-auto text-text-secondary/30 mb-2">
          <path d="M3.75 3A1.75 1.75 0 0 0 2 4.75v3.26a3.235 3.235 0 0 1 1.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0 0 16.25 5h-4.836a.25.25 0 0 1-.177-.073L9.823 3.513A1.75 1.75 0 0 0 8.586 3H3.75Z" />
          <path fillRule="evenodd" d="M2 9.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 .75.75v5a1.75 1.75 0 0 1-1.75 1.75H3.75A1.75 1.75 0 0 1 2 14.25v-5Z" clipRule="evenodd" />
        </svg>
        <p className="text-xs text-text-secondary/70">Plans, checklists, and notes</p>
        <p className="text-xs text-text-secondary/50 mt-1">Coming soon</p>
      </div>
    </div>
  )
}
