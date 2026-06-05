/**
 * Workspace Files view — a workspace-level file/plan viewer. Master-detail:
 * a tree on the left, a rendered preview on the right. Two tree modes:
 *   • Plans  — curated markdown (context / tickets / notes) via scan_workspace_files
 *   • Browse — the full repo tree (any file) via list_workspace_dir, lazily expanded
 * The preview renders markdown for .md and syntax-highlighted code for the rest.
 * Shared by the orchestrator panel and the per-task agent panel.
 */

import { useState } from 'react'
import { FilesTree } from './files-tree'
import { FilePreview } from './file-preview'
import { FileBrowser } from './file-browser'
import { useWorkspaceFiles } from '@/hooks/use-workspace-files'
import { EmptyState } from '@/components/shared/empty-state'
import type { FileEntry } from '@/lib/ipc'

type SelectedFile = FileEntry | { path: string; name: string }
type Mode = 'plans' | 'browse'

export function WorkspaceFilesView({ workspaceId }: { workspaceId: string }) {
  const { groupedFiles, loading, refresh } = useWorkspaceFiles(workspaceId)
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null)
  const [mode, setMode] = useState<Mode>('plans')
  const [browseKey, setBrowseKey] = useState(0)

  const treeSelected = selectedFile && 'category' in selectedFile ? selectedFile : null

  return (
    <div
      data-testid="workspace-files-view"
      className="@container/files flex min-h-0 flex-1 overflow-hidden"
    >
      {/* Left: tree (Plans | Browse) — narrower in tight panels, roomier when
          the container is wide so the preview always has space. */}
      <div className="flex w-44 shrink-0 flex-col border-r border-border-default @lg/files:w-60">
        <div className="flex items-center justify-between gap-1 border-b border-border-default px-2 py-1">
          <div className="inline-flex items-center gap-0.5 rounded-md bg-surface p-0.5">
            {(['plans', 'browse'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m) }}
                aria-pressed={mode === m}
                data-testid={`files-mode-${m}`}
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  mode === m
                    ? 'bg-surface-hover text-text-primary'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
                style={{ cursor: 'pointer' }}
              >
                {m === 'plans' ? 'Plans' : 'Browse'}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => { if (mode === 'plans') void refresh(); else setBrowseKey((k) => k + 1) }}
            aria-label="Refresh files"
            title="Rescan workspace files"
            className="rounded p-1 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            style={{ cursor: 'pointer' }}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5">
              <path d="M13.2 6A4.7 4.7 0 0 0 4.4 4.8L3 6.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 4v2.8h2.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2.8 10A4.7 4.7 0 0 0 11.6 11.2L13 9.2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M13 12V9.2h-2.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {mode === 'plans' ? (
            <div className="p-1">
              <FilesTree
                groupedFiles={groupedFiles}
                selectedFile={treeSelected}
                onSelectFile={setSelectedFile}
                loading={loading}
              />
            </div>
          ) : (
            <FileBrowser
              key={browseKey}
              workspaceId={workspaceId}
              selectedPath={selectedFile?.path ?? null}
              onSelectFile={setSelectedFile}
            />
          )}
        </div>
      </div>

      {/* Right: preview */}
      <div className="min-w-0 flex-1 overflow-hidden">
        {selectedFile ? (
          <FilePreview
            workspaceId={workspaceId}
            file={selectedFile}
            onClose={() => { setSelectedFile(null) }}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState
              size="md"
              title="No file selected"
              description="Pick a plan from the list or browse the repo — markdown is rendered, code is syntax-highlighted, alongside your chat and terminal."
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-full w-full">
                  <path d="M4 4a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Z" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M13 2v5h5M8 13h8M8 17h5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              }
            />
          </div>
        )}
      </div>
    </div>
  )
}
