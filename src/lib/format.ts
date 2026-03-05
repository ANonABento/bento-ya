// Centralized formatting utilities
// Single source of truth for all formatting functions used across the app

// ─── Cost & Token Formatting ────────────────────────────────────────────────

/**
 * Format a USD cost value for display
 * Examples: "<$0.01", "$0.50", "$12.34"
 */
export function formatCost(usd: number): string {
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

/**
 * Format a token count with K/M suffixes
 * Examples: "500", "1.5K", "2.3M"
 */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return String(count)
}

// ─── Date Formatting ────────────────────────────────────────────────────────

/**
 * Format a duration in milliseconds to a human-readable string
 * Examples: "500ms", "2.5s", "3m 45s", "1h 30m"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`

  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)

  if (mins < 60) {
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
  }

  const hours = Math.floor(mins / 60)
  const remainingMins = mins % 60
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`
}

/**
 * Format an ISO date string to a relative time
 * Examples: "now", "5m", "2h", "3d", "Jan 5"
 */
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'now'
  if (diffMins < 60) return `${diffMins}m`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays < 7) return `${diffDays}d`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * Format an ISO date string to a short date
 * Examples: "Jan 5", "Dec 31"
 */
export function formatShortDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Format an ISO date string to a friendly date with time
 * Examples: "Today at 3:45 PM", "Yesterday at 10:30 AM", "Monday at 2:00 PM"
 */
export function formatDateWithTime(isoDate: string): string {
  const date = new Date(isoDate)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

  if (diffDays === 0) {
    return `Today at ${timeStr}`
  } else if (diffDays === 1) {
    return `Yesterday at ${timeStr}`
  } else if (diffDays < 7) {
    const weekday = date.toLocaleDateString('en-US', { weekday: 'long' })
    return `${weekday} at ${timeStr}`
  }
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${dateStr} at ${timeStr}`
}

/**
 * Format a timestamp (seconds since epoch) to a relative date
 * Examples: "Today", "Yesterday", "3d ago", "Jan 5"
 */
export function formatTimestampDate(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ─── Number Formatting ──────────────────────────────────────────────────────

/**
 * Format a number with K/M suffixes
 * Examples: "500", "1.5K", "1.5M"
 */
export function formatCompactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
