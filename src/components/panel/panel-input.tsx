import { useState, useRef, useCallback } from 'react'
import { sendOrchestratorMessage } from '@/lib/ipc'

type PanelInputProps = {
  workspaceId: string
  onMessageSent?: () => void
  disabled?: boolean
}

export function PanelInput({ workspaceId, onMessageSent, disabled = false }: PanelInputProps) {
  const [message, setMessage] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = useCallback(async () => {
    if (!message.trim() || isProcessing || disabled) return

    setIsProcessing(true)
    try {
      await sendOrchestratorMessage(workspaceId, message.trim())
      setMessage('')
      onMessageSent?.()
    } catch (err) {
      console.error('Failed to send message:', err)
    } finally {
      setIsProcessing(false)
    }
  }, [message, workspaceId, isProcessing, disabled, onMessageSent])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void handleSubmit()
      }
    },
    [handleSubmit]
  )

  // Auto-resize textarea
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value)
    // Reset height to auto to properly calculate new height
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
  }

  return (
    <div className="flex items-end gap-2 border-t border-border-default bg-surface p-3">
      <textarea
        ref={inputRef}
        value={message}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Ask me to create tasks..."
        rows={1}
        disabled={disabled || isProcessing}
        className="flex-1 resize-none rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
        style={{ minHeight: '38px', maxHeight: '120px' }}
      />
      <button
        onClick={() => { void handleSubmit() }}
        disabled={!message.trim() || isProcessing || disabled}
        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-accent text-bg transition-colors hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isProcessing ? (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.155.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
          </svg>
        )}
      </button>
    </div>
  )
}
