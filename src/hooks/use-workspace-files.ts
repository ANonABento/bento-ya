/** Hook for scanning and categorizing workspace files (context, tickets, notes). */

import { useState, useCallback, useEffect } from 'react'
import { scanWorkspaceFiles, type FileEntry } from '@/lib/ipc'

export type FileCategory = 'context' | 'tickets' | 'notes'

export type GroupedFiles = {
  context: FileEntry[]
  tickets: FileEntry[]
  notes: FileEntry[]
}

export function useWorkspaceFiles(repoPath: string | null) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [groupedFiles, setGroupedFiles] = useState<GroupedFiles>({
    context: [],
    tickets: [],
    notes: [],
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchFiles = useCallback(async () => {
    if (!repoPath) {
      setFiles([])
      setGroupedFiles({ context: [], tickets: [], notes: [] })
      return
    }

    try {
      setLoading(true)
      setError(null)
      const result = await scanWorkspaceFiles(repoPath)
      setFiles(result)

      // Group files by category
      const grouped: GroupedFiles = {
        context: [],
        tickets: [],
        notes: [],
      }
      for (const file of result) {
        if (file.category in grouped) {
          grouped[file.category as FileCategory].push(file)
        }
      }
      setGroupedFiles(grouped)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to scan files'
      setError(message)
      setFiles([])
      setGroupedFiles({ context: [], tickets: [], notes: [] })
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  // Auto-fetch on mount and when repoPath changes
  useEffect(() => {
    void fetchFiles()
  }, [fetchFiles])

  return {
    files,
    groupedFiles,
    loading,
    error,
    refresh: fetchFiles,
  }
}
