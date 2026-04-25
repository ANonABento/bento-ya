import { useEffect, useState } from 'react'

type ProcessingIndicatorProps = {
  startTime: number | null
}

export function ProcessingIndicator({ startTime }: ProcessingIndicatorProps) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startTime) {
      setElapsed(0)
      return
    }

    const tick = () => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }

    tick()
    const interval = window.setInterval(tick, 1000)
    return () => {
      window.clearInterval(interval)
    }
  }, [startTime])

  return (
    <span className="flex items-center gap-1 text-xs text-accent">
      <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Thinking{elapsed > 0 ? `... ${String(elapsed)}s` : '...'}
    </span>
  )
}
