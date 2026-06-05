/**
 * FileBrowser — a lazy, expandable tree of the workspace repo for the Files
 * view's "Browse" mode. Each directory fetches its children on first expand
 * (via list_workspace_dir); selecting a file bubbles up to the preview pane.
 */

import { useState, useEffect, useCallback } from 'react'
import { listWorkspaceDir, type DirEntry } from '@/lib/ipc'

type SelectedFile = { path: string; name: string }

type FileBrowserProps = {
  workspaceId: string
  selectedPath: string | null
  onSelectFile: (file: SelectedFile) => void
}

export function FileBrowser({ workspaceId, selectedPath, onSelectFile }: FileBrowserProps) {
  const [root, setRoot] = useState<DirEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setRoot(null)
    setError(null)
    listWorkspaceDir(workspaceId)
      .then((entries) => { if (!cancelled) setRoot(entries) })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to list files')
      })
    return () => { cancelled = true }
  }, [workspaceId])

  if (error) {
    return <p className="px-2 py-3 text-[11px] text-red-400">{error}</p>
  }
  if (root === null) {
    return <p className="px-2 py-3 text-[11px] text-text-secondary/60">Loading…</p>
  }
  if (root.length === 0) {
    return <p className="px-2 py-3 text-[11px] text-text-secondary/60">Empty repository</p>
  }

  return (
    <div className="py-1">
      {root.map((entry) =>
        entry.isDir ? (
          <DirNode
            key={entry.path}
            workspaceId={workspaceId}
            entry={entry}
            depth={0}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
          />
        ) : (
          <FileNode
            key={entry.path}
            entry={entry}
            depth={0}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
          />
        ),
      )}
    </div>
  )
}

function Row({
  depth,
  active,
  onClick,
  children,
}: {
  depth: number
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ paddingLeft: 8 + depth * 12, cursor: 'pointer' }}
      className={`flex w-full items-center gap-1.5 py-0.5 pr-2 text-left text-[11px] transition-colors ${
        active
          ? 'bg-surface-hover text-text-primary'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  )
}

function DirNode({
  workspaceId,
  entry,
  depth,
  selectedPath,
  onSelectFile,
}: {
  workspaceId: string
  entry: DirEntry
  depth: number
  selectedPath: string | null
  onSelectFile: (file: SelectedFile) => void
}) {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<DirEntry[] | null>(null)
  const [loading, setLoading] = useState(false)

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      const next = !wasOpen
      if (next && children === null && !loading) {
        setLoading(true)
        listWorkspaceDir(workspaceId, entry.path)
          .then((c) => { setChildren(c) })
          .catch(() => { setChildren([]) })
          .finally(() => { setLoading(false) })
      }
      return next
    })
  }, [children, loading, workspaceId, entry.path])

  return (
    <div>
      <Row depth={depth} onClick={toggle}>
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        >
          <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-text-secondary/80" aria-hidden="true">
          <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.2 1.5h4.8A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z" />
        </svg>
        <span className="truncate">{entry.name}</span>
      </Row>
      {open && (
        <div>
          {loading && children === null && (
            <p className="py-0.5 text-[11px] text-text-secondary/50" style={{ paddingLeft: 8 + (depth + 1) * 12 }}>
              …
            </p>
          )}
          {children?.map((child) =>
            child.isDir ? (
              <DirNode
                key={child.path}
                workspaceId={workspaceId}
                entry={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
              />
            ) : (
              <FileNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
              />
            ),
          )}
        </div>
      )}
    </div>
  )
}

function FileNode({
  entry,
  depth,
  selectedPath,
  onSelectFile,
}: {
  entry: DirEntry
  depth: number
  selectedPath: string | null
  onSelectFile: (file: SelectedFile) => void
}) {
  return (
    <Row
      depth={depth}
      active={entry.path === selectedPath}
      onClick={() => { onSelectFile({ path: entry.path, name: entry.name }) }}
    >
      {/* spacer to align with dir chevron */}
      <span className="h-3 w-3 shrink-0" aria-hidden="true" />
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="h-3.5 w-3.5 shrink-0 text-text-secondary/70" aria-hidden="true">
        <path d="M4 1.8h4.5L12 5.3V13a1.2 1.2 0 0 1-1.2 1.2H4A1.2 1.2 0 0 1 2.8 13V3A1.2 1.2 0 0 1 4 1.8Z" strokeLinejoin="round" />
        <path d="M8.3 2v3.2h3.2" strokeLinejoin="round" />
      </svg>
      <span className="truncate">{entry.name}</span>
    </Row>
  )
}
