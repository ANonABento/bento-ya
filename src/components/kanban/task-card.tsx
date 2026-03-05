import { memo, useMemo, useState, useCallback } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Task, PipelineState } from '@/types'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { useUIStore } from '@/stores/ui-store'
import { useAttentionStore, ATTENTION_LABELS } from '@/stores/attention-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useColumnStore } from '@/stores/column-store'
import { useTaskStore } from '@/stores/task-store'
import { TaskContextMenu } from './task-context-menu'
import { TaskQuickActions } from './task-quick-actions'
import * as ipc from '@/lib/ipc'

type TaskCardProps = {
  task: Task
}

const PIPELINE_LABELS: Record<PipelineState, string> = {
  idle: '',
  triggered: 'Starting',
  running: 'Running',
  evaluating: 'Checking',
  advancing: 'Moving',
}

// Helper to format relative time
function formatRelativeTime(dateStr: string): string {
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
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Get agent activity text based on status and pipeline state
function getAgentActivity(task: Task): { text: string; type: 'active' | 'waiting' | 'idle' | 'error' } | null {
  // Don't show activity if no agent status
  if (!task.agentStatus) return null

  // Error state takes priority
  if (task.agentStatus === 'failed' || task.pipelineError) {
    return { text: task.pipelineError || 'Agent failed', type: 'error' }
  }

  // Needs attention
  if (task.agentStatus === 'needs_attention') {
    return { text: 'Waiting for input...', type: 'waiting' }
  }

  // Running states
  if (task.agentStatus === 'running') {
    switch (task.pipelineState) {
      case 'triggered':
        return { text: 'Starting up...', type: 'active' }
      case 'running':
        return { text: 'Agent working...', type: 'active' }
      case 'evaluating':
        return { text: 'Checking results...', type: 'active' }
      case 'advancing':
        return { text: 'Moving to next step...', type: 'active' }
      default:
        return { text: 'Agent running', type: 'active' }
    }
  }

  // Completed
  if (task.agentStatus === 'completed') {
    return { text: 'Completed', type: 'idle' }
  }

  // Stopped/idle - only show if recently updated
  if (task.agentStatus === 'stopped') {
    const updatedMs = new Date(task.updatedAt).getTime()
    const nowMs = new Date().getTime()
    const hourAgo = 60 * 60 * 1000
    // Only show "idle" if updated within the last hour
    if (nowMs - updatedMs < hourAgo) {
      return { text: 'Agent idle', type: 'idle' }
    }
  }

  return null
}

// Compact PR status indicator
function PrStatusIndicator({ task, settings }: { task: Task; settings: typeof DEFAULT_SETTINGS.cards }) {
  if (!task.prNumber) return null

  const showAny = settings.showPrBadge || settings.showCiStatus || settings.showReviewStatus || settings.showMergeStatus

  if (!showAny) return null

  // Determine the most important status to show
  const hasConflict = task.prMergeable === 'conflicted'
  const hasCiFail = task.prCiStatus === 'failure' || task.prCiStatus === 'error'
  const hasChangesRequested = task.prReviewDecision === 'changes_requested'
  const isApproved = task.prReviewDecision === 'approved'
  const ciPending = task.prCiStatus === 'pending'
  const ciSuccess = task.prCiStatus === 'success'

  // Priority: conflict > ci fail > changes requested > ci pending > approved > success
  let statusColor = 'text-text-secondary'
  let statusIcon = null

  if (settings.showMergeStatus && hasConflict) {
    statusColor = 'text-error'
    statusIcon = (
      <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
        <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z" />
      </svg>
    )
  } else if (settings.showCiStatus && hasCiFail) {
    statusColor = 'text-error'
    statusIcon = (
      <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
        <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm2.78-4.22a.75.75 0 0 1-1.06 0L8 9.06l-1.72 1.72a.75.75 0 1 1-1.06-1.06L6.94 8 5.22 6.28a.75.75 0 0 1 1.06-1.06L8 6.94l1.72-1.72a.75.75 0 1 1 1.06 1.06L9.06 8l1.72 1.72a.75.75 0 0 1 0 1.06Z" clipRule="evenodd" />
      </svg>
    )
  } else if (settings.showReviewStatus && hasChangesRequested) {
    statusColor = 'text-warning'
    statusIcon = (
      <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
        <path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
      </svg>
    )
  } else if (settings.showCiStatus && ciPending) {
    statusColor = 'text-warning'
    statusIcon = (
      <svg className="h-3 w-3 animate-spin" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="7" />
      </svg>
    )
  } else if (settings.showReviewStatus && isApproved) {
    statusColor = 'text-success'
    statusIcon = (
      <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
        <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm3.844-8.791a.75.75 0 0 0-1.188-.918l-3.7 4.79-1.649-1.833a.75.75 0 1 0-1.114 1.004l2.25 2.5a.75.75 0 0 0 1.151-.043l4.25-5.5Z" clipRule="evenodd" />
      </svg>
    )
  } else if (settings.showCiStatus && ciSuccess) {
    statusColor = 'text-success'
    statusIcon = (
      <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
        <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm3.844-8.791a.75.75 0 0 0-1.188-.918l-3.7 4.79-1.649-1.833a.75.75 0 1 0-1.114 1.004l2.25 2.5a.75.75 0 0 0 1.151-.043l4.25-5.5Z" clipRule="evenodd" />
      </svg>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1 ${statusColor}`}>
      <svg className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
      </svg>
      <span className="text-[11px]">#{task.prNumber}</span>
      {statusIcon}
    </span>
  )
}

// Siege loop badge indicator
function SiegeBadge({ task }: { task: Task }) {
  if (!task.siegeActive) return null

  return (
    <span className="inline-flex items-center gap-1 text-accent">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
      <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
        <path fillRule="evenodd" d="M8 1a3.5 3.5 0 0 0-3.5 3.5c0 1.57.75 2.4 1.5 2.8V8h.75v2.25H5v1.5h1.75V15h2.5v-3.25H11v-1.5H9.25V8h.75v-.7c.75-.4 1.5-1.23 1.5-2.8A3.5 3.5 0 0 0 8 1Zm0 1.5a2 2 0 0 0-2 2c0 .94.5 1.5 1 1.75V7h2v-.75c.5-.25 1-.81 1-1.75a2 2 0 0 0-2-2Z" clipRule="evenodd" />
      </svg>
      <span className="text-[11px] font-medium">
        {task.siegeIteration}/{task.siegeMaxIterations}
      </span>
    </span>
  )
}

export const TaskCard = memo(function TaskCard({ task }: TaskCardProps) {
  const openTask = useUIStore((s) => s.openTask)
  const hasAttention = useAttentionStore((s) => s.hasAttention(task.id))
  const attention = useAttentionStore((s) => s.getAttention(task.id))
  const markViewed = useAttentionStore((s) => s.markViewed)
  const cardSettings = useSettingsStore((s) => s.global.cards) ?? DEFAULT_SETTINGS.cards

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const columns = useColumnStore((s) => s.columns)
  const moveTask = useTaskStore((s) => s.move)
  const removeTask = useTaskStore((s) => s.remove)
  const duplicateTask = useTaskStore((s) => s.duplicate)
  const updateTask = useTaskStore((s) => s.updateTask)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: 'task' },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  // Parse labels from JSON string
  const labels = useMemo(() => {
    try {
      return JSON.parse(task.prLabels || '[]') as string[]
    } catch {
      return []
    }
  }, [task.prLabels])

  function handleClick() {
    if (hasAttention) {
      markViewed(task.id)
    }
    openTask(task.id)
  }

  function handlePrClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (task.prUrl) {
      window.open(task.prUrl, '_blank')
    }
  }

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const handleMoveToColumn = useCallback((columnId: string) => {
    void moveTask(task.id, columnId, 0)
  }, [task.id, moveTask])

  const handleRunAgent = useCallback(() => {
    updateTask(task.id, { agentStatus: 'running' })
  }, [task.id, updateTask])

  const handleStopAgent = useCallback(() => {
    updateTask(task.id, { agentStatus: 'stopped' })
  }, [task.id, updateTask])

  const handleStartSiege = useCallback(async () => {
    try {
      const result = await ipc.startSiege(task.id)
      updateTask(task.id, {
        siegeActive: result.task.siegeActive,
        siegeIteration: result.task.siegeIteration,
        siegeMaxIterations: result.task.siegeMaxIterations,
      })
    } catch (err) {
      console.error('Failed to start siege:', err)
    }
  }, [task.id, updateTask])

  const handleStopSiege = useCallback(async () => {
    try {
      const result = await ipc.stopSiege(task.id)
      updateTask(task.id, {
        siegeActive: result.siegeActive,
        siegeIteration: result.siegeIteration,
      })
    } catch (err) {
      console.error('Failed to stop siege:', err)
    }
  }, [task.id, updateTask])

  const handleArchiveTask = useCallback(() => {
    // For now, just remove - could add archive column later
    void removeTask(task.id)
  }, [task.id, removeTask])

  const handleDeleteTask = useCallback(() => {
    void removeTask(task.id)
  }, [task.id, removeTask])

  const handleDuplicateTask = useCallback(() => {
    void duplicateTask(task.id)
  }, [task.id, duplicateTask])

  const handleToggleAgent = useCallback(() => {
    if (task.agentStatus === 'running') {
      updateTask(task.id, { agentStatus: 'stopped' })
    } else {
      updateTask(task.id, { agentStatus: 'running' })
    }
  }, [task.id, task.agentStatus, updateTask])

  const handleShowMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const needsAttention = hasAttention || task.agentStatus === 'needs_attention'
  const isPipelineActive = task.pipelineState !== 'idle'
  const hasPipelineError = !!task.pipelineError

  // Has any metadata to show
  const hasMetadata = (cardSettings.showBranch && task.branch) ||
    (cardSettings.showAgentType && task.agentType) ||
    (cardSettings.showTimestamp && !isPipelineActive) ||
    isPipelineActive ||
    task.siegeActive ||
    (cardSettings.showPrBadge && task.prNumber) ||
    (cardSettings.showCommentCount && task.prCommentCount > 0) ||
    (cardSettings.showLabels && labels.length > 0)

  return (
    <>
    <div
      ref={setNodeRef}
      style={{
        ...style,
        cursor: 'pointer',
        opacity: isDragging ? 0.4 : 1,
        transition: isDragging ? 'opacity 150ms' : 'transform 200ms ease, opacity 150ms',
      }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={(e) => {
        // Ignore if modifier keys are pressed (except for shortcuts that need them)
        if (e.metaKey || e.ctrlKey || e.altKey) return

        switch (e.key) {
          case 'Enter':
            e.preventDefault()
            handleClick()
            break
          case ' ':
            e.preventDefault()
            handleToggleAgent()
            break
          case 'd':
          case 'D':
            e.preventDefault()
            handleDuplicateTask()
            break
          case 'Delete':
          case 'Backspace':
            e.preventDefault()
            // Show context menu for confirmation before archive/delete
            const rect = e.currentTarget.getBoundingClientRect()
            setContextMenu({ x: rect.right - 180, y: rect.top })
            break
          case 'm':
          case 'M':
            e.preventDefault()
            // Show context menu for move options
            const moveRect = e.currentTarget.getBoundingClientRect()
            setContextMenu({ x: moveRect.right - 180, y: moveRect.top })
            break
        }
      }}
      tabIndex={0}
      className={`group relative rounded-lg border border-border-default bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent hover:border-accent/50 hover:bg-surface-hover ${isDragging ? 'z-0' : 'hover:z-10'}`}
    >
      {/* Quick actions on hover */}
      {!isDragging && (
        <TaskQuickActions
          task={task}
          onOpen={handleClick}
          onToggleAgent={handleToggleAgent}
          onShowMenu={handleShowMenu}
        />
      )}

      <div
        {...attributes}
        {...listeners}
        className="p-3 space-y-2"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        {/* Title row */}
        <div className="flex items-start gap-2">
          <h4 className="flex-1 text-sm font-medium text-text-primary leading-snug line-clamp-2">
            {task.title}
          </h4>
        </div>

        {/* Description */}
        {cardSettings.showDescription && task.description && (
          <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed">
            {task.description}
          </p>
        )}

        {/* Attention banner */}
        {needsAttention && attention && (
          <div className="flex items-center gap-1.5 rounded bg-attention/10 px-2 py-1 text-xs text-attention">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 shrink-0">
              <path fillRule="evenodd" d="M6.701 2.25c.577-1 2.02-1 2.598 0l5.196 9a1.5 1.5 0 0 1-1.299 2.25H2.804a1.5 1.5 0 0 1-1.3-2.25l5.197-9ZM8 5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 5Zm0 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
            </svg>
            <span className="truncate">{ATTENTION_LABELS[attention.reason]}</span>
          </div>
        )}

        {/* Pipeline error */}
        {hasPipelineError && (
          <div className="flex items-center gap-1.5 rounded bg-error/10 px-2 py-1 text-xs text-error">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 shrink-0">
              <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm.75-8.25a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 1.5 0v-3.5ZM8 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
            </svg>
            <span className="truncate">{task.pipelineError}</span>
          </div>
        )}

        {/* Agent activity preview - show when no banner is displayed */}
        {(() => {
          // Don't show if attention or error banners are visible
          if (needsAttention && attention) return null
          if (hasPipelineError) return null

          const activity = getAgentActivity(task)
          if (!activity) return null

          const colorClasses = {
            active: 'text-running',
            waiting: 'text-attention',
            idle: 'text-text-secondary/70',
            error: 'text-error',
          }

          return (
            <div className={`flex items-center gap-1.5 text-[11px] ${colorClasses[activity.type]}`}>
              {activity.type === 'active' && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-running opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-running" />
                </span>
              )}
              <span className="truncate">{activity.text}</span>
              <span className="text-text-secondary/50 ml-auto">
                {formatRelativeTime(task.updatedAt)}
              </span>
            </div>
          )
        })()}

        {/* Compact metadata row */}
        {hasMetadata && (
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-text-secondary">
            {/* Pipeline status (priority) */}
            {isPipelineActive && !hasPipelineError && (
              <span className="inline-flex items-center gap-1 text-running">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-running opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-running" />
                </span>
                {PIPELINE_LABELS[task.pipelineState]}
              </span>
            )}

            {/* Siege loop badge */}
            <SiegeBadge task={task} />

            {/* PR badge with status */}
            {cardSettings.showPrBadge && task.prNumber && (
              <button
                onClick={handlePrClick}
                className="inline-flex items-center hover:text-accent transition-colors"
              >
                <PrStatusIndicator task={task} settings={cardSettings} />
              </button>
            )}

            {/* Comment count */}
            {cardSettings.showCommentCount && task.prCommentCount > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
                </svg>
                {task.prCommentCount}
              </span>
            )}

            {/* Agent type */}
            {cardSettings.showAgentType && task.agentType && (
              <span className="text-text-secondary/70">{task.agentType}</span>
            )}

            {/* Branch - truncated */}
            {cardSettings.showBranch && task.branch && (
              <span className="font-mono truncate max-w-[100px]" title={task.branch}>
                {task.branch}
              </span>
            )}

            {/* Spacer to push timestamp right */}
            <span className="flex-1" />

            {/* Timestamp */}
            {cardSettings.showTimestamp && !isPipelineActive && (
              <span className="text-text-secondary/50">
                {formatRelativeTime(task.updatedAt)}
              </span>
            )}
          </div>
        )}

        {/* Labels row - only if we have labels and setting is on */}
        {cardSettings.showLabels && labels.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {labels.slice(0, 3).map((label) => (
              <span
                key={label}
                className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-secondary"
              >
                {label}
              </span>
            ))}
            {labels.length > 3 && (
              <span className="text-[10px] text-text-secondary/70">
                +{labels.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </div>

    {/* Context Menu */}
    {contextMenu && (
      <TaskContextMenu
        task={task}
        columns={columns}
        position={contextMenu}
        onClose={() => { setContextMenu(null) }}
        onMoveToColumn={handleMoveToColumn}
        onOpenTask={handleClick}
        onDuplicateTask={handleDuplicateTask}
        onArchiveTask={handleArchiveTask}
        onDeleteTask={handleDeleteTask}
        onRunAgent={handleRunAgent}
        onStopAgent={handleStopAgent}
        onStartSiege={handleStartSiege}
        onStopSiege={handleStopSiege}
      />
    )}
    </>
  )
})
