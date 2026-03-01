import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export type AgentStatus = 'idle' | 'running' | 'stopped' | 'failed'

interface AgentInfo {
  taskId: string
  agentType: string
  status: string
  pid: number | null
  workingDir: string
}

interface UseAgentOptions {
  taskId: string
  agentType?: string
  workingDir?: string
  cliPath?: string
}

export function useAgent({ taskId, agentType = 'claude', workingDir, cliPath }: UseAgentOptions) {
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [pid, setPid] = useState<number | null>(null)
  const unlistenRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false

    const setupListener = async () => {
      const unlisten = await listen<{ taskId: string }>(`pty:${taskId}:exit`, () => {
        if (!cancelled) {
          setStatus('stopped')
          setPid(null)
        }
      })
      if (!cancelled) {
        unlistenRef.current = unlisten
      } else {
        unlisten()
      }
    }

    void setupListener()

    return () => {
      cancelled = true
      unlistenRef.current?.()
      unlistenRef.current = null
    }
  }, [taskId])

  const startAgent = useCallback(async () => {
    if (!workingDir) return

    const info = await invoke<AgentInfo>('start_agent', {
      taskId,
      agentType,
      workingDir,
      cliPath,
    })

    setStatus('running')
    setPid(info.pid)
    return info
  }, [taskId, agentType, workingDir, cliPath])

  const stopAgent = useCallback(async () => {
    await invoke('stop_agent', { taskId })
  }, [taskId])

  const forceStopAgent = useCallback(async () => {
    await invoke('force_stop_agent', { taskId })
    setStatus('stopped')
    setPid(null)
  }, [taskId])

  return {
    status,
    pid,
    startAgent,
    stopAgent,
    forceStopAgent,
  }
}
