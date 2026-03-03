import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { readFileContent, type FileEntry } from '@/lib/ipc'

type FilePreviewProps = {
  file: FileEntry
  onClose: () => void
}

export function FilePreview({ file, onClose }: FilePreviewProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadContent() {
      try {
        setLoading(true)
        setError(null)
        const text = await readFileContent(file.path)
        if (!cancelled) {
          setContent(text)
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load file'
          setError(message)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadContent()

    return () => {
      cancelled = true
    }
  }, [file.path])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-text-secondary">
            <path fillRule="evenodd" d="M4 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.414A2 2 0 0 0 13.414 6L10 2.586A2 2 0 0 0 8.586 2H4Zm5 2a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H9Z" clipRule="evenodd" />
          </svg>
          <span className="text-xs font-medium text-text-primary truncate">{file.name}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-text-secondary/30 border-t-text-secondary" />
          </div>
        )}

        {error && (
          <div className="py-4 text-center">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {!loading && !error && content !== null && (
          <article className="prose prose-sm prose-invert max-w-none prose-headings:text-text-primary prose-p:text-text-secondary prose-a:text-blue-400 prose-strong:text-text-primary prose-code:text-amber-300 prose-code:bg-surface-hover prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-surface-hover prose-pre:border prose-pre:border-border-default prose-li:text-text-secondary prose-blockquote:border-l-text-secondary/30 prose-blockquote:text-text-secondary/80">
            <ReactMarkdown>{content}</ReactMarkdown>
          </article>
        )}
      </div>
    </div>
  )
}
