import { motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Task } from '@/types'
import { useTaskDetail } from '@/hooks/use-task-detail'
import type { ChangeSummary, FileChange } from '@/hooks/use-git'
import * as ipc from '@/lib/ipc'
import { SiegeStatus } from '@/components/task-detail/siege-status'
import { CommitsSection } from '@/components/task-detail/commits-section'

const EXPANDED_MAX_HEIGHT = 560
const TOUCHED_FILES_LIMIT = 5

function getSaveShortcutLabel() {
  if (typeof navigator === 'undefined') return 'Ctrl+Enter'
  const userAgent = navigator.userAgent.toLowerCase()
  return userAgent.includes('mac os') || userAgent.includes('macintosh') ? 'Cmd+Enter' : 'Ctrl+Enter'
}

function DescriptionMarkdown({ description }: { description: string }) {
  return (
    <div className="max-h-48 overflow-y-auto rounded px-1 py-0.5 text-xs leading-relaxed text-text-secondary">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="my-1 break-words">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="my-1 ml-4 list-disc space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1 ml-4 list-decimal space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="break-words">{children}</li>,
          h1: ({ children }) => <h1 className="my-1 text-sm font-semibold text-text-primary">{children}</h1>,
          h2: ({ children }) => <h2 className="my-1 text-sm font-semibold text-text-primary">{children}</h2>,
          h3: ({ children }) => <h3 className="my-1 text-xs font-semibold text-text-primary">{children}</h3>,
          code: ({ className, children }) => {
            const isInline = !className
            return isInline ? (
              <code className="rounded bg-surface-hover px-1 py-0.5 font-mono text-[0.9em] text-accent">
                {children}
              </code>
            ) : (
              <code className={className}>{children}</code>
            )
          },
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded border border-border-default bg-surface p-2 text-[11px]">
              {children}
            </pre>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-accent underline underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
              style={{ cursor: 'pointer' }}
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-border-default pl-2 text-text-secondary/80">
              {children}
            </blockquote>
          ),
        }}
      >
        {description}
      </ReactMarkdown>
    </div>
  )
}

