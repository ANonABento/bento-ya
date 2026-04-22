import { useCallback, useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { listen, type UnlistenFn } from '@/lib/ipc/invoke'
import { ensurePtySession, resizePty, writeToPty } from '@/lib/ipc/terminal'
import { useThemeStore } from '@/stores/theme-store'
import { getXtermTheme } from '@/lib/xterm-theme'
import { EventChannels, type PtyExitPayload, type PtyOutputPayload } from '@/types/events'
import { AgentOutput } from './agent-output'

type ViewMode = 'structured' | 'raw'

type TerminalViewProps = {
  taskId: string
  workingDir: string
}

function decodeBase64Bytes(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function TerminalView({ taskId, workingDir }: TerminalViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('structured')
  const [rawText, setRawText] = useState('')
  const [isAlive, setIsAlive] = useState(true)
  const [exitCode, setExitCode] = useState<number | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const theme = useThemeStore((s) => s.resolved)

  const appendBytes = useCallback((bytes: Uint8Array) => {
    const text = new TextDecoder().decode(bytes)
    setRawText((prev) => prev + text)

    if (terminalRef.current) {
      terminalRef.current.write(bytes)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const unlisteners: Promise<UnlistenFn>[] = []

    setRawText('')
    setIsAlive(true)
    setExitCode(null)

    unlisteners.push(
      listen<PtyOutputPayload>(EventChannels.ptyOutput(taskId), (payload) => {
        if (cancelled) return
        appendBytes(decodeBase64Bytes(payload.data))
      }),
    )

    unlisteners.push(
      listen<PtyExitPayload>(EventChannels.ptyExit(taskId), (payload) => {
        if (cancelled) return
        setIsAlive(false)
        setExitCode(payload.exit_code)
      }),
    )

    void Promise.all(unlisteners)
      .then(async () => {
        if (cancelled) return

        const info = await ensurePtySession(taskId, workingDir, 80, 24)
        if (cancelled || !info.scrollback) return
        appendBytes(decodeBase64Bytes(info.scrollback))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setRawText((prev) => `${prev}\nFailed to start terminal: ${message}`.trimStart())
        setIsAlive(false)
      })

    return () => {
      cancelled = true
      void Promise.all(unlisteners).then((fns) => {
        fns.forEach((fn) => {
          fn()
        })
      })
    }
  }, [appendBytes, taskId, workingDir])

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.cursorBlink = isAlive
    }
  }, [isAlive])

  useEffect(() => {
    if (!terminalRef.current) return
    terminalRef.current.options.theme = getXtermTheme(theme)
  }, [theme])

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
      convertEol: true,
      allowProposedApi: true,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
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
      // Canvas renderer fallback is fine.
    }

    if (rawText) {
      terminal.write(rawText)
    }

    terminalRef.current = terminal

    const fitAndResize = () => {
      try {
        fitAddon.fit()
        if (terminal.cols > 0 && terminal.rows > 0) {
          void resizePty(taskId, terminal.cols, terminal.rows)
        }
      } catch {
        // Ignore zero-dimension container errors during layout transitions.
      }
    }

    fitAndResize()

    const dataDisposable = terminal.onData((data) => {
      void writeToPty(taskId, data)
    })

    const binaryDisposable = terminal.onBinary((data) => {
      void writeToPty(taskId, data)
    })

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(fitAndResize)
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      dataDisposable.dispose()
      binaryDisposable.dispose()
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
    }
  }, [taskId, theme, viewMode])

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
          <div
            ref={containerRef}
            className="h-full min-h-0 w-full"
            style={{ padding: '4px 0 4px 4px' }}
          />
        )}
      </div>
    </div>
  )
}
