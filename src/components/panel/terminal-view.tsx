/**
 * Terminal View — renders agent PTY output with a raw/structured toggle.
 *
 * - "Structured" mode parses the output stream for Claude CLI patterns
 *   (tool calls, code blocks, errors, thinking) and renders them visually.
 * - "Raw" mode renders the full xterm.js terminal for interactive sessions.
 *
 * Defaults to structured view. Falls back to raw if parsing produces no blocks.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { listen, type UnlistenFn } from '@/lib/ipc/invoke'
import { EventChannels, type PtyOutputPayload, type PtyExitPayload } from '@/types/events'
import { getXtermTheme } from '@/lib/xterm-theme'
import { getTheme } from '@/lib/theme'
import { AgentOutput } from './agent-output'

type ViewMode = 'structured' | 'raw'

type TerminalViewProps = {
  taskId: string
}

export function TerminalView({ taskId }: TerminalViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('structured')
  const [rawText, setRawText] = useState('')
  const [isAlive, setIsAlive] = useState(true)
  const [exitCode, setExitCode] = useState<number | null>(null)

  // xterm refs
  const termRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  const theme = getTheme()

  // Accumulate raw text from PTY output for structured view
  const handlePtyData = useCallback((data: Uint8Array) => {
    const text = new TextDecoder().decode(data)
    setRawText((prev) => prev + text)
  }, [])

  // Listen to PTY events
  useEffect(() => {
    const unlisteners: Promise<UnlistenFn>[] = []

    unlisteners.push(
      listen<PtyOutputPayload>(EventChannels.ptyOutput(taskId), (payload) => {
        const bytes = new Uint8Array(payload.data)
        handlePtyData(bytes)

        // Also write to xterm if it exists
        if (terminalRef.current) {
          terminalRef.current.write(bytes)
        }
      })
    )

    unlisteners.push(
      listen<PtyExitPayload>(EventChannels.ptyExit(taskId), (payload) => {
        setIsAlive(false)
        setExitCode(payload.exit_code)
      })
    )

    return () => {
      void Promise.all(unlisteners).then((fns) => {
        fns.forEach((fn) => { fn() })
      })
    }
  }, [taskId, handlePtyData])

  // Update cursor blink without recreating the terminal when the process exits
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.cursorBlink = isAlive
    }
  }, [isAlive])

  // Initialize xterm when switching to raw mode
  useEffect(() => {
    if (viewMode !== 'raw' || !termRef.current) return

    const terminal = new Terminal({
      fontSize: 13,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Mono", monospace',
      theme: getXtermTheme(theme),
      cursorBlink: true,
      scrollback: 5000,
      convertEol: true,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(termRef.current)
    fitAddon.fit()

    // Write existing buffered output
    if (rawText) {
      terminal.write(rawText)
    }

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit() } catch { /* container not visible */ }
    })
    resizeObserver.observe(termRef.current)

    return () => {
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  // rawText and isAlive intentionally excluded — written incrementally via listener,
  // and cursor blink updated via separate effect above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, theme])

  return (
    <div className="flex h-full flex-col">
      {/* Header with view mode toggle */}
      <div className="flex items-center justify-between border-b border-border-default px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-primary">Terminal</span>
          {!isAlive && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              exitCode === 0
                ? 'bg-green-500/10 text-green-400'
                : 'bg-red-500/10 text-red-400'
            }`}>
              {exitCode === 0 ? 'Done' : `Exit ${String(exitCode ?? '?')}`}
            </span>
          )}
        </div>

        {/* View mode toggle */}
        <div className="flex items-center rounded-md border border-border-default bg-surface text-[10px]">
          <button
            type="button"
            onClick={() => { setViewMode('structured') }}
            className={`px-2 py-0.5 rounded-l-md transition-colors ${
              viewMode === 'structured'
                ? 'bg-accent/10 text-accent font-medium'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Structured
          </button>
          <button
            type="button"
            onClick={() => { setViewMode('raw') }}
            className={`px-2 py-0.5 rounded-r-md transition-colors ${
              viewMode === 'raw'
                ? 'bg-accent/10 text-accent font-medium'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Raw
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'structured' ? (
          <div className="h-full overflow-y-auto">
            <AgentOutput rawOutput={rawText} />
          </div>
        ) : (
          <div ref={termRef} className="h-full w-full" />
        )}
      </div>
    </div>
  )
}
