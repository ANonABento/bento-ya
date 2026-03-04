import { useState, useRef, useCallback, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ModeSelector } from './mode-selector'
import { ModelSelector } from './model-selector'
import { ThinkingSelector } from './thinking-selector'
import { useSettingsStore } from '@/stores/settings-store'
import { DEFAULT_SETTINGS } from '@/types/settings'

interface TerminalInputProps {
  taskId: string
  agentStatus: 'idle' | 'running' | 'stopped' | 'failed'
  onStop?: () => void
  onForceStop?: () => void
  autoFocus?: boolean
}

export function TerminalInput({
  taskId,
  agentStatus,
  onStop,
  onForceStop,
  autoFocus = false,
}: TerminalInputProps) {
  const [input, setInput] = useState('')
  const [stopping, setStopping] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const terminalSettings = useSettingsStore((s) => s.global.terminal) ?? DEFAULT_SETTINGS.terminal
  const { maxInputRows, lineHeight } = terminalSettings

  // Auto-focus when requested
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [autoFocus])

  // Reset stopping state when agent status changes
  useEffect(() => {
    if (agentStatus !== 'running') {
      setStopping(false)
    }
  }, [agentStatus])

  const send = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed) return

    await invoke('write_to_pty', {
      taskId,
      data: trimmed + '\n',
    })

    setInput('')

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = `${lineHeight}px`
    }
  }, [input, taskId])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        send()
      }
    },
    [send],
  )

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)

    // Auto-grow textarea
    const el = e.target
    el.style.height = `${lineHeight}px`
    const maxHeight = lineHeight * maxInputRows
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }, [lineHeight, maxInputRows])

  const handleStop = useCallback(() => {
    if (stopping) {
      onForceStop?.()
      setStopping(false)
    } else {
      onStop?.()
      setStopping(true)
    }
  }, [stopping, onStop, onForceStop])

  const isRunning = agentStatus === 'running'
  const canSend = input.trim().length > 0

  return (
    <div className="border-t border-border-default bg-bg-secondary px-3 py-2">
      {/* Selector row */}
      <div className="mb-2 flex items-center gap-1">
        <ModeSelector />
        <ModelSelector />
        <ThinkingSelector />

        <div className="flex-1" />

        {/* Mic placeholder */}
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded p-1 text-text-muted opacity-30"
          title="Voice input coming in v0.3"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
            <rect x="5" y="1" width="4" height="7" rx="2" />
            <path d="M3 6.5a4 4 0 008 0M7 10.5V13" />
          </svg>
        </button>

        {/* Attach placeholder */}
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded p-1 text-text-muted opacity-30"
          title="File attachment coming in v0.2"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M7.5 3.5L4 7a2.12 2.12 0 003 3l4.5-4.5a3 3 0 00-4.24-4.24L2.75 5.75a4.24 4.24 0 006 6L12.25 8" />
          </svg>
        </button>
      </div>

      {/* Input row */}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Message agent... (Cmd+Enter to send)"
          rows={1}
          className="flex-1 resize-none rounded border border-border-default bg-bg-primary px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          style={{ height: `${lineHeight}px`, lineHeight: `${lineHeight}px` }}
        />

        {isRunning && (
          <button
            type="button"
            onClick={handleStop}
            className={`rounded px-3 py-2 text-xs font-medium ${
              stopping
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-bg-tertiary text-text-secondary hover:bg-red-900/30 hover:text-red-400'
            }`}
          >
            {stopping ? 'Force Stop' : 'Stop'}
          </button>
        )}

        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          className="rounded bg-accent px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-30"
        >
          Send
        </button>
      </div>
    </div>
  )
}
