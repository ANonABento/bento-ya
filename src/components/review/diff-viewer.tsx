import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
  detectLanguage,
  tokenizeCode,
  getCurrentShikiTheme,
  type ShikiTheme,
  type ThemedToken,
} from '@/lib/shiki'

// --- Types ---

interface DiffLine {
  type: 'context' | 'add' | 'remove'
  content: string
  oldLineNumber: number | null
  newLineNumber: number | null
}

interface DiffHunk {
  header: string
  lines: DiffLine[]
}

interface DiffFile {
  oldPath: string
  newPath: string
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

type LineSelection = {
  fileIndex: number
  hunkIndex: number
  lineIndex: number
}

export interface DiffViewerProps {
  /** Raw unified diff string */
  diff: string
  /** Default collapsed state per file (default: false) */
  defaultCollapsed?: boolean
  /** Use denser gutters and headers for the side panel */
  compact?: boolean
  /** Enables line selection and copy/send actions */
  selectable?: boolean
  /** Called with selected diff text or a hunk snippet */
  onSendToAgent?: (content: string) => void
}

// --- Diff Parser ---

const FILE_HEADER_RE = /^diff --git a\/(.+) b\/(.+)$/
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

function parseDiff(raw: string): DiffFile[] {
  const lines = raw.split('\n')
  const files: DiffFile[] = []
  let currentFile: DiffFile | null = null
  let currentHunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    const fileMatch = line.match(FILE_HEADER_RE)
    if (fileMatch) {
      currentFile = {
        oldPath: fileMatch[1] ?? '',
        newPath: fileMatch[2] ?? '',
        additions: 0,
        deletions: 0,
        hunks: [],
      }
      files.push(currentFile)
      currentHunk = null
      continue
    }

    // Skip index and --- / +++ header lines
    if (line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
      continue
    }

    const hunkMatch = line.match(HUNK_HEADER_RE)
    if (hunkMatch && currentFile) {
      oldLine = parseInt(hunkMatch[1] ?? '0', 10)
      newLine = parseInt(hunkMatch[2] ?? '0', 10)
      currentHunk = { header: line, lines: [] }
      currentFile.hunks.push(currentHunk)
      continue
    }

    if (!currentHunk || !currentFile) continue

    if (line.startsWith('+')) {
      currentHunk.lines.push({
        type: 'add',
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber: newLine++,
      })
      currentFile.additions++
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({
        type: 'remove',
        content: line.slice(1),
        oldLineNumber: oldLine++,
        newLineNumber: null,
      })
      currentFile.deletions++
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({
        type: 'context',
        content: line.slice(1),
        oldLineNumber: oldLine++,
        newLineNumber: newLine++,
      })
    }
  }

  return files
}

// --- Helpers ---

const LINE_BG = {
  add: 'color-mix(in srgb, var(--success) 10%, transparent)',
  remove: 'color-mix(in srgb, var(--error) 10%, transparent)',
  context: 'transparent',
} as const

const GUTTER_COLOR = {
  add: 'var(--success)',
  remove: 'var(--error)',
  context: 'var(--text-muted)',
} as const

const SELECTED_LINE_BG = 'color-mix(in srgb, var(--running) 18%, transparent)'
const HUNK_BG = 'color-mix(in srgb, var(--running) 8%, transparent)'

function linePrefix(line: DiffLine) {
  if (line.type === 'add') return '+'
  if (line.type === 'remove') return '-'
  return ' '
}

function formatDiffLine(line: DiffLine) {
  return `${linePrefix(line)}${line.content}`
}

function selectionKey(selection: LineSelection) {
  return `${String(selection.fileIndex)}:${String(selection.hunkIndex)}:${String(selection.lineIndex)}`
}

function getSelectionRange(files: DiffFile[], start: LineSelection, end: LineSelection) {
  const ordered: string[] = []
  let startIndex = -1
  let endIndex = -1
  let cursor = 0

  files.forEach((file, fileIndex) => {
    file.hunks.forEach((hunk, hunkIndex) => {
      hunk.lines.forEach((_, lineIndex) => {
        const key = selectionKey({ fileIndex, hunkIndex, lineIndex })
        ordered.push(key)
        if (
          fileIndex === start.fileIndex &&
          hunkIndex === start.hunkIndex &&
          lineIndex === start.lineIndex
        ) {
          startIndex = cursor
        }
        if (
          fileIndex === end.fileIndex &&
          hunkIndex === end.hunkIndex &&
          lineIndex === end.lineIndex
        ) {
          endIndex = cursor
        }
        cursor++
      })
    })
  })

  if (startIndex === -1 || endIndex === -1) return []
  const from = Math.min(startIndex, endIndex)
  const to = Math.max(startIndex, endIndex)
  return ordered.slice(from, to + 1)
}

