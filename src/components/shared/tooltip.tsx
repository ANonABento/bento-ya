import { useState, useRef, useEffect, useLayoutEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'

type TooltipProps = {
  content: string
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
  wrap?: boolean
}

type Position = {
  top: number
  left: number
}

export function Tooltip({ content, children, side = 'top', delay = 100, wrap = false }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 })
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const showTooltip = () => {
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true)
    }, delay)
  }

  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setIsVisible(false)
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  // Calculate and adjust position after tooltip renders
  useLayoutEffect(() => {
    if (!isVisible || !tooltipRef.current || !triggerRef.current) return

    const trigger = triggerRef.current.getBoundingClientRect()
    const tooltip = tooltipRef.current.getBoundingClientRect()
    const padding = 8

    let top = 0
    let left = 0

    // Calculate base position
    switch (side) {
      case 'top':
        top = trigger.top - tooltip.height - 8
        left = trigger.left + trigger.width / 2 - tooltip.width / 2
        break
      case 'bottom':
        top = trigger.bottom + 8
        left = trigger.left + trigger.width / 2 - tooltip.width / 2
        break
      case 'left':
        top = trigger.top + trigger.height / 2 - tooltip.height / 2
        left = trigger.left - tooltip.width - 8
        break
      case 'right':
        top = trigger.top + trigger.height / 2 - tooltip.height / 2
        left = trigger.right + 8
        break
    }

    // Adjust horizontal overflow
    if (left + tooltip.width > window.innerWidth - padding) {
      left = window.innerWidth - tooltip.width - padding
    }
    if (left < padding) {
      left = padding
    }

    // Adjust vertical overflow
    if (top + tooltip.height > window.innerHeight - padding) {
      top = window.innerHeight - tooltip.height - padding
    }
    if (top < padding) {
      top = padding
    }

    setPosition({ top, left })
  }, [isVisible, side])

  const animationOrigin = {
    top: { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 } },
    bottom: { initial: { opacity: 0, y: -4 }, animate: { opacity: 1, y: 0 } },
    left: { initial: { opacity: 0, x: 4 }, animate: { opacity: 1, x: 0 } },
    right: { initial: { opacity: 0, x: -4 }, animate: { opacity: 1, x: 0 } },
  }

  return (
    <div
      ref={triggerRef}
      className="inline-flex"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onClick={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}
      {createPortal(
        <AnimatePresence>
          {isVisible && (
            <motion.div
              ref={tooltipRef}
              initial={animationOrigin[side].initial}
              animate={animationOrigin[side].animate}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              style={{
                position: 'fixed',
                top: position.top,
                left: position.left,
              }}
              className={`z-[9999] rounded-md bg-text-primary px-2 py-1 text-xs font-medium text-bg shadow-lg ${wrap ? 'whitespace-pre-wrap max-w-xs' : 'whitespace-nowrap'}`}
            >
              {content}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}
