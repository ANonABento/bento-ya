import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { listen } from '@tauri-apps/api/event'
import { useUIStore } from '@/stores/ui-store'
import { getChatHistory, type ChatMessage, type OrchestratorEvent } from '@/lib/ipc'
import { ChatHistory } from './chat-history'
import { PanelInput } from './panel-input'

type OrchestratorPanelProps = {
  workspaceId: string
}

const COLLAPSED_HEIGHT = 44

export function OrchestratorPanel({ workspaceId }: OrchestratorPanelProps) {
  const panelHeight = useUIStore((s) => s.panelHeight)
  const isPanelCollapsed = useUIStore((s) => s.isPanelCollapsed)
  const setPanelHeight = useUIStore((s) => s.setPanelHeight)
  const togglePanel = useUIStore((s) => s.togglePanel)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragStartY = useRef(0)
  const dragStartHeight = useRef(0)
  const hasDragged = useRef(false)

  // Load chat history on mount
  useEffect(() => {
    async function loadHistory() {
      setIsLoading(true)
      try {
        const history = await getChatHistory(workspaceId, 100)
        setMessages(history)
      } catch (err) {
        console.error('Failed to load chat history:', err)
      } finally {
        setIsLoading(false)
      }
    }
    void loadHistory()
  }, [workspaceId])

  // Listen for orchestrator events
  useEffect(() => {
    const unsubscribes: Array<() => void> = []

    const setupListeners = async () => {
      const unsubProcessing = await listen<OrchestratorEvent>('orchestrator:processing', (event) => {
        if (event.payload.workspaceId === workspaceId) {
          setIsProcessing(true)
        }
      })
      unsubscribes.push(unsubProcessing)

      const unsubComplete = await listen<OrchestratorEvent>('orchestrator:complete', (event) => {
        if (event.payload.workspaceId === workspaceId) {
          setIsProcessing(false)
          // Refresh messages
          void getChatHistory(workspaceId, 100).then(setMessages)
        }
      })
      unsubscribes.push(unsubComplete)

      const unsubError = await listen<OrchestratorEvent>('orchestrator:error', (event) => {
        if (event.payload.workspaceId === workspaceId) {
          setIsProcessing(false)
        }
      })
      unsubscribes.push(unsubError)
    }

    void setupListeners()

    return () => {
      unsubscribes.forEach((unsub) => { unsub() })
    }
  }, [workspaceId])

  // Keyboard shortcut: Cmd+J to toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        togglePanel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePanel])

  // Header click/drag handlers - simplified
  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    // Ignore if clicking on a button
    if ((e.target as HTMLElement).closest('button')) return

    e.preventDefault()
    hasDragged.current = false
    dragStartY.current = e.clientY
    dragStartHeight.current = panelHeight
    setIsDragging(true)
  }, [panelHeight])

  useEffect(() => {
    if (!isDragging) return

    // Set cursor on body during drag
    if (!isPanelCollapsed) {
      document.body.style.cursor = 'ns-resize'
    }
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = dragStartY.current - e.clientY
      if (Math.abs(deltaY) > 3) {
        hasDragged.current = true
        // Only resize if expanded
        if (!isPanelCollapsed) {
          const newHeight = dragStartHeight.current + deltaY
          setPanelHeight(newHeight)
        }
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      // If didn't drag, treat as click to toggle
      if (!hasDragged.current) {
        togglePanel()
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isDragging, isPanelCollapsed, setPanelHeight, togglePanel])

  const handleMessageSent = useCallback(() => {
    // Refresh messages after sending
    void getChatHistory(workspaceId, 100).then(setMessages)
  }, [workspaceId])

  const displayHeight = isPanelCollapsed ? COLLAPSED_HEIGHT : panelHeight

  return (
    <motion.div
      ref={panelRef}
      initial={false}
      animate={{ height: displayHeight }}
      transition={isDragging ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 35 }}
      className="flex flex-col border-t border-border-default bg-surface"
      style={{ minHeight: COLLAPSED_HEIGHT }}
    >
      {/* Header - clickable to toggle, draggable to resize */}
      <div
        onMouseDown={handleHeaderMouseDown}
        onClick={handleHeaderClick}
        className={`flex items-center justify-between px-3 py-2 select-none ${
          !isPanelCollapsed ? 'cursor-drag' : 'cursor-pointer'
        }`}
      >
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4 text-accent"
          >
            <path
              fillRule="evenodd"
              d="M10 2c-2.236 0-4.43.18-6.57.524C1.993 2.755 1 4.014 1 5.426v5.148c0 1.413.993 2.67 2.43 2.902.848.137 1.705.248 2.57.331v3.443a.75.75 0 0 0 1.28.53l3.58-3.579a.78.78 0 0 1 .527-.224 41.202 41.202 0 0 0 5.183-.5c1.437-.232 2.43-1.49 2.43-2.903V5.426c0-1.413-.993-2.67-2.43-2.902A41.289 41.289 0 0 0 10 2Zm0 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM8 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm5 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-sm font-medium text-text-primary">Orchestrator</span>
          {isProcessing && (
            <span className="flex items-center gap-1 text-xs text-accent">
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Thinking...
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-text-secondary">
            {isPanelCollapsed ? 'Cmd+J to expand' : 'Cmd+J'}
          </span>
          <button
            onClick={togglePanel}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className={`h-4 w-4 transition-transform ${isPanelCollapsed ? 'rotate-180' : ''}`}
            >
              <path
                fillRule="evenodd"
                d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Content - only shown when expanded */}
      <AnimatePresence>
        {!isPanelCollapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <ChatHistory messages={messages} isLoading={isLoading} />
            <PanelInput
              workspaceId={workspaceId}
              onMessageSent={handleMessageSent}
              disabled={isProcessing}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
