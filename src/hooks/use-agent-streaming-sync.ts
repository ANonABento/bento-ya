/**
 * Global hook that routes agent events to the streaming store.
 * Mount once in App.tsx — all task cards read from the store.
 */

import { useEffect, useRef } from 'react'
import * as ipc from '@/lib/ipc'
import { useAgentStreamingStore } from '@/stores/agent-streaming-store'

export function useAgentStreamingSync() {
  const appendContent = useAgentStreamingStore((s) => s.appendContent)
  const appendThinking = useAgentStreamingStore((s) => s.appendThinking)
  const updateTool = useAgentStreamingStore((s) => s.updateTool)
  const complete = useAgentStreamingStore((s) => s.complete)

  const unlistenRefs = useRef<Array<() => void>>([])

  useEffect(() => {
    let cancelled = false

    const setup = async () => {
      const unlistenStream = await ipc.onAgentStream((payload) => {
        if (cancelled) return
        appendContent(payload.taskId, payload.content)
      })

      const unlistenThinking = await ipc.onAgentThinking((payload) => {
        if (cancelled) return
        if (!payload.isComplete) {
          appendThinking(payload.taskId, payload.content)
        }
      })

      const unlistenToolCall = await ipc.onAgentToolCall((payload) => {
        if (cancelled) return
        updateTool(payload.taskId, payload.toolId, payload.toolName, payload.status)
      })

      const unlistenComplete = await ipc.onAgentComplete((payload) => {
        if (cancelled) return
        complete(payload.taskId)
      })

      if (cancelled) {
        unlistenStream()
        unlistenThinking()
        unlistenToolCall()
        unlistenComplete()
      } else {
        unlistenRefs.current = [unlistenStream, unlistenThinking, unlistenToolCall, unlistenComplete]
      }
    }

    void setup()

    return () => {
      cancelled = true
      unlistenRefs.current.forEach((fn) => { fn() })
      unlistenRefs.current = []
    }
  }, [appendContent, appendThinking, updateTool, complete])
}
