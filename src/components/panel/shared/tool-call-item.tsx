/**
 * Tool call display item - shows a single tool call with status.
 * Used in both streaming view and collapsible details.
 */

import { memo } from 'react'

export type ToolCallStatus = 'running' | 'complete' | 'error'

export type ToolCallData = {
  toolId: string
  toolName: string
  status: ToolCallStatus
  input?: Record<string, unknown>
}

type ToolCallItemProps = {
  toolCall: ToolCallData
  showInput?: boolean
}

export const ToolCallItem = memo(function ToolCallItem({ toolCall, showInput = false }: ToolCallItemProps) {
  const { toolName, status, input } = toolCall

  return (
    <div className="flex items-start gap-2 text-xs rounded bg-bg/50 px-2 py-1">
      <StatusIcon status={status} />
      <div className="flex-1 min-w-0">
        <span className="font-mono text-text-secondary">{toolName}</span>
        {showInput && input && (
          <InputPreview input={input} />
        )}
      </div>
    </div>
  )
})

function StatusIcon({ status }: { status: ToolCallStatus }) {
  if (status === 'running') {
    return (
      <svg className="h-3 w-3 animate-spin text-accent shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    )
  }

  if (status === 'complete') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 text-green-400 shrink-0 mt-0.5">
        <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
      </svg>
    )
  }

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 text-red-400 shrink-0 mt-0.5">
      <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm2.78-4.22a.75.75 0 0 1-1.06 0L8 9.06l-1.72 1.72a.75.75 0 1 1-1.06-1.06L6.94 8 5.22 6.28a.75.75 0 0 1 1.06-1.06L8 6.94l1.72-1.72a.75.75 0 1 1 1.06 1.06L9.06 8l1.72 1.72a.75.75 0 0 1 0 1.06Z" clipRule="evenodd" />
    </svg>
  )
}

function InputPreview({ input }: { input: Record<string, unknown> }) {
  // Show a preview of the input - first key/value or truncated
  const entries = Object.entries(input)
  if (entries.length === 0) return null

  const [key, value] = entries[0]!
  const preview = typeof value === 'string'
    ? value.length > 40 ? `${value.slice(0, 40)}...` : value
    : JSON.stringify(value).slice(0, 40)

  return (
    <div className="mt-0.5 text-text-secondary/60 truncate">
      {key}: {preview}
    </div>
  )
}
