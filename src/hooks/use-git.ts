import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

export type FileChange = {
  path: string
  status: string
  additions: number
  deletions: number
}

export type ChangeSummary = {
  files: FileChange[]
  totalAdditions: number
  totalDeletions: number
  totalFiles: number
}

export type CommitInfo = {
  hash: string
  shortHash: string
  message: string
  author: string
  timestamp: number
}

export function useGit(repoPath: string | null) {
  const [changes, setChanges] = useState<ChangeSummary | null>(null)
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [loading, setLoading] = useState(false)

  const fetchChanges = useCallback(
    async (branch: string) => {
      if (!repoPath) return
      try {
        setLoading(true)
        const result = await invoke<ChangeSummary>('get_changes', {
          repoPath,
          branch,
        })
        setChanges(result)
      } catch {
        setChanges(null)
      } finally {
        setLoading(false)
      }
    },
    [repoPath],
  )

  const fetchCommits = useCallback(
    async (branch: string) => {
      if (!repoPath) return
      try {
        const result = await invoke<CommitInfo[]>('get_commits', {
          repoPath,
          branch,
        })
        setCommits(result)
      } catch {
        setCommits([])
      }
    },
    [repoPath],
  )

  const fetchAll = useCallback(
    async (branch: string) => {
      await Promise.all([fetchChanges(branch), fetchCommits(branch)])
    },
    [fetchChanges, fetchCommits],
  )

  return {
    changes,
    commits,
    loading,
    fetchChanges,
    fetchCommits,
    fetchAll,
  }
}
