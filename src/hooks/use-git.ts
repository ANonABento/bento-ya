/** Hook for git operations: change tracking, branch info, and diff viewing. */

import { useState, useCallback, useRef } from 'react'
import { invoke } from '@/lib/ipc/invoke'

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

const ALL_FILES = '__all__'

export function useGit(repoPath: string | null) {
  const [changes, setChanges] = useState<ChangeSummary | null>(null)
  const [commits, setCommits] = useState<CommitInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [diffByFile, setDiffByFile] = useState<Record<string, string>>({})
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const diffCacheKeyRef = useRef<string | null>(null)

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

  const fetchDiff = useCallback(
    async (branch: string, filePath: string | null) => {
      if (!repoPath) return ''
      const cacheKey = `${repoPath}::${branch}`
      if (diffCacheKeyRef.current !== cacheKey) {
        diffCacheKeyRef.current = cacheKey
        setDiffByFile({})
      }
      const key = filePath ?? ALL_FILES
      try {
        setDiffLoading(true)
        setDiffError(null)
        const result = await invoke<string>('get_diff', {
          repoPath,
          branch,
          filePath: filePath ?? undefined,
        })
        setDiffByFile((prev) => ({ ...prev, [key]: result }))
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setDiffError(message)
        return ''
      } finally {
        setDiffLoading(false)
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
    diffByFile,
    diffLoading,
    diffError,
    fetchChanges,
    fetchCommits,
    fetchDiff,
    fetchAll,
  }
}
