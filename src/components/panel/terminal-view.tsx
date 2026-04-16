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
 * Terminal View — Embedded xterm.js terminal backed by a lazy PTY session.
 * On mount: ensures a PTY session exists (bare shell in working dir).
 * Listens for pty:{taskId}:output events and renders raw terminal output.
 * Sends user input via write_to_pty, resizes via resize_pty.
 */

import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'

import { listen, type UnlistenFn } from '@/lib/ipc'
import { writeToPty, resizePty, ensurePtySession } from '@/lib/ipc/terminal'
import { EventChannels, type PtyExitPayload } from '@/types/events'
import { getXtermTheme } from '@/lib/xterm-theme'
import { getTheme } from '@/lib/theme'

type TerminalViewProps = {
  taskId: string
  workingDir: string
}

export function TerminalView({ taskId, workingDir }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false

    // Create terminal
    const term = new Terminal({
      theme: getXtermTheme(getTheme()),
      fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", "Fira Code", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
      allowProposedApi: true,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
    })

    // Addons
    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const unicode11 = new Unicode11Addon()

    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    term.loadAddon(unicode11)
    term.unicode.activeVersion = '11'

    // Open terminal into DOM
    term.open(container)

    // Try WebGL renderer (falls back to canvas if unavailable)
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => { webgl.dispose() })
      term.loadAddon(webgl)
    } catch {
      // WebGL not available, canvas renderer is fine
    }

    fitAddon.fit()

    // User input → PTY
    const dataDisposable = term.onData((data) => {
      void writeToPty(taskId, data)
    })

    // Binary input (paste with special chars)
    const binaryDisposable = term.onBinary((data) => {
      void writeToPty(taskId, data)
    })

    // Listen for PTY output events BEFORE spawning session (avoid race condition)
    const listenerPromises: Promise<UnlistenFn>[] = []

    listenerPromises.push(
      listen<string>(EventChannels.ptyOutput(taskId), (data) => {
        if (disposed) return
        // data is a base64-encoded string emitted directly from bridge.rs
        try {
          const binary = atob(data)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i)
          }
          term.write(bytes)
        } catch {
          // Fallback: write as plain text if not valid base64
          term.write(data)
        }
      }),
    )

    listenerPromises.push(
      listen<PtyExitPayload>(EventChannels.ptyExit(taskId), (payload) => {
        if (disposed) return
        const code = String(payload.exit_code ?? 0)
        term.write(`\r\n\x1b[90m--- Process exited (code ${code}) ---\x1b[0m\r\n`)
      }),
    )

    // Wait for listeners to be registered, then wait a frame for layout,
    // THEN spawn PTY session with accurate dimensions
    void Promise.all(listenerPromises).then(() => {
      if (disposed) return
      return new Promise<void>((resolve) => {
        // Wait for the container to have real dimensions (panel animation)
        requestAnimationFrame(() => {
          if (disposed) { resolve(); return }
          try { fitAddon.fit() } catch { /* ignore */ }
          // Ensure minimum sensible dimensions
          const cols = Math.max(term.cols, 80)
          const rows = Math.max(term.rows, 24)
          ensurePtySession(taskId, workingDir, cols, rows)
            .then((info) => {
              // Restore cached scrollback from previous session
              if (info.scrollback) {
                try {
                  const binary = atob(info.scrollback)
                  const bytes = new Uint8Array(binary.length)
                  for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i)
                  }
                  term.write(bytes)
                } catch { /* ignore decode errors */ }
              }
              resolve()
            })
            .catch((err: unknown) => {
              if (!disposed) {
                const msg = err instanceof Error ? err.message : String(err)
                term.write(`\x1b[31mFailed to start terminal: ${msg}\x1b[0m\r\n`)
              }
              resolve()
            })
        })
      })
    })

    // Observe container resize
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (disposed) return
        try {
          fitAddon.fit()
          if (term.cols > 0 && term.rows > 0) {
            void resizePty(taskId, term.cols, term.rows)
          }
        } catch {
          // fit() can throw if container has zero dimensions
        }
      })
    })
    resizeObserver.observe(container)

    // Theme observer — react to data-theme changes on <html>
    const themeObserver = new MutationObserver(() => {
      if (disposed) return
      term.options.theme = getXtermTheme(getTheme())
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    // Cleanup
    return () => {
      disposed = true
      dataDisposable.dispose()
      binaryDisposable.dispose()
      resizeObserver.disconnect()
      themeObserver.disconnect()
      void Promise.all(listenerPromises).then((unlisteners) => {
        for (const unlisten of unlisteners) unlisten()
      })
      term.dispose()
    }
  }, [taskId, workingDir])

  return (
    <div className="flex h-full flex-col">
      <div
        ref={containerRef}
        className="min-h-0 flex-1"
        style={{ padding: '4px 0 4px 4px' }}
      />
    </div>
  )
}
