/**
 * Time and duration formatting utilities.
 */

/**
 * Format a duration in milliseconds to a human-readable string.
 * @example formatDuration(500) -> "500ms"
 * @example formatDuration(2500) -> "2.5s"
 * @example formatDuration(125000) -> "2m 5s"
 * @example formatDuration(5400000) -> "1h 30m"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }

  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) {
    const decimal = ms % 1000
    if (decimal > 0 && seconds < 10) {
      return `${(ms / 1000).toFixed(1)}s`
    }
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) {
    if (remainingSeconds > 0) {
      return `${minutes}m ${remainingSeconds}s`
    }
    return `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (remainingMinutes > 0) {
    return `${hours}h ${remainingMinutes}m`
  }
  return `${hours}h`
}

/**
 * Format a date to a short relative time string.
 * @example formatRelativeTime(now) -> "now"
 * @example formatRelativeTime(5minAgo) -> "5m"
 * @example formatRelativeTime(2hoursAgo) -> "2h"
 * @example formatRelativeTime(3daysAgo) -> "3d"
 * @example formatRelativeTime(oldDate) -> "Jan 5"
 */
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) {
    return 'now'
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m`
  }
  if (diffHours < 24) {
    return `${diffHours}h`
  }
  if (diffDays < 7) {
    return `${diffDays}d`
  }

  // For older dates, show "Jan 5" format
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Format a date to "Today at 3:45 PM" or "Yesterday at 10:30 AM" or "Jan 5 at 2:15 PM".
 */
export function formatDateWithTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = date.toDateString() === yesterday.toDateString()

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  if (isToday) {
    return `Today at ${timeStr}`
  }
  if (isYesterday) {
    return `Yesterday at ${timeStr}`
  }

  const datePartStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
  return `${datePartStr} at ${timeStr}`
}

/**
 * Format a short date like "Jan 5" or "Dec 31".
 */
export function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
