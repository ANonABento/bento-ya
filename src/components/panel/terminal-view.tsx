/**
 * Terminal View — Embedded xterm.js terminal backed by a lazy PTY session.
 * On mount: attaches to a PTY session, optionally spawning a bare shell.
 * Listens for pty:{taskId}:output events and renders raw terminal output.
 * Sends user input via write_to_pty, resizes via resize_pty.
 */

import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'

import { listen, type UnlistenFn } from '@/lib/ipc'
import { writeToPty, resizePty, ensurePtySession, type EnsureSessionFn } from '@/lib/ipc/terminal'
import { EventChannels, type PtyExitPayload } from '@/types/events'
import { getXtermTheme } from '@/lib/xterm-theme'
import { getTheme } from '@/lib/theme'
import { EmptyState } from '@/components/shared/empty-state'
import { useSettingsStore } from '@/stores/settings-store'

type TerminalViewProps = {
  /** Session key — a task id, or a `chef_<workspaceId>` key. Drives the
   *  generic PTY IPC and the `pty:<taskId>:*` event channels. */
  taskId: string
  workingDir: string
  allowSpawn?: boolean
  /** How to spawn/attach the session. Defaults to the per-task PTY command;
   *  the chef terminal passes a workspace-keyed variant. */
  ensure?: EnsureSessionFn
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)

