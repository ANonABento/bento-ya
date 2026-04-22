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
import { EventChannels, type PtyOutputPayload, type PtyExitPayload } from '@/types/events'
import { getXtermTheme } from '@/lib/xterm-theme'
import { getTheme } from '@/lib/theme'

type TerminalViewProps = {
  taskId: string
  workingDir: string
}

function decodeBase64ToBytes(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function writeTerminalChunk(term: Terminal, data: string, fallbackToRaw = true) {
  try {
    term.write(decodeBase64ToBytes(data))
  } catch {
    if (fallbackToRaw) {
      term.write(data)
    }
  }
}

export function TerminalView({ taskId, workingDir }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false

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

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const unicode11 = new Unicode11Addon()

    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    term.loadAddon(unicode11)
    term.unicode.activeVersion = '11'
    term.open(container)

    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
      })
      term.loadAddon(webgl)
    } catch {
      // Canvas renderer fallback is fine.
    }

    fitAddon.fit()

    const dataDisposable = term.onData((data) => {
      void writeToPty(taskId, data)
    })

    const binaryDisposable = term.onBinary((data) => {
      void writeToPty(taskId, data)
    })

    const listenerPromises: Promise<UnlistenFn>[] = []

    listenerPromises.push(
      listen<PtyOutputPayload>(EventChannels.ptyOutput(taskId), (payload) => {
        if (disposed) return
        writeTerminalChunk(term, payload.data)
      }),
    )

    listenerPromises.push(
      listen<PtyExitPayload>(EventChannels.ptyExit(taskId), (payload) => {
        if (disposed) return
        const code = String(payload.exit_code ?? 0)
        term.write(`\r\n\x1b[90m--- Process exited (code ${code}) ---\x1b[0m\r\n`)
      }),
    )

    void Promise.all(listenerPromises).then(() => {
      if (disposed) return
      return new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          if (disposed) {
            resolve()
            return
          }

          try {
            fitAddon.fit()
          } catch {
            // Ignore fit failures while layout is stabilizing.
          }

          const cols = Math.max(term.cols, 80)
          const rows = Math.max(term.rows, 24)

          ensurePtySession(taskId, workingDir, cols, rows)
            .then((info) => {
              if (info.scrollback) {
                writeTerminalChunk(term, info.scrollback, false)
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

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (disposed) return
        try {
          fitAddon.fit()
          if (term.cols > 0 && term.rows > 0) {
            void resizePty(taskId, term.cols, term.rows)
          }
        } catch {
          // fit() can throw if the panel is collapsed.
        }
      })
    })
    resizeObserver.observe(container)

    const themeObserver = new MutationObserver(() => {
      if (disposed) return
      term.options.theme = getXtermTheme(getTheme())
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    return () => {
      disposed = true
      dataDisposable.dispose()
      binaryDisposable.dispose()
      resizeObserver.disconnect()
      themeObserver.disconnect()
      void Promise.all(listenerPromises).then((unlisteners) => {
        for (const unlisten of unlisteners) {
          unlisten()
        }
      })
      term.dispose()
    }
  }, [taskId, workingDir])

  return (
    <div className="flex h-full flex-col">
      <div ref={containerRef} className="min-h-0 flex-1" style={{ padding: '4px 0 4px 4px' }} />
    </div>
  )
}
