/**
 * Workspace Files view — a workspace-level markdown/plan viewer. Master-detail:
 * the file tree (context / tickets / notes) on the left, a rendered preview on
 * the right. Reuses the same `scan_workspace_files` / `read_file_content` IPC
 * and components as the sidebar files browser — just laid out for the wider
 * main area so plans are comfortable to read next to the terminal. Shared by
 * the orchestrator panel and the per-task agent panel (both pass a workspaceId).
 */

import { useState } from 'react'
import { FilesTree } from './files-tree'
import { FilePreview } from './file-preview'
import { useWorkspaceFiles } from '@/hooks/use-workspace-files'
import { EmptyState } from '@/components/shared/empty-state'
import type { FileEntry } from '@/lib/ipc'

export function WorkspaceFilesView({ workspaceId }: { workspaceId: string }) {
  const { groupedFiles, loading, refresh } = useWorkspaceFiles(workspaceId)
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null)

  return (
    <div
      data-testid="workspace-files-view"
      className="@container/files flex min-h-0 flex-1 overflow-hidden"
    >
      {/* Left: file tree — narrower in tight panels (agent panel), roomier when
          the container is wide (orchestrator) so the preview always has space. */}
      <div className="flex w-44 shrink-0 flex-col border-r border-border-default @lg/files:w-60">
        <div className="flex items-center justify-between border-b border-border-default px-2 py-1">
          <span className="text-[11px] font-medium text-text-secondary">Plans &amp; files</span>
          <button
            type="button"
            onClick={() => { void refresh() }}
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
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <FilesTree
            groupedFiles={groupedFiles}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            loading={loading}
          />
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
              description="Pick a plan, ticket, or note from the list to read it here — markdown is rendered, alongside your chat and terminal."
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
