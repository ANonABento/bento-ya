import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { invoke } from '@tauri-apps/api/core'

type ChatInputProps = {
  workspaceId: string
}

export function ChatInput({ workspaceId }: ChatInputProps) {
  const [message, setMessage] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = useCallback(async () => {
    if (!message.trim() || isProcessing) return

    setIsProcessing(true)
    try {
      await invoke('send_orchestrator_message', {
        workspaceId,
        message: message.trim(),
      })
      setMessage('')
      // In a real implementation, this would trigger the LLM call
      // and process the response to create tasks
    } catch (err) {
      console.error('Failed to send message:', err)
    } finally {
      setIsProcessing(false)
    }
  }, [message, workspaceId, isProcessing])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
      if (e.key === 'Escape') {
        setIsExpanded(false)
        inputRef.current?.blur()
      }
    },
    [handleSubmit]
  )

  // Focus input when expanded
  useEffect(() => {
    if (isExpanded) {
      inputRef.current?.focus()
    }
  }, [isExpanded])

  return (
    <div className="relative">
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-border-default bg-surface p-3 shadow-lg"
          >
            <p className="mb-2 text-xs text-text-secondary">
              Describe what you want to do and I'll create tasks for you.
            </p>
            <textarea
              ref={inputRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g., Fix the login bug and add tests"
              rows={3}
              className="w-full resize-none rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-between">
              <button
                onClick={() => setIsExpanded(false)}
                className="text-xs text-text-secondary hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!message.trim() || isProcessing}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-bg disabled:opacity-50"
              >
                {isProcessing ? 'Processing...' : 'Create Tasks'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => setIsExpanded(!isExpanded)}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className={`flex w-full items-center gap-2 rounded-xl border bg-surface px-4 py-3 text-left text-sm transition-colors ${
          isExpanded
            ? 'border-accent text-text-primary'
            : 'border-border-default text-text-secondary hover:border-accent/50'
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-4 w-4 text-accent"
        >
          <path
            fillRule="evenodd"
            d="M8 2.75a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2.75Z"
            clipRule="evenodd"
          />
        </svg>
        <span>Ask me to create tasks...</span>
      </motion.button>
    </div>
  )
}
