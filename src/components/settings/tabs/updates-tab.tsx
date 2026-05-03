import { useState, useCallback, useEffect } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { checkForUpdate, installUpdate, type UpdateInfo } from '@/lib/ipc/updater'

type CheckState = 'idle' | 'checking' | 'up-to-date' | 'available' | 'installing' | 'error'

// Tauri IPC errors can arrive as plain strings, AppError objects, or wrapped JSON.
// Falling back to String(err) renders "[object Object]" — this handles each shape.
function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.error === 'string') return obj.error
    try {
      return JSON.stringify(err)
    } catch {
      return 'Unknown error'
    }
  }
  return String(err)
}

export function UpdatesTab() {
  const [state, setState] = useState<CheckState>('idle')
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => { /* non-critical */ })
  }, [])

  const handleCheck = useCallback(() => {
    setState('checking')
    setError(null)
    setUpdate(null)
    checkForUpdate()
      .then((result) => {
        if (result) {
          setUpdate(result)
          setState('available')
        } else {
          setState('up-to-date')
        }
      })
      .catch((err: unknown) => {
        setError(formatErr(err))
        setState('error')
      })
  }, [])

  const handleInstall = useCallback(() => {
    setState('installing')
    setError(null)
    installUpdate().catch((err: unknown) => {
      setError(formatErr(err))
      setState('error')
    })
  }, [])

  const installing = state === 'installing'

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Application Updates</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Current version</p>
              <p className="text-xs text-text-secondary font-mono">{currentVersion ?? '—'}</p>
            </div>
            <button
              onClick={handleCheck}
              disabled={state === 'checking' || state === 'installing'}
              className="rounded px-3 py-1.5 text-sm font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {state === 'checking' ? 'Checking…' : 'Check for Updates'}
            </button>
          </div>

          {state === 'up-to-date' && (
            <div className="rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-secondary">
              You're on the latest version.
            </div>
          )}

          {state === 'available' && update && (
            <div className="rounded-md border border-accent/30 bg-accent/5 px-3 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    Version {update.version} available
                  </p>
                  {update.date && (
                    <p className="text-xs text-text-secondary">{update.date}</p>
                  )}
                </div>
                <button
                  onClick={handleInstall}
                  disabled={installing}
                  className="rounded px-3 py-1.5 text-sm font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
                >
                  {installing ? 'Installing…' : 'Install & Restart'}
                </button>
              </div>
              {update.body && (
                <p className="text-xs text-text-secondary whitespace-pre-wrap">{update.body}</p>
              )}
            </div>
          )}

          {state === 'installing' && (
            <div className="rounded-md border border-border-default bg-surface px-3 py-2 text-sm text-text-secondary">
              Downloading and installing update…
            </div>
          )}

          {state === 'error' && error && (
            <div className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
