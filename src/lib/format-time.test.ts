import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { formatDuration, formatRelativeTime, formatDateWithTime, formatShortDate } from './format-time'

describe('format-time utilities', () => {
  describe('formatDuration', () => {
    it('formats milliseconds under 1 second', () => {
      expect(formatDuration(0)).toBe('0ms')
      expect(formatDuration(500)).toBe('500ms')
      expect(formatDuration(999)).toBe('999ms')
    })

    it('formats seconds with decimal for short durations', () => {
      expect(formatDuration(2500)).toBe('2.5s')
      expect(formatDuration(1500)).toBe('1.5s')
    })

    it('formats whole seconds without decimal for longer durations', () => {
      expect(formatDuration(10000)).toBe('10s')
      expect(formatDuration(30000)).toBe('30s')
      expect(formatDuration(59000)).toBe('59s')
    })

    it('formats minutes and seconds', () => {
      expect(formatDuration(60000)).toBe('1m')
      expect(formatDuration(90000)).toBe('1m 30s')
      expect(formatDuration(125000)).toBe('2m 5s')
    })

    it('formats hours and minutes', () => {
      expect(formatDuration(3600000)).toBe('1h')
      expect(formatDuration(5400000)).toBe('1h 30m')
      expect(formatDuration(7200000)).toBe('2h')
    })
  })

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-03-05T12:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns "now" for recent times', () => {
      const now = new Date().toISOString()
      expect(formatRelativeTime(now)).toBe('now')

      const tenSecondsAgo = new Date(Date.now() - 10000).toISOString()
      expect(formatRelativeTime(tenSecondsAgo)).toBe('now')
    })

    it('formats minutes ago', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      expect(formatRelativeTime(fiveMinutesAgo)).toBe('5m')

      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
      expect(formatRelativeTime(thirtyMinutesAgo)).toBe('30m')
    })

    it('formats hours ago', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      expect(formatRelativeTime(twoHoursAgo)).toBe('2h')

      const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString()
      expect(formatRelativeTime(tenHoursAgo)).toBe('10h')
    })

    it('formats days ago', () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      expect(formatRelativeTime(oneDayAgo)).toBe('1d')

      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
      expect(formatRelativeTime(threeDaysAgo)).toBe('3d')
    })

    it('formats older dates as short date', () => {
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
      const result = formatRelativeTime(twoWeeksAgo)
      expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/) // "Feb 20" format
    })
  })

  describe('formatDateWithTime', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-03-05T12:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('formats today with time', () => {
      const today = '2024-03-05T15:45:00Z'
      const result = formatDateWithTime(today)
      expect(result).toContain('Today at')
    })

    it('formats yesterday with time', () => {
      const yesterday = '2024-03-04T10:30:00Z'
      const result = formatDateWithTime(yesterday)
      expect(result).toContain('Yesterday at')
    })

    it('formats older dates with date and time', () => {
      const older = '2024-03-01T14:00:00Z'
      const result = formatDateWithTime(older)
      expect(result).toContain('Mar 1')
      expect(result).toContain('at')
    })
  })

  describe('formatShortDate', () => {
    it('formats date as "Month Day"', () => {
      // Use noon UTC to avoid timezone date boundary issues
      expect(formatShortDate('2024-03-05T12:00:00Z')).toBe('Mar 5')
      expect(formatShortDate('2024-12-31T12:00:00Z')).toBe('Dec 31')
      expect(formatShortDate('2024-01-01T12:00:00Z')).toBe('Jan 1')
    })
  })
})
