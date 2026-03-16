/**
 * Collapsible details dropdown - shows thinking + tool calls after completion.
 * Header shows: "Details (3 tools, 2.1s)"
 * Expands to show thinking content and tool calls list.
 */

import { useState, memo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ToolCallItem, type ToolCallData } from './tool-call-item'

type CollapsibleDetailsProps = {
  thinking?: string
  toolCalls?: ToolCallData[]
  duration: number // Time taken in seconds
  defaultOpen?: boolean
}

export const CollapsibleDetails = memo(function CollapsibleDetails({
  thinking,
  toolCalls = [],
  duration,
  defaultOpen = false,
}: CollapsibleDetailsProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  const hasThinking = !!thinking && thinking.length > 0
  const hasToolCalls = toolCalls.length > 0

  // Nothing to show
  if (!hasThinking && !hasToolCalls) return null

  // Build summary text
  const parts: string[] = []
  if (hasToolCalls) {
    parts.push(`${toolCalls.length} tool${toolCalls.length > 1 ? 's' : ''}`)
  }
  if (duration > 0) {
    parts.push(`${duration.toFixed(1)}s`)
  }
  const summary = parts.length > 0 ? parts.join(', ') : 'Details'

  return (
    <div className="border-l-2 border-border-default pl-2 text-xs">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-text-secondary hover:text-text-primary transition-colors w-full"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
        >
          <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
        <span>Details ({summary})</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-2">
              {/* Thinking content */}
              {hasThinking && (
                <div className="space-y-1">
                  <span className="text-text-secondary/60 italic">Thinking:</span>
                  <p className="text-text-secondary/80 whitespace-pre-wrap pl-2 border-l border-accent/20">
                    {thinking}
                  </p>
                </div>
              )}

              {/* Tool calls */}
              {hasToolCalls && (
                <div className="space-y-1">
                  <span className="text-text-secondary/60">Tools:</span>
                  <div className="space-y-1">
                    {toolCalls.map((tc) => (
                      <ToolCallItem key={tc.toolId} toolCall={tc} showInput />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
