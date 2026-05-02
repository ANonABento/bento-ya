import { useEffect, useRef } from 'react'
import { listen, type UnlistenFn } from '@/lib/ipc'
import { useLabelStore } from '@/stores/label-store'

type LabelsChangedPayload = {
  workspaceId: string
  reason: string
}

export function useLabelSync(workspaceId: string | null) {
  const loadLabels = useLabelStore((s) => s.load)
  const unlistenRef = useRef<UnlistenFn | null>(null)

  useEffect(() => {
    if (!workspaceId) return

    let cancelled = false

    void listen<LabelsChangedPayload>('labels:changed', (payload) => {
      if (cancelled) return
      if (payload.workspaceId === workspaceId) {
        void loadLabels(workspaceId)
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten()
      } else {
        unlistenRef.current = unlisten
      }
    })

    return () => {
      cancelled = true
      unlistenRef.current?.()
      unlistenRef.current = null
    }
  }, [workspaceId, loadLabels])
}
