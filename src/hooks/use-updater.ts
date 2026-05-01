import { useState, useCallback, useEffect } from 'react'
import { checkForUpdate, installUpdate, type UpdateInfo } from '@/lib/ipc/updater'

export type UseUpdaterResult = {
  pendingUpdate: UpdateInfo | null
  dismissed: boolean
  installing: boolean
  error: string | null
  dismiss: () => void
  install: () => void
}

export function useUpdater(): UseUpdaterResult {
  const [pendingUpdate, setPendingUpdate] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    checkForUpdate()
      .then((info) => { if (info) setPendingUpdate(info) })
      .catch(() => { /* ignore update check failures silently */ })
  }, [])

  const install = useCallback(() => {
    setInstalling(true)
    setError(null)
    installUpdate()
      .then(() => { /* app restarts on success */ })
      .catch((err: unknown) => {
        setInstalling(false)
        setError(err instanceof Error ? err.message : 'Update failed')
      })
  }, [])

  const dismiss = useCallback(() => { setDismissed(true) }, [])

  return { pendingUpdate, dismissed, installing, error, dismiss, install }
}
