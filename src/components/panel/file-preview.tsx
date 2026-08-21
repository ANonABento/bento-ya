import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { readFileContent, openInEditor, type FileEntry } from '@/lib/ipc'
import {
  detectLanguage,
  tokenizeCode,
  getCurrentShikiTheme,
  type ShikiTheme,
  type ThemedToken,
} from '@/lib/shiki'

type FilePreviewProps = {
  workspaceId: string
  /** Either a categorized markdown FileEntry, or any file by relative path. */
  file: FileEntry | { path: string; name: string }
  onClose: () => void
}

function isMarkdown(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop()
  return ext === 'md' || ext === 'markdown'
}

export function FilePreview({ workspaceId, file, onClose }: FilePreviewProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadContent() {
      try {
        setLoading(true)
        setError(null)
        const text = await readFileContent(workspaceId, file.path)
        if (!cancelled) setContent(text)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load file')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadContent()
    return () => { cancelled = true }
  }, [workspaceId, file.path])

  const markdown = isMarkdown(file.name)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-text-secondary">
            <path fillRule="evenodd" d="M4 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.414A2 2 0 0 0 13.414 6L10 2.586A2 2 0 0 0 8.586 2H4Zm5 2a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H9Z" clipRule="evenodd" />
          </svg>
          <span className="text-xs font-medium text-text-primary truncate" title={file.path}>{file.name}</span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => { void openInEditor(workspaceId, file.path).catch(() => {}) }}
            className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            title="Open in editor (VS Code)"
            aria-label="Open in editor"
            style={{ cursor: 'pointer' }}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5" aria-hidden="true">
              <path d="M9.5 2.5H13.5V6.5M13.5 2.5L8 8M11 9v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1H7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Open</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            aria-label="Close file preview"
            style={{ cursor: 'pointer' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-text-secondary/30 border-t-text-secondary" />
          </div>
        )}

        {error && (
          <div className="py-4 px-3 text-center">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {!loading && !error && content !== null && (
          markdown ? (
            <article className="prose prose-sm prose-invert max-w-3xl p-4 prose-headings:text-text-primary prose-p:text-text-secondary prose-a:text-blue-400 prose-strong:text-text-primary prose-code:text-amber-300 prose-code:bg-surface-hover prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-surface-hover prose-pre:border prose-pre:border-border-default prose-li:text-text-secondary prose-blockquote:border-l-text-secondary/30 prose-blockquote:text-text-secondary/80 prose-table:text-text-secondary prose-th:text-text-primary prose-td:border-border-default prose-th:border-border-default prose-hr:border-border-default">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </article>
          ) : (
            <CodeView content={content} filePath={file.path} />
          )
        )}
      </div>
    </div>
  )
}

/** Syntax-highlighted (shiki) read-only code, falling back to plain monospace
 *  for unknown languages. Re-tokenizes on theme change. */
function CodeView({ content, filePath }: { content: string; filePath: string }) {
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null)
  const [theme, setTheme] = useState<ShikiTheme>(() => getCurrentShikiTheme())

  useEffect(() => {
    const observer = new MutationObserver(() => { setTheme(getCurrentShikiTheme()) })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => { observer.disconnect() }
  }, [])

  useEffect(() => {
    let cancelled = false
    const lang = detectLanguage(filePath)
    if (!lang) { setTokens(null); return }
    void tokenizeCode(content, lang, theme).then((t) => { if (!cancelled) setTokens(t) })
    return () => { cancelled = true }
  }, [content, filePath, theme])

  return (
    <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-text-primary">
      <code>
        {tokens
          ? tokens.map((line, i) => (
              <div key={i} className="whitespace-pre">
                {line.length === 0
                  ? ' '
                  : line.map((tok, j) => (
                      <span key={j} style={{ color: tok.color }}>{tok.content}</span>
                    ))}
              </div>
            ))
          : content}
      </code>
    </pre>
  )
}
