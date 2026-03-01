import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { WebglAddon } from '@xterm/addon-webgl'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getXtermTheme } from '@/lib/xterm-theme'
import { useThemeStore } from '@/stores/theme-store'
import '@xterm/xterm/css/xterm.css'

interface TerminalViewProps {
  taskId: string
  isActive: boolean
  onExit?: () => void
}

export function TerminalView({ taskId, isActive, onExit }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const resolvedTheme = useThemeStore((s) => s.resolved)

  const initTerminal = useCallback(async () => {
    if (!containerRef.current || terminalRef.current) return

    const term = new Terminal({
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 14,
      theme: getXtermTheme(resolvedTheme),
      scrollback: 5000,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const unicode11Addon = new Unicode11Addon()

    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    term.loadAddon(unicode11Addon)
    term.unicode.activeVersion = '11'

    term.open(containerRef.current)

    // Try WebGL, fallback to canvas
    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon.dispose()
      })
      term.loadAddon(webglAddon)
    } catch {
      // WebGL not available, canvas renderer is the default
    }

    fitAddon.fit()

    // Subscribe to PTY output
    const unlistenOutput = await listen<string>(`pty:${taskId}:output`, (event) => {
      const decoded = atob(event.payload)
      const bytes = new Uint8Array(decoded.length)
      for (let i = 0; i < decoded.length; i++) {
        bytes[i] = decoded.charCodeAt(i)
      }
      term.write(bytes)
    })

    // Subscribe to PTY exit
    const unlistenExit = await listen(`pty:${taskId}:exit`, () => {
      term.write('\r\n\x1b[90m--- Agent exited ---\x1b[0m\r\n')
      onExit?.()
    })

    // Forward user input to PTY
    const onDataDisposable = term.onData((data) => {
      invoke('write_to_pty', { taskId, data }).catch(() => {
        // PTY may have exited
      })
    })

    // Forward resize events to PTY
    const onResizeDisposable = term.onResize(({ cols, rows }) => {
      invoke('resize_pty', { taskId, cols, rows }).catch(() => {
        // PTY may have exited
      })
    })

    // ResizeObserver for container
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon.fit()
      })
    })
    resizeObserver.observe(containerRef.current)

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    cleanupRef.current = () => {
      unlistenOutput()
      unlistenExit()
      onDataDisposable.dispose()
      onResizeDisposable.dispose()
      resizeObserver.disconnect()
      term.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }

    // Replay scrollback
    try {
      const scrollback = await invoke<string>('get_pty_scrollback', { taskId })
      if (scrollback) {
        const decoded = atob(scrollback)
        const bytes = new Uint8Array(decoded.length)
        for (let i = 0; i < decoded.length; i++) {
          bytes[i] = decoded.charCodeAt(i)
        }
        term.write(bytes)
      }
    } catch {
      // No scrollback available
    }

    // Send initial size to backend
    invoke('resize_pty', {
      taskId,
      cols: term.cols,
      rows: term.rows,
    }).catch(() => {})
  }, [taskId, onExit, resolvedTheme])

  useEffect(() => {
    initTerminal()

    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [initTerminal])

  // Re-fit when becoming active
  useEffect(() => {
    if (isActive && fitAddonRef.current) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit()
      })
    }
  }, [isActive])

  // Focus terminal when active
  useEffect(() => {
    if (isActive && terminalRef.current) {
      terminalRef.current.focus()
    }
  }, [isActive])

  // Update theme when it changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = getXtermTheme(resolvedTheme)
    }
  }, [resolvedTheme])

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-bg"
      style={{ padding: '4px' }}
    />
  )
}
