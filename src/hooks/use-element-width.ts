import { createContext, useCallback, useContext, useRef, useState } from 'react'

/**
 * Measure an element's content-box width via ResizeObserver. Returns a callback
 * ref to attach and the live width in px (0 until first measurement).
 *
 * Callback-ref form (not useRef) so it re-observes if the node remounts, and so
 * the first measurement lands synchronously on attach — no layout flash.
 */
export function useElementWidth(): [(node: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState(0)
  const observerRef = useRef<ResizeObserver | null>(null)

  const ref = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!node) return

    // No ResizeObserver (old webview / jsdom): measure once, skip live updates.
    if (typeof ResizeObserver === 'undefined') {
      setWidth(node.getBoundingClientRect().width)
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const w = entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width
      setWidth(w)
    })
    observer.observe(node)
    observerRef.current = observer
    setWidth(node.getBoundingClientRect().width)
  }, [])

  return [ref, width]
}

/**
 * Responsive density tier for panel headers. Two-stage collapse:
 * - `regular`: text labels + all icons visible (roomy).
 * - `compact`: icons only, controls still inline (tight).
 * - `mini`: icons for tabs; secondary controls fold into the overflow menu.
 *
 * Width 0 (pre-measurement) resolves to `regular` to avoid a collapsed flash on
 * mount before the observer reports.
 */
export type PanelDensity = 'regular' | 'compact' | 'mini'

/**
 * Map a measured header width to a density tier. Thresholds are per-header
 * because the labelled layouts differ in width: the agent header (4 tab labels +
 * runtime label + Hold) needs ~640px before its labels fit, while the chef
 * header (3 short tabs) fits around ~480px. The breakpoint must sit at or above
 * the labelled layout's natural width — otherwise the row stays "regular" while
 * flexbox truncates/clips it on the way down.
 */
export function panelDensity(
  width: number,
  { compactBelow = 640, miniBelow = 360 }: { compactBelow?: number; miniBelow?: number } = {},
): PanelDensity {
  if (width === 0) return 'regular'
  if (width < miniBelow) return 'mini'
  if (width < compactBelow) return 'compact'
  return 'regular'
}

/**
 * Provided by `PanelHeader` (which measures its controls row) and consumed by
 * header controls — tabs, runtime toggle, hold, overflow — so they collapse in
 * step without each measuring on their own.
 */
export const PanelDensityContext = createContext<PanelDensity>('regular')

export function usePanelDensity(): PanelDensity {
  return useContext(PanelDensityContext)
}
