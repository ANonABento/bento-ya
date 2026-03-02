import { motion, AnimatePresence } from 'motion/react'

type PanelSidebarProps = {
  isOpen: boolean
  messageCount?: number
  onNewChat?: () => void
}

export function PanelSidebar({ isOpen, messageCount = 0, onNewChat }: PanelSidebarProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 180, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="flex flex-col border-r border-border-default bg-bg overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
            <span className="text-xs font-medium text-text-secondary">Session</span>
          </div>

          {/* Actions */}
          <div className="p-2 space-y-1">
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

          {/* Session Info */}
          <div className="flex-1 p-3">
            <div className="rounded-md bg-surface p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-secondary">Messages</span>
                <span className="text-xs font-medium text-text-primary">{messageCount}</span>
              </div>
            </div>
          </div>

          {/* Footer hint */}
          <div className="p-3 border-t border-border-default">
            <p className="text-[10px] text-text-secondary/60 leading-relaxed">
              Ask the orchestrator to create, update, or organize your tasks.
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
