/**
 * Hook that listens for backend entity-mutation events and re-fetches the
 * relevant store. Entities (workspaces, columns, scripts) have no optimistic
 * sync the way tasks do, so when they're created/changed out of band — e.g. by
 * MCP or the chef/orchestrator — this keeps the UI in sync without a reload.
 *
 * Mirrors `useTaskSync`, but for the `entities:changed` channel.
 */

import { useEffect, useRef } from 'react'
import { listen, type UnlistenFn } from '@/lib/ipc'
import { useColumnStore } from '@/stores/column-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useScriptStore } from '@/stores/script-store'

type EntityKind = 'workspace' | 'column' | 'script'

type EntitiesChangedPayload = {
  workspaceId: string
  kind: EntityKind
}

export function useEntitySync(workspaceId: string | null) {
  const loadColumns = useColumnStore((s) => s.load)
  const loadWorkspaces = useWorkspaceStore((s) => s.load)
  const reloadScripts = useScriptStore((s) => s.reload)
  const unlistenRef = useRef<UnlistenFn | null>(null)

  useEffect(() => {
    let cancelled = false

    void listen<EntitiesChangedPayload>('entities:changed', (payload) => {
      if (cancelled) return
      switch (payload.kind) {
        case 'workspace':
          void loadWorkspaces()
          break
        case 'column':
          // Only reload columns for the active workspace's board.
          if (workspaceId && payload.workspaceId === workspaceId) {
            void loadColumns(workspaceId)
          }
          break
        case 'script':
          void reloadScripts()
          break
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
  }, [workspaceId, loadColumns, loadWorkspaces, reloadScripts])
}
