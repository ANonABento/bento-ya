/**
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
            .then(() => { resolve() })
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
          void resizePty(taskId, term.cols, term.rows)
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