function getSelectedText(files: DiffFile[], selectedLineKeys: Set<string>) {
  const chunks: string[] = []

  files.forEach((file, fileIndex) => {
    const fileLines: string[] = []
    file.hunks.forEach((hunk, hunkIndex) => {
      const hunkLines = hunk.lines.filter((_, lineIndex) =>
        selectedLineKeys.has(selectionKey({ fileIndex, hunkIndex, lineIndex }))
      )
      if (hunkLines.length > 0) {
        fileLines.push(hunk.header, ...hunkLines.map(formatDiffLine))
      }
    })
    if (fileLines.length > 0) {
      chunks.push(`diff --git a/${file.oldPath} b/${file.newPath}`, ...fileLines)
    }
  })

  return chunks.join('\n')
}

function getHunkText(file: DiffFile, hunk: DiffHunk) {
  return [
    `diff --git a/${file.oldPath} b/${file.newPath}`,
    hunk.header,
    ...hunk.lines.map(formatDiffLine),
  ].join('\n')
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text)
}

// --- Components ---

function ActionButton({
  children,
  onClick,
  title,
  disabled = false,
}: {
  children: ReactNode
  onClick: () => void
  title?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      disabled={disabled}
      title={title}
      data-diff-action="true"
      style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
      className="rounded border border-border-default/80 bg-surface px-1.5 py-0.5 text-xs font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
    >
      {children}
    </button>
  )
}

function TokenizedLine({ tokens }: { tokens: ThemedToken[] }) {
  return (
    <>
      {tokens.map((token, i) => (
        <span key={i} style={{ color: token.color }}>
          {token.content}
        </span>
      ))}
    </>
  )
}

function DiffLineRow({
  line,
  tokens,
  compact,
  selectable,
  selected,
  onPointerDownLine,
  onPointerEnterLine,
}: {
  line: DiffLine
  tokens: ThemedToken[] | null
  compact: boolean
  selectable: boolean
  selected: boolean
  onPointerDownLine: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerEnterLine: () => void
}) {
  const gutterWidth = compact ? 36 : 48
  const markerWidth = compact ? 18 : 20
  const rowStyle = {
    display: 'flex',
    width: '100%',
    minWidth: 'max-content',
    background: selected ? SELECTED_LINE_BG : LINE_BG[line.type],
    border: 'none',
    padding: 0,
    fontFamily: 'var(--font-mono)',
    fontSize: compact ? 12 : 13,
    lineHeight: compact ? '18px' : '20px',
    textAlign: 'left',
    cursor: selectable ? 'pointer' : 'text',
  } as const
  const content = (
    <>
      <span
        style={{
          width: gutterWidth,
          minWidth: gutterWidth,
          textAlign: 'right',
          paddingRight: 8,
          color: GUTTER_COLOR[line.type],
          opacity: 0.6,
          userSelect: 'none',
          flexShrink: 0,
          cursor: 'inherit',
        }}
      >
        {line.oldLineNumber ?? ''}
      </span>
      <span
        style={{
          width: gutterWidth,
          minWidth: gutterWidth,
          textAlign: 'right',
          paddingRight: 8,
          color: GUTTER_COLOR[line.type],
          opacity: 0.6,
          userSelect: 'none',
          flexShrink: 0,
          cursor: 'inherit',
        }}
      >
        {line.newLineNumber ?? ''}
      </span>
      <span
        style={{
          width: markerWidth,
          minWidth: markerWidth,
          textAlign: 'center',
          color: GUTTER_COLOR[line.type],
          userSelect: 'none',
          flexShrink: 0,
          cursor: 'inherit',
        }}
      >
        {linePrefix(line)}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          whiteSpace: 'pre',
          paddingRight: 16,
          color: 'var(--text-primary)',
          cursor: 'inherit',
        }}
      >
        {tokens ? <TokenizedLine tokens={tokens} /> : line.content}
      </span>
    </>
  )

  if (!selectable) {
    return (
      <div data-testid="diff-line-row" style={rowStyle}>
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      onPointerDown={onPointerDownLine}
      onPointerEnter={onPointerEnterLine}
      aria-pressed={selected}
      data-testid="diff-line-row"
      data-diff-code-area="true"
      style={rowStyle}
      className="hover:bg-accent/10"
    >
      {content}
    </button>
  )
}

