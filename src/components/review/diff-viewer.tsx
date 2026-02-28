import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BundledLanguage, Highlighter, ThemedToken } from 'shiki'

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

export interface DiffViewerProps {
  /** Raw unified diff string */
  diff: string
  /** Default collapsed state per file (default: false) */
  defaultCollapsed?: boolean
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

// --- Shiki Lazy Loader ---

const LANG_MAP: Record<string, BundledLanguage> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  rs: 'rust',
  py: 'python',
  css: 'css',
  html: 'html',
  json: 'json',
  md: 'markdown',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'bash',
  sql: 'sql',
  svg: 'xml',
  xml: 'xml',
}

function detectLanguage(filePath: string): BundledLanguage | null {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return LANG_MAP[ext] ?? null
}

let highlighterPromise: Promise<Highlighter> | null = null
const loadedLangs = new Set<string>()

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then((mod) =>
      mod.createHighlighter({ themes: ['github-dark'], langs: [] })
    )
  }
  return highlighterPromise
}

async function tokenizeCode(
  code: string,
  lang: BundledLanguage
): Promise<ThemedToken[][] | null> {
  try {
    const hl = await getHighlighter()
    if (!loadedLangs.has(lang)) {
      await hl.loadLanguage(lang)
      loadedLangs.add(lang)
    }
    const result = hl.codeToTokens(code, { lang, theme: 'github-dark' })
    return result.tokens
  } catch {
    return null
  }
}

// --- Styles ---

const LINE_BG = {
  add: 'rgba(74, 222, 128, 0.1)',
  remove: 'rgba(248, 113, 113, 0.1)',
  context: 'transparent',
} as const

const GUTTER_COLOR = {
  add: '#4ADE80',
  remove: '#F87171',
  context: 'var(--text-muted)',
} as const

// --- Components ---

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
}: {
  line: DiffLine
  tokens: ThemedToken[] | null
}) {
  const gutterWidth = 48

  return (
    <div
      style={{
        display: 'flex',
        background: LINE_BG[line.type],
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        lineHeight: '20px',
      }}
    >
      {/* Old line number */}
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
        }}
      >
        {line.oldLineNumber ?? ''}
      </span>
      {/* New line number */}
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
        }}
      >
        {line.newLineNumber ?? ''}
      </span>
      {/* +/- indicator */}
      <span
        style={{
          width: 20,
          minWidth: 20,
          textAlign: 'center',
          color: GUTTER_COLOR[line.type],
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
      </span>
      {/* Content */}
      <span
        style={{
          flex: 1,
          whiteSpace: 'pre',
          overflowX: 'auto',
          paddingRight: 16,
        }}
      >
        {tokens ? <TokenizedLine tokens={tokens} /> : line.content}
      </span>
    </div>
  )
}

function FileSection({
  file,
  defaultCollapsed,
  tokensByLine,
}: {
  file: DiffFile
  defaultCollapsed: boolean
  tokensByLine: Map<number, ThemedToken[]> | null
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  const toggle = useCallback(() => { setCollapsed((c) => !c) }, [])

  // Compute a global line index across all hunks for token lookup
  let globalLineIdx = 0

  return (
    <div
      style={{
        borderRadius: 6,
        border: '1px solid var(--border-default)',
        overflow: 'hidden',
        marginBottom: 8,
      }}
    >
      {/* File header */}
      <button
        onClick={toggle}
        type="button"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '8px 12px',
          background: 'var(--bg-tertiary)',
          border: 'none',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
          ▼
        </span>
        <span style={{ flex: 1 }}>{file.newPath}</span>
        <span style={{ color: '#4ADE80', fontSize: 12 }}>+{file.additions}</span>
        <span style={{ color: '#F87171', fontSize: 12 }}>-{file.deletions}</span>
      </button>

      {/* Diff content */}
      {!collapsed && (
        <div style={{ background: 'var(--bg-secondary)', overflowX: 'auto' }}>
          {file.hunks.map((hunk, hi) => (
            <div key={hi}>
              {/* Hunk header */}
              <div
                style={{
                  padding: '4px 12px 4px 116px',
                  background: 'rgba(59, 130, 246, 0.08)',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                }}
              >
                {hunk.header}
              </div>
              {/* Lines */}
              {hunk.lines.map((line, li) => {
                const idx = globalLineIdx++
                return (
                  <DiffLineRow
                    key={`${String(hi)}-${String(li)}`}
                    line={line}
                    tokens={tokensByLine?.get(idx) ?? null}
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

export function DiffViewer({ diff, defaultCollapsed = false }: DiffViewerProps) {
  const files = useMemo(() => parseDiff(diff), [diff])
  const [tokenMap, setTokenMap] = useState<Map<string, Map<number, ThemedToken[]>>>(new Map())

  // Lazy-load Shiki and tokenize each file's content
  useEffect(() => {
    let cancelled = false

    async function highlight() {
      const newMap = new Map<string, Map<number, ThemedToken[]>>()

      for (const file of files) {
        const lang = detectLanguage(file.newPath)
        if (!lang) continue

        // Combine all line contents for the file (preserves cross-line token state)
        const allLines: string[] = []
        for (const hunk of file.hunks) {
          for (const line of hunk.lines) {
            allLines.push(line.content)
          }
        }

        if (allLines.length === 0) continue

        const code = allLines.join('\n')
        const tokens = await tokenizeCode(code, lang)
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
  }, [files])

  if (!diff.trim()) {
    return (
      <div
        style={{
          padding: 24,
          color: 'var(--text-muted)',
          textAlign: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
        }}
      >
        No changes to display
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {files.map((file) => (
        <FileSection
          key={file.newPath}
          file={file}
          defaultCollapsed={defaultCollapsed}
          tokensByLine={tokenMap.get(file.newPath) ?? null}
        />
      ))}
    </div>
  )
}
