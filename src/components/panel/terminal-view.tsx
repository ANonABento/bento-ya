import { useState, useEffect, useRef, useCallback } from 'react'
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
import { AgentOutput } from './agent-output'

type ViewMode = 'structured' | 'raw'

type TerminalViewProps = {
  taskId: string
  workingDir: string
}

function decodePtyData(data: string): string {
  try {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new TextDecoder().decode(bytes)
  } catch {
    return data
  }
}

export function TerminalView({ taskId, workingDir }: TerminalViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('structured')
  const [rawText, setRawText] = useState('')
  const [isAlive, setIsAlive] = useState(true)
  const [exitCode, setExitCode] = useState<number | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const rawTextRef = useRef(rawText)
  rawTextRef.current = rawText

  const theme = getTheme()

  const appendOutput = useCallback((nextChunk: string) => {
    setRawText((prev) => prev + nextChunk)
    terminalRef.current?.write(nextChunk)
  }, [])

  useEffect(() => {
    let disposed = false
    const listenerPromises: Promise<UnlistenFn>[] = []

    listenerPromises.push(
      listen<PtyOutputPayload>(EventChannels.ptyOutput(taskId), (payload) => {
        if (disposed) return
        appendOutput(decodePtyData(payload.data))
      }),
    )

    listenerPromises.push(
      listen<PtyExitPayload>(EventChannels.ptyExit(taskId), (payload) => {
        if (disposed) return
        setIsAlive(false)
        setExitCode(payload.exit_code)
        terminalRef.current?.write(
          `\r\n\x1b[90m--- Process exited (code ${String(payload.exit_code ?? 0)}) ---\x1b[0m\r\n`,
        )
      }),
    )

    void Promise.all(listenerPromises).then(() => {
      if (disposed) return
      void ensurePtySession(taskId, workingDir, 80, 24)
        .then((session) => {
          if (disposed || !session.scrollback) return
          appendOutput(decodePtyData(session.scrollback))
        })
        .catch((err: unknown) => {
          if (!disposed) {
            const message = err instanceof Error ? err.message : String(err)
            appendOutput(`\nFailed to start terminal: ${message}\n`)
          }
        })
    })

    return () => {
      disposed = true
      void Promise.all(listenerPromises).then((unlisteners) => {
        for (const unlisten of unlisteners) {
          unlisten()
        }
      })
    }
  }, [appendOutput, taskId, workingDir])

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.cursorBlink = isAlive
    }
  }, [isAlive])

  useEffect(() => {
    if (viewMode !== 'raw' || !containerRef.current) return

    const terminal = new Terminal({
      theme: getXtermTheme(theme),
      fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", "Fira Code", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: isAlive,
      cursorStyle: 'bar',
      scrollback: 10000,
      allowProposedApi: true,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      convertEol: true,
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const unicode11 = new Unicode11Addon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(searchAddon)
    terminal.loadAddon(unicode11)
    terminal.unicode.activeVersion = '11'

    terminal.open(containerRef.current)

    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
      })
      terminal.loadAddon(webgl)
    } catch {
      // Canvas renderer fallback is acceptable.
    }

    try {
      fitAddon.fit()
    } catch {
      // Container may still be animating in.
    }

    if (rawTextRef.current) {
      terminal.write(rawTextRef.current)
    }

    const dataDisposable = terminal.onData((data) => {
      void writeToPty(taskId, data)
    })

    const binaryDisposable = terminal.onBinary((data) => {
      void writeToPty(taskId, data)
    })

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          fitAddon.fit()
          if (terminal.cols > 0 && terminal.rows > 0) {
            void resizePty(taskId, terminal.cols, terminal.rows)
          }
        } catch {
          // Ignore zero-sized containers during transitions.
        }
      })
    })
    resizeObserver.observe(containerRef.current)

    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = getXtermTheme(getTheme())
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    requestAnimationFrame(() => {
      try {
        fitAddon.fit()
        if (terminal.cols > 0 && terminal.rows > 0) {
          void resizePty(taskId, terminal.cols, terminal.rows)
        }
      } catch {
        // Ignore initial zero-sized layout.
      }
    })
    terminalRef.current = terminal

    return () => {
      resizeObserver.disconnect()
      themeObserver.disconnect()
      dataDisposable.dispose()
      binaryDisposable.dispose()
      terminal.dispose()
      terminalRef.current = null
    }
  }, [isAlive, taskId, theme, viewMode])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border-default px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-primary">Terminal</span>
          {!isAlive && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                exitCode === 0 ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
              }`}
            >
              {exitCode === 0 ? 'Done' : `Exit ${String(exitCode ?? '?')}`}
            </span>
          )}
        </div>

        <div className="flex items-center rounded-md border border-border-default bg-surface text-[10px]">
          <button
            type="button"
            onClick={() => {
              setViewMode('structured')
            }}
            className={`rounded-l-md px-2 py-0.5 transition-colors ${
              viewMode === 'structured'
                ? 'bg-accent/10 font-medium text-accent'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Structured
          </button>
          <button
            type="button"
            onClick={() => {
              setViewMode('raw')
            }}
            className={`rounded-r-md px-2 py-0.5 transition-colors ${
              viewMode === 'raw'
                ? 'bg-accent/10 font-medium text-accent'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Raw
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {viewMode === 'structured' ? (
          <div className="h-full overflow-y-auto">
            <AgentOutput rawOutput={rawText} />
          </div>
        ) : (
          <div ref={containerRef} className="h-full w-full" style={{ padding: '4px 0 4px 4px' }} />
        )}
      </div>
    </div>
  )
}