function FileSection({
  file,
  fileIndex,
  defaultCollapsed,
  tokensByLine,
  compact,
  selectable,
  selectedLineKeys,
  onSelectLine,
  onDragSelectLine,
  onClearFileSelection,
  onSendToAgent,
}: {
  file: DiffFile
  fileIndex: number
  defaultCollapsed: boolean
  tokensByLine: Map<number, ThemedToken[]> | null
  compact: boolean
  selectable: boolean
  selectedLineKeys: Set<string>
  onSelectLine: (selection: LineSelection, event: ReactPointerEvent<HTMLButtonElement>) => void
  onDragSelectLine: (selection: LineSelection) => void
  onClearFileSelection: (fileIndex: number) => void
  onSendToAgent?: (content: string) => void
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current
      if (next) onClearFileSelection(fileIndex)
      return next
    })
  }, [fileIndex, onClearFileSelection])

  // Compute a global line index across all hunks for token lookup.
  let globalLineIdx = 0

  return (
    <div
      style={{
        borderRadius: compact ? 4 : 6,
        border: '1px solid var(--border-default)',
        overflow: 'hidden',
        marginBottom: compact ? 6 : 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: compact ? '6px 8px' : '8px 12px',
          background: 'var(--bg-tertiary)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: compact ? 12 : 13,
        }}
      >
        <button
          onClick={toggle}
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left"
          style={{
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: compact ? 12 : 13,
            cursor: 'pointer',
          }}
        >
          <span
            style={{
              transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)',
              transition: 'transform 0.15s',
              cursor: 'inherit',
            }}
          >
            ▼
          </span>
          <span className="min-w-0 flex-1 truncate" title={file.newPath} style={{ cursor: 'inherit' }}>
            {file.newPath}
          </span>
          <span style={{ color: '#4ADE80', fontSize: 12, cursor: 'inherit' }}>+{file.additions}</span>
          <span style={{ color: '#F87171', fontSize: 12, cursor: 'inherit' }}>-{file.deletions}</span>
        </button>
        {selectable && (
          <ActionButton
            title="Copy file path"
            onClick={() => { void copyText(file.newPath) }}
          >
            Copy path
          </ActionButton>
        )}
      </div>

      {!collapsed && (
        <div style={{ background: 'var(--bg-secondary)', overflowX: 'auto' }}>
          {file.hunks.map((hunk, hunkIndex) => (
            <div key={hunkIndex}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  minWidth: 'max-content',
                  padding: compact ? '3px 8px 3px 90px' : '4px 12px 4px 116px',
                  background: HUNK_BG,
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: compact ? 11 : 12,
                }}
              >
                <span className="flex-1 whitespace-pre">{hunk.header}</span>
                {selectable && (
                  <>
                    <ActionButton
                      title="Copy hunk"
                      onClick={() => { void copyText(getHunkText(file, hunk)) }}
                    >
                      Copy hunk
                    </ActionButton>
                    {onSendToAgent && (
                      <ActionButton
                        title="Send hunk to agent"
                        onClick={() => { onSendToAgent(getHunkText(file, hunk)) }}
                      >
                        Send
                      </ActionButton>
                    )}
                  </>
                )}
              </div>
              {hunk.lines.map((line, lineIndex) => {
                const idx = globalLineIdx++
                const key = selectionKey({ fileIndex, hunkIndex, lineIndex })
                return (
                  <DiffLineRow
                    key={`${String(hunkIndex)}-${String(lineIndex)}`}
                    line={line}
                    tokens={tokensByLine?.get(idx) ?? null}
                    compact={compact}
                    selectable={selectable}
                    selected={selectedLineKeys.has(key)}
                    onPointerDownLine={(event) => {
                      onSelectLine({ fileIndex, hunkIndex, lineIndex }, event)
                    }}
                    onPointerEnterLine={() => {
                      onDragSelectLine({ fileIndex, hunkIndex, lineIndex })
                    }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Main Component ---

export function DiffViewer({
  diff,
  defaultCollapsed = false,
  compact = false,
  selectable = false,
  onSendToAgent,
}: DiffViewerProps) {
  const files = useMemo(() => parseDiff(diff), [diff])
  const [tokenMap, setTokenMap] = useState<Map<string, Map<number, ThemedToken[]>>>(new Map())
  const [selectedLineKeys, setSelectedLineKeys] = useState<Set<string>>(new Set())
  const [shikiTheme, setShikiTheme] = useState<ShikiTheme>(() => getCurrentShikiTheme())
  const selectionAnchorRef = useRef<LineSelection | null>(null)
  const draggingSelectionRef = useRef(false)
  const selectedText = useMemo(
    () => getSelectedText(files, selectedLineKeys),
    [files, selectedLineKeys],
  )

  const clearSelection = useCallback(() => {
    setSelectedLineKeys(new Set())
    selectionAnchorRef.current = null
    draggingSelectionRef.current = false
  }, [])

  const selectRange = useCallback((from: LineSelection, to: LineSelection) => {
    setSelectedLineKeys(new Set(getSelectionRange(files, from, to)))
  }, [files])

  const handleSelectLine = useCallback((selection: LineSelection, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!selectable || event.button !== 0) return
    event.preventDefault()

    if (event.shiftKey && selectionAnchorRef.current) {
      draggingSelectionRef.current = true
      selectRange(selectionAnchorRef.current, selection)
      return
    }

    selectionAnchorRef.current = selection
    draggingSelectionRef.current = true
    setSelectedLineKeys((prev) => {
      const key = selectionKey(selection)
      if (prev.has(key) && prev.size === 1) {
        return new Set()
      }
      return new Set([key])
    })
  }, [selectRange, selectable])

  const handleDragSelectLine = useCallback((selection: LineSelection) => {
    if (!draggingSelectionRef.current || !selectionAnchorRef.current) return
    selectRange(selectionAnchorRef.current, selection)
  }, [selectRange])

  const clearFileSelection = useCallback((fileIndex: number) => {
    const prefix = `${String(fileIndex)}:`
    if (selectionAnchorRef.current?.fileIndex === fileIndex) {
      selectionAnchorRef.current = null
      draggingSelectionRef.current = false
    }
    setSelectedLineKeys((prev) => {
      if (![...prev].some((key) => key.startsWith(prefix))) return prev
      return new Set([...prev].filter((key) => !key.startsWith(prefix)))
    })
  }, [])

  useEffect(() => {
    clearSelection()
  }, [clearSelection, diff])

  useEffect(() => {
    if (!selectable) return
    const stopDragging = () => {
      draggingSelectionRef.current = false
    }
    window.addEventListener('pointerup', stopDragging)
    window.addEventListener('pointercancel', stopDragging)
    return () => {
      window.removeEventListener('pointerup', stopDragging)
      window.removeEventListener('pointercancel', stopDragging)
    }
  }, [selectable])

  useEffect(() => {
    if (!selectable || selectedLineKeys.size === 0) return

    const clearFromOutsideCode = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (target.closest('[data-diff-code-area="true"], [data-diff-action="true"]')) return

      clearSelection()
    }

    document.addEventListener('pointerdown', clearFromOutsideCode, true)
    return () => {
      document.removeEventListener('pointerdown', clearFromOutsideCode, true)
    }
  }, [clearSelection, selectable, selectedLineKeys.size])

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return
    const updateTheme = () => { setShikiTheme(getCurrentShikiTheme()) }
    const observer = new MutationObserver(updateTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    updateTheme()
    return () => { observer.disconnect() }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function highlight() {
      const newMap = new Map<string, Map<number, ThemedToken[]>>()

      for (const file of files) {
        const lang = detectLanguage(file.newPath)
        if (!lang) continue

        const allLines: string[] = []
        for (const hunk of file.hunks) {
          for (const line of hunk.lines) {
            allLines.push(line.content)
          }
        }

        if (allLines.length === 0) continue

        const code = allLines.join('\n')
        const tokens = await tokenizeCode(code, lang, shikiTheme)
        if (cancelled) return

        if (tokens) {
          const lineMap = new Map<number, ThemedToken[]>()
          tokens.forEach((lineTokens, idx) => {
            lineMap.set(idx, lineTokens)
          })
          newMap.set(file.newPath, lineMap)
        }
      }

      if (!cancelled) setTokenMap(newMap)
    }

    void highlight()
    return () => { cancelled = true }
  }, [files, shikiTheme])

  if (!diff.trim()) {
    return (
      <div
        style={{
          padding: compact ? 16 : 24,
          color: 'var(--text-muted)',
          textAlign: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: compact ? 12 : 13,
        }}
      >
        No changes to display
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {selectable && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-border-default bg-surface px-2 py-1.5">
          <span className="mr-auto text-xs text-text-secondary">
            {selectedLineKeys.size > 0
              ? `${String(selectedLineKeys.size)} line${selectedLineKeys.size === 1 ? '' : 's'} selected`
              : 'Select diff lines to copy or send context'}
          </span>
          <ActionButton
            disabled={selectedLineKeys.size === 0}
            onClick={() => { void copyText(selectedText) }}
          >
            Copy selected
          </ActionButton>
          {onSendToAgent && (
            <ActionButton
              disabled={selectedLineKeys.size === 0}
              onClick={() => { onSendToAgent(selectedText) }}
            >
              Send to agent
            </ActionButton>
          )}
        </div>
      )}
      {files.map((file, fileIndex) => (
        <FileSection
          key={`${file.oldPath}->${file.newPath}`}
          file={file}
          fileIndex={fileIndex}
          defaultCollapsed={defaultCollapsed}
          tokensByLine={tokenMap.get(file.newPath) ?? null}
          compact={compact}
          selectable={selectable}
          selectedLineKeys={selectedLineKeys}
          onSelectLine={handleSelectLine}
          onDragSelectLine={handleDragSelectLine}
          onClearFileSelection={clearFileSelection}
          onSendToAgent={onSendToAgent}
        />
      ))}
    </div>
  )
}
