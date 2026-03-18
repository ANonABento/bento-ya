/** Extract a human-readable error message from various error shapes (Error, string, Tauri objects). */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    if ('message' in err && typeof err.message === 'string') return err.message
    try {
      return JSON.stringify(err)
    } catch {
      return 'Unknown error'
    }
  }
  return String(err)
}
