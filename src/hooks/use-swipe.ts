import { useEffect, useRef, useCallback } from 'react'

type SwipeDirection = 'left' | 'right'
type SwipeCallback = (direction: SwipeDirection) => void

const SWIPE_THRESHOLD = 50 // Minimum distance for a swipe
const SWIPE_VELOCITY_THRESHOLD = 0.3 // Minimum velocity (px/ms)

export function useSwipe(callback: SwipeCallback, enabled = true) {
  const startX = useRef<number>(0)
  const startTime = useRef<number>(0)
  const isTracking = useRef(false)

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length !== 2) return // Two-finger only
    const touch = e.touches[0]
    if (!touch) return
    startX.current = touch.clientX
    startTime.current = Date.now()
    isTracking.current = true
  }, [])

  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (!isTracking.current) return
      isTracking.current = false

      const endX = e.changedTouches[0]?.clientX ?? startX.current
      const deltaX = endX - startX.current
      const deltaTime = Date.now() - startTime.current
      const velocity = Math.abs(deltaX) / deltaTime

      if (Math.abs(deltaX) >= SWIPE_THRESHOLD && velocity >= SWIPE_VELOCITY_THRESHOLD) {
        callback(deltaX > 0 ? 'right' : 'left')
      }
    },
    [callback],
  )

  // Trackpad scroll (wheel event with deltaX)
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      // Detect horizontal scroll from trackpad (two-finger swipe)
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > SWIPE_THRESHOLD) {
        // Debounce: only trigger once per gesture
        e.preventDefault()
        callback(e.deltaX > 0 ? 'left' : 'right')
      }
    },
    [callback],
  )

  useEffect(() => {
    if (!enabled) return

    const el = document.documentElement

    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchend', handleTouchEnd, { passive: true })
    // Use passive: false to allow preventDefault on wheel
    el.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchend', handleTouchEnd)
      el.removeEventListener('wheel', handleWheel)
    }
  }, [enabled, handleTouchStart, handleTouchEnd, handleWheel])
}

export function useSwipeNavigation(
  onPrev: () => void,
  onNext: () => void,
  enabled = true,
) {
  const lastSwipeTime = useRef(0)
  const DEBOUNCE_MS = 300

  const handleSwipe = useCallback(
    (direction: SwipeDirection) => {
      const now = Date.now()
      if (now - lastSwipeTime.current < DEBOUNCE_MS) return
      lastSwipeTime.current = now

      if (direction === 'right') {
        onPrev()
      } else {
        onNext()
      }
    },
    [onPrev, onNext],
  )

  useSwipe(handleSwipe, enabled)
}