export function TaskCardExpanded({ task }: { task: Task }) {
  const {
    updateTask,
    changes,
    commits,
    loading,
  } = useTaskDetail(task)

  // Inline description editing — click-to-edit, Cmd/Ctrl+Enter to save, Escape to revert.
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState(task.description)
  const [savingDesc, setSavingDesc] = useState(false)
  const descSkipBlurSaveRef = useRef(false)
  const saveShortcutLabel = getSaveShortcutLabel()
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(0)

  useEffect(() => {
    if (!editingDesc) setDescDraft(task.description)
  }, [task.id, task.description, editingDesc])

  useLayoutEffect(() => {
    const element = contentRef.current
    if (!element) return

    const measure = () => {
      const nextHeight = element.getBoundingClientRect().height || element.scrollHeight
      setContentHeight((currentHeight) => (
        Math.abs(currentHeight - nextHeight) < 1 ? currentHeight : nextHeight
      ))
    }

    measure()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => { window.removeEventListener('resize', measure) }
    }

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [task.id])

  async function saveDescription() {
    const next = descDraft.trim()
    if (next === task.description) {
      setEditingDesc(false)
      return
    }
    setSavingDesc(true)
    try {
      const updated = await ipc.updateTask(task.id, { description: next })
      updateTask(task.id, updated)
    } catch (err) {
      console.error('Failed to save task description:', err)
      setDescDraft(task.description)
    } finally {
      setSavingDesc(false)
      setEditingDesc(false)
    }
  }

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: contentHeight, opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1], opacity: { duration: 0.12 } }}
      className="overflow-hidden"
    >
      <div
        ref={contentRef}
        className="border-t border-border-default bg-surface-hover/30 px-3 py-2 space-y-2 overflow-y-auto"
        style={{ maxHeight: EXPANDED_MAX_HEIGHT }}
      >
        {/* Full description — markdown preview with an explicit edit path. */}
        {editingDesc ? (
          <div className="space-y-1" data-card-click-interactive="true">
            <textarea
              value={descDraft}
              autoFocus
              rows={5}
              disabled={savingDesc}
              aria-label="Edit task description"
              placeholder="Add a description"
              onChange={(e) => { setDescDraft(e.target.value) }}
              onBlur={() => {
                if (descSkipBlurSaveRef.current) {
                  descSkipBlurSaveRef.current = false
                  return
                }
                void saveDescription()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  e.currentTarget.blur()
                } else if (e.key === 'Escape') {
                  descSkipBlurSaveRef.current = true
                  setDescDraft(task.description)
                  setEditingDesc(false)
                  e.currentTarget.blur()
                }
              }}
              className="max-h-56 w-full resize-y rounded-md border border-accent bg-surface px-2 py-1.5 text-xs leading-relaxed text-text-primary outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
            />
            <div className="px-1 text-[10px] text-text-secondary">
              {saveShortcutLabel} to save, Escape to cancel
            </div>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            data-card-click-interactive="true"
            onClick={() => { setEditingDesc(true) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setEditingDesc(true)
              }
            }}
            title="Click to edit description"
            className={`rounded hover:bg-surface-hover/40 -mx-1 -my-0.5 ${
              task.description ? '' : 'px-1 py-0.5 text-xs italic text-text-secondary/50'
            }`}
            style={{ cursor: 'text' }}
          >
            {task.description ? (
              <DescriptionMarkdown description={task.description} />
            ) : (
              'Add a description'
            )}
          </div>
        )}

        {/* Branch & status */}
        <div className="flex items-center gap-2 flex-wrap">
          {task.branch && (
            <div className="flex items-center gap-1.5">
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                className="text-text-secondary shrink-0"
              >
                <circle cx="4" cy="3" r="1.5" />
                <circle cx="8" cy="9" r="1.5" />
                <path d="M4 4.5V7.5C4 8.5 5 9 8 9M8 7.5V3" />
              </svg>
              <span className="truncate font-mono text-[11px] text-accent max-w-[180px]">
                {task.branch}
              </span>
              {task.worktreePath && (
                <span
                  className="rounded bg-purple-500/10 px-1 py-0.5 text-[10px] font-medium text-purple-400"
                  title={task.worktreePath}
                >
                  worktree
                </span>
              )}
            </div>
          )}
          {task.model && (
            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {task.model}
            </span>
          )}
        </div>

        {/* Siege Loop Status (only when active) */}
        {(task.siegeActive || task.siegeIteration > 0) && (
          <div>
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary mb-1">
              Siege Loop
            </h4>
            <SiegeStatus task={task} onUpdate={updateTask} />
          </div>
        )}

        {/* Touched files only; full diffs live in the agent panel. */}
        <div>
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary mb-1">
            Touched Files
          </h4>
          <TouchedFilesSummary
            branch={task.branch ?? null}
            changes={changes}
            loading={loading}
          />
        </div>

        <div>
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary mb-1">
            Commits
          </h4>
          <div className="rounded-md border border-border-default bg-surface">
            <CommitsSection commits={commits} />
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function TouchedFilesSummary({
  branch,
  changes,
  loading,
}: {
  branch: string | null
  changes: ChangeSummary | null
  loading: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setExpanded(false)
  }, [branch])

  if (!branch) {
    return (
      <div className="rounded-md border border-border-default bg-surface px-2 py-2 text-xs text-text-secondary">
        No branch on this task.
      </div>
    )
  }

  if (loading) {
    return (
      <div className="rounded-md border border-border-default bg-surface px-2 py-2 text-xs text-text-secondary">
        Loading files...
      </div>
    )
  }

  if (!changes || changes.totalFiles === 0) {
    return (
      <div className="rounded-md border border-border-default bg-surface px-2 py-2 text-xs text-text-secondary">
        No files changed.
      </div>
    )
  }

  const hiddenCount = Math.max(0, changes.files.length - TOUCHED_FILES_LIMIT)
  const visibleFiles = expanded ? changes.files : changes.files.slice(0, TOUCHED_FILES_LIMIT)

  return (
    <div className="rounded-md border border-border-default bg-surface" data-testid="touched-files-summary">
      <div className="flex items-center gap-2 border-b border-border-default px-2 py-1.5">
        <span className="text-xs font-medium text-text-primary">
          {changes.totalFiles} file{changes.totalFiles !== 1 ? 's' : ''}
        </span>
        <span className="text-xs text-success">+{changes.totalAdditions}</span>
        <span className="text-xs text-error">-{changes.totalDeletions}</span>
      </div>
      <div className="px-1 py-1">
        {visibleFiles.map((file) => (
          <TouchedFileRow key={file.path} file={file} />
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => { setExpanded((current) => !current) }}
            className="mt-1 flex w-full items-center justify-center rounded px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            style={{ cursor: 'pointer' }}
          >
            {expanded ? 'Show less' : `Show ${String(hiddenCount)} more`}
          </button>
        )}
      </div>
    </div>
  )
}

function TouchedFileRow({ file }: { file: FileChange }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded px-2 py-1 text-xs">
      <StatusBadge status={file.status} />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-secondary" title={file.path}>
        {file.path}
      </span>
      <span className="shrink-0 text-[11px] text-success">+{file.additions}</span>
      <span className="shrink-0 text-[11px] text-error">-{file.deletions}</span>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'added'
      ? 'text-success'
      : status === 'deleted'
        ? 'text-error'
        : status === 'modified'
          ? 'text-warning'
          : 'text-text-secondary'
  const letter = status[0]?.toUpperCase() ?? '?'

  return (
    <span className={`w-3 shrink-0 text-center font-mono text-[10px] font-bold ${color}`}>
      {letter}
    </span>
  )
}