export function TerminalView({ taskId, workingDir, allowSpawn = true, ensure = ensurePtySession }: TerminalViewProps) {
  const terminalHostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const shouldStickToBottomRef = useRef(true)
  const [hasOutput, setHasOutput] = useState(false)
  const [missingSession, setMissingSession] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const runSearch = (query: string, direction: 'next' | 'prev', incremental = false) => {
    const addon = searchAddonRef.current
    if (!addon || !query) return
    const opts = { incremental, caseSensitive: false }
    if (direction === 'next') addon.findNext(query, opts)
    else addon.findPrevious(query, opts)
  }

  const closeSearch = () => {
    setSearchOpen(false)
    setSearchQuery('')
    searchAddonRef.current?.clearDecorations()
    termRef.current?.clearSelection()
    termRef.current?.focus()
  }
  const terminalSettings = useSettingsStore((s) => s.global.terminal)
  const fontSize = sanitizeNumber(terminalSettings.fontSize, 12, 10, 24)
  const lineHeight = lineHeightRatio(terminalSettings.lineHeight, fontSize)
  const scrollback = sanitizeNumber(terminalSettings.scrollbackLines, 5000, 1000, 50000)

  useEffect(() => {
    const container = terminalHostRef.current
    if (!container) return

    // Reset empty-state flag when (re)mounting for a new task
    setHasOutput(false)
    setMissingSession(false)

    let disposed = false

    // Create terminal
    const term = new Terminal({
      theme: getXtermTheme(getTheme()),
      fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", "Fira Code", Menlo, monospace',
      fontSize,
      lineHeight,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback,
      convertEol: false,
      allowProposedApi: true,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      scrollOnUserInput: true,
    })

    // Addons
    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const unicode11 = new Unicode11Addon()

    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    term.loadAddon(unicode11)
    term.unicode.activeVersion = '11'
    termRef.current = term
    fitAddonRef.current = fitAddon
    searchAddonRef.current = searchAddon

    // Standard terminal-emulator shortcuts. On macOS the Cmd modifier is free
    // (Ctrl+C stays SIGINT); elsewhere we use Ctrl+Shift so a bare Ctrl+C still
    // interrupts. Returning false stops xterm forwarding the key to the PTY.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey
      if (!mod) return true
      const key = e.key.toLowerCase()
      if (key === 'f') {
        setSearchOpen(true)
        return false
      }
      if (key === 'c') {
        // Copy the selection if there is one; otherwise let it through (so a
        // bare macOS Cmd+C with no selection is a harmless no-op, and Ctrl+C
        // SIGINT on Linux never reaches here since we require Shift).
        const selection = term.getSelection()
        if (selection) {
          void navigator.clipboard.writeText(selection)
          return false
        }
        return true
      }
      if (key === 'v') {
        void navigator.clipboard
          .readText()
          .then((text) => { if (text && !disposed) void writeToPty(taskId, text) })
          .catch(() => { /* clipboard read unavailable — native paste still covers Cmd+V */ })
        return false
      }
      if (key === 'k') {
        term.clear()
        return false
      }
      return true
    })

    // Open terminal into DOM
    term.open(container)
    shouldStickToBottomRef.current = true
    const viewport = container.querySelector<HTMLElement>('.xterm-viewport')
    const syncStickToBottom = () => {
      if (!viewport) {
        shouldStickToBottomRef.current = isAtTerminalBottom(term)
        return
      }
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      shouldStickToBottomRef.current = distanceFromBottom < 4
    }
    const handleViewportWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        shouldStickToBottomRef.current = false
        return
      }
      requestAnimationFrame(syncStickToBottom)
    }
    viewport?.addEventListener('scroll', syncStickToBottom, { passive: true })
    viewport?.addEventListener('wheel', handleViewportWheel, { passive: true })

    const fitAndResize = () => {
      if (disposed) return
      try {
        fitAddon.fit()
        if (term.rows > 0) {
          term.refresh(0, term.rows - 1)
        }
        if (term.cols > 0 && term.rows > 0) {
          void resizePty(taskId, term.cols, term.rows)
        }
      } catch {
        // fit() can throw if container has zero dimensions
      }
    }

    const scheduleFit = (delay = 0) => {
      const run = () => {
        if (disposed) return
        const requestFrame = Reflect.get(window, 'requestAnimationFrame') as
          | ((callback: FrameRequestCallback) => number)
          | undefined
        const raf = requestFrame ?? ((callback: FrameRequestCallback) => {
          return window.setTimeout(() => { callback(performance.now()) }, 0)
        })
        raf(() => {
          if (!disposed) fitAndResize()
        })
      }
      if (delay <= 0) {
        run()
        return undefined
      }
      return window.setTimeout(run, delay)
    }

    fitAndResize()
    const fitTimers = [
      scheduleFit(50),
      scheduleFit(250),
      scheduleFit(750),
      scheduleFit(1500),
    ].filter((timer): timer is number => typeof timer === 'number')
    const fonts = Reflect.get(document, 'fonts') as { ready?: Promise<unknown> } | undefined
    if (fonts?.ready) {
      void fonts.ready.then(() => { scheduleFit() })
    }

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
        setHasOutput(true)
        // data is a base64-encoded string emitted directly from bridge.rs
        try {
          const binary = atob(data)
          const bytes = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i)
          }
          writePreservingScroll(term, bytes, shouldStickToBottomRef.current)
        } catch {
          // Fallback: write as plain text if not valid base64
          writePreservingScroll(term, data, shouldStickToBottomRef.current)
        }
      }),
    )

    listenerPromises.push(
      listen<PtyExitPayload>(EventChannels.ptyExit(taskId), (payload) => {
        if (disposed) return
        const code = String(payload.exitCode ?? 0)
        term.write(`\r\n\x1b[90m--- Process exited (code ${code}) ---\x1b[0m\r\n`)
      }),
    )

    // Wait for listeners to be registered, then wait a frame for layout,
    // THEN spawn PTY session with accurate dimensions.
    //
    // IMPORTANT: every async hop in this chain (Promise.all, requestAnimationFrame,
    // ensurePtySession.then, .catch) must short-circuit on `disposed`. If the
    // user switches tasks before this resolves, the OLD effect's promise can
    // otherwise write the OLD task's scrollback into a disposed-but-not-yet-
    // garbage-collected xterm — or worse, into a re-entered version of this
    // component if React reuses the DOM node. The `disposed` guard is the
    // single source of truth.
    void Promise.all(listenerPromises).then(() => {
      if (disposed) return
      return new Promise<void>((resolve) => {
        // Wait for the container to have real dimensions (panel animation)
        requestAnimationFrame(() => {
          if (disposed) { resolve(); return }
          fitAndResize()
          // Ensure minimum sensible dimensions
          const cols = Math.max(term.cols, 80)
          const rows = Math.max(term.rows, 24)
          void resizePty(taskId, cols, rows)
          ensure(taskId, workingDir, cols, rows, allowSpawn)
            .then((info) => {
              // Re-check `disposed` AFTER the await: a fast task-switch can
              // tear down this effect while ensure_pty_session is in flight.
              // Without this guard, scrollback for the old task could be
              // written into a disposed term (harmless) or — worse — observed
              // by the user as stale content during a brief window before
              // the new task's effect starts.
              if (disposed) { resolve(); return }
              if (info.status === 'Missing') {
                setMissingSession(true)
              }
              // Restore cached scrollback from previous session
              if (info.scrollback) {
                try {
                  const binary = atob(info.scrollback)
                  const bytes = new Uint8Array(binary.length)
                  for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i)
                  }
                  writePreservingScroll(term, bytes, shouldStickToBottomRef.current)
                  if (bytes.length > 0) setHasOutput(true)
                  scheduleFit()
                  scheduleFit(150)
                } catch { /* ignore decode errors */ }
              }
              resolve()
            })
            .catch((err: unknown) => {
              if (!disposed) {
                if (allowSpawn) {
                  const msg = err instanceof Error ? err.message : String(err)
                  term.write(`\x1b[31mFailed to start terminal: ${msg}\x1b[0m\r\n`)
                } else {
                  setMissingSession(true)
                }
              }
              resolve()
            })
        })
      })
    })

    // Observe container resize
    const resizeObserver = new ResizeObserver(() => {
      scheduleFit()
      scheduleFit(120)
      scheduleFit(320)
    })
    resizeObserver.observe(container)
    let parent: HTMLElement | null = container.parentElement
    while (parent) {
      resizeObserver.observe(parent)
      parent = parent.parentElement
    }

    const handleWindowResize = () => {
      scheduleFit()
      scheduleFit(150)
    }
    window.addEventListener('resize', handleWindowResize)

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        scheduleFit()
        scheduleFit(150)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

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
      fitTimers.forEach((timer) => { window.clearTimeout(timer) })
      dataDisposable.dispose()
      binaryDisposable.dispose()
      viewport?.removeEventListener('scroll', syncStickToBottom)
      viewport?.removeEventListener('wheel', handleViewportWheel)
      window.removeEventListener('resize', handleWindowResize)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      resizeObserver.disconnect()
      themeObserver.disconnect()
      void Promise.all(listenerPromises).then((unlisteners) => {
        for (const unlisten of unlisteners) unlisten()
      })
      term.dispose()
      if (termRef.current === term) termRef.current = null
      if (fitAddonRef.current === fitAddon) fitAddonRef.current = null
      if (searchAddonRef.current === searchAddon) searchAddonRef.current = null
    }
  }, [allowSpawn, ensure, fontSize, lineHeight, scrollback, taskId, workingDir])

  // Reset the search box when switching to a different terminal session.
  useEffect(() => {
    setSearchOpen(false)
    setSearchQuery('')
  }, [taskId])

  // Focus the search input when the box opens.
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  return (
    <div
      data-testid="agent-terminal-view"
      role="region"
      aria-label="Agent terminal"
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-bg"
    >
      {searchOpen && (
        <div
          data-testid="agent-terminal-search"
          className="absolute right-3 top-2 z-10 flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 shadow-lg"
        >
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              runSearch(e.target.value, 'next', true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                runSearch(searchQuery, e.shiftKey ? 'prev' : 'next')
              } else if (e.key === 'Escape') {
                e.preventDefault()
                closeSearch()
              }
            }}
            placeholder="Find"
            aria-label="Search terminal"
            className="w-40 bg-transparent text-xs text-text outline-none placeholder:text-text-secondary/60"
          />
          <button
            type="button"
            onClick={() => { runSearch(searchQuery, 'prev') }}
            aria-label="Previous match"
            className="rounded px-1 text-text-secondary hover:text-text"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => { runSearch(searchQuery, 'next') }}
            aria-label="Next match"
            className="rounded px-1 text-text-secondary hover:text-text"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={closeSearch}
            aria-label="Close search"
            className="rounded px-1 text-text-secondary hover:text-text"
          >
            ✕
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden" style={{ padding: '4px 8px' }}>
        <div ref={terminalHostRef} data-testid="agent-terminal-host" className="agent-terminal-host h-full min-h-0 w-full overflow-hidden" />
      </div>
      {!hasOutput && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg/80 backdrop-blur-sm">
          <div className="pointer-events-auto max-w-sm">
            <EmptyState
              size="md"
              title={missingSession ? 'No live terminal session' : 'Spawning terminal'}
              description={missingSession
                ? 'This task does not currently have a running terminal. Start or resume the agent from Activity to create one.'
                : "A shell is starting in this task's tmux session. Output will appear here as soon as it's ready."}
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
                  <path d="M4 6h16M4 6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2M6 11l3 3-3 3M12 17h6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}

function sanitizeNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value ?? fallback))
}

function lineHeightRatio(lineHeightPx: number | undefined, fontSize: number): number {
  const fallback = Math.round(fontSize * 1.25)
  const maxComfortableLineHeight = Math.round(fontSize * 1.35)
  const lineHeight = sanitizeNumber(lineHeightPx, fallback, fontSize, maxComfortableLineHeight)
  return Math.max(1, Math.min(1.35, lineHeight / fontSize))
}

function isAtTerminalBottom(term: Terminal): boolean {
  const buffer = term.buffer.active
  return buffer.viewportY >= buffer.baseY
}

function writePreservingScroll(term: Terminal, data: string | Uint8Array, shouldStickToBottom: boolean) {
  const shouldScroll = shouldStickToBottom && isAtTerminalBottom(term)
  term.write(data, () => {
    if (shouldScroll) {
      term.scrollToBottom()
    }
  })
}
