import { memo, useMemo, useState, useCallback, useEffect } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Task } from '@/types'
import { useUIStore } from '@/stores/ui-store'
import { useAttentionStore } from '@/stores/attention-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useColumnStore } from '@/stores/column-store'
import { useTaskStore } from '@/stores/task-store'
import { TaskContextMenu } from './task-context-menu'
import { TaskSettingsModal } from './task-settings-modal'
import { TaskQuickActions } from './task-quick-actions'
import { useAgentStreamingStore } from '@/stores/agent-streaming-store'
import { getColumnTriggers } from '@/types/column'
import { useCardPosition } from '@/hooks/use-card-positions'
import { PIPELINE_LABELS, PIPELINE_COLORS, formatRelativeTime } from './task-card-utils'
import { PrStatusIndicator, SiegeBadge } from './task-card-badges'
import { useTaskCardActions } from './use-task-card-actions'
import { AttentionBanner, BlockedBanner, QualityGateBanner, PipelineErrorBanner } from './task-card-status'
import { AgentActivityPreview } from './task-card-activity'

export const TaskCard = memo(function TaskCard({ task }: { task: Task }) {
  const openTask = useUIStore((s) => s.openTask)
  const hasAttention = useAttentionStore((s) => s.hasAttention(task.id))
  const attention = useAttentionStore((s) => s.getAttention(task.id))
  const markViewed = useAttentionStore((s) => s.markViewed)
  const cardSettings = useSettingsStore((s) => s.global.cards)

  // Context menu & settings modal
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'triggers' | 'dependencies'>('triggers')
  const columns = useColumnStore((s) => s.columns)

  // Get exit criteria type for this task's column
  const columnTriggers = useMemo(() => {
    const col = columns.find(c => c.id === task.columnId)
    if (!col) return null
    const triggers = getColumnTriggers(col)
    return triggers.exit_criteria ?? null
  }, [columns, task.columnId])

  const isQualityGate = columnTriggers?.type === 'manual_approval'
  const reviewStatus = task.reviewStatus

  // Live agent streaming data
  const agentStream = useAgentStreamingStore((s) => s.streams.get(task.id))

  // All action handlers
  const actions = useTaskCardActions(task)

  const { registerCard } = useCardPosition()

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

  const cardRef = useCallback((element: HTMLElement | null) => {
    setNodeRef(element)
    registerCard(task.id, element)
  }, [setNodeRef, registerCard, task.id])

  // Unregister on unmount
  useEffect(() => {
    return () => { registerCard(task.id, null) }
  }, [task.id, registerCard])

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

  const handleShowMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  // Derive blocker task names for the blocked badge
  const blockerInfo = useMemo(() => {
    if (!task.blocked || !task.dependencies) return null
    try {
      const deps = JSON.parse(task.dependencies) as Array<{ task_id: string }>
      const tasks = useTaskStore.getState().tasks
      const names = deps
        .map(d => tasks.find(t => t.id === d.task_id)?.title)
        .filter(Boolean)
      return names.length > 0 ? names.join(', ') : null
    } catch { return null }
  }, [task.blocked, task.dependencies])

  const needsAttention = hasAttention || task.agentStatus === 'needs_attention'
  const isPipelineActive = task.pipelineState !== 'idle'
  const hasPipelineError = !!task.pipelineError

  const hasMetadata = (cardSettings.showBranch && task.branch) ||
    (cardSettings.showAgentType && task.agentType) ||
    (cardSettings.showTimestamp && !isPipelineActive) ||
    isPipelineActive ||
    task.siegeActive ||
    task.model ||
    (cardSettings.showPrBadge && task.prNumber) ||
    (cardSettings.showCommentCount && task.prCommentCount > 0) ||
    (cardSettings.showLabels && labels.length > 0)

  return (
    <>
    <div
      ref={cardRef}
      style={{
        ...style,
        cursor: 'pointer',
        opacity: isDragging ? 0.4 : 1,
        transition: isDragging ? 'opacity 150ms' : 'transform 200ms ease, opacity 150ms',
      }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={(e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return
        switch (e.key) {
          case 'Enter':
          case ' ':
            e.preventDefault()
            handleClick()
            break
          case 'd':
          case 'D':
            e.preventDefault()
            actions.handleDuplicateTask()
            break
          case 'Delete':
          case 'Backspace': {
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            setContextMenu({ x: rect.right - 180, y: rect.top })
            break
          }
          case 'm':
          case 'M': {
            e.preventDefault()
            const moveRect = e.currentTarget.getBoundingClientRect()
            setContextMenu({ x: moveRect.right - 180, y: moveRect.top })
            break
          }
          case 'l':
          case 'L':
            e.preventDefault()
            setSettingsTab('dependencies')
            setShowSettings(true)
            break
        }
      }}
      tabIndex={0}
      className={`group relative rounded-lg border border-border-default bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent hover:border-accent/50 hover:bg-surface-hover ${isDragging ? 'z-0' : 'hover:z-10'} ${hasPipelineError ? 'border-l-4 border-l-error' : isPipelineActive ? `border-l-4 ${PIPELINE_COLORS[task.pipelineState]}` : ''}`}
    >
      {/* Quick actions on hover */}
      {!isDragging && (
        <TaskQuickActions
          task={task}
          onOpen={handleClick}
          onToggleAgent={actions.handleToggleAgent}
          onShowMenu={handleShowMenu}
        />
      )}

      <div
        {...attributes}
        {...listeners}
        className="p-3 space-y-2"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        {/* Title */}
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

        {/* Status banners */}
        {needsAttention && attention && <AttentionBanner attention={attention} />}
        {task.blocked && <BlockedBanner blockerInfo={blockerInfo} />}
        {isQualityGate && !hasPipelineError && <QualityGateBanner reviewStatus={reviewStatus} />}
        {hasPipelineError && <PipelineErrorBanner task={task} onRetry={() => { void actions.handleRetryPipeline() }} />}

        {/* Agent activity preview */}
        {!needsAttention && !hasPipelineError && (
          <AgentActivityPreview task={task} agentStream={agentStream} />
        )}

        {/* Compact metadata row */}
        {hasMetadata && (
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-text-secondary">
            {isPipelineActive && !hasPipelineError && (
              <span className="inline-flex items-center gap-1 text-running">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-running opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-running" />
                </span>
                {PIPELINE_LABELS[task.pipelineState]}
              </span>
            )}
            <SiegeBadge task={task} />
            {cardSettings.showPrBadge && task.prNumber && (
              <button onClick={handlePrClick} className="inline-flex items-center hover:text-accent transition-colors">
                <PrStatusIndicator task={task} settings={cardSettings} />
              </button>
            )}
            {cardSettings.showCommentCount && task.prCommentCount > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
                </svg>
                {task.prCommentCount}
              </span>
            )}
            {cardSettings.showAgentType && task.agentType && (
              <span className="text-text-secondary/70">{task.agentType}</span>
            )}
            {task.model && (
              <span className="rounded bg-accent/10 px-1 py-0.5 text-[10px] font-medium text-accent">
                {task.model}
              </span>
            )}
            {cardSettings.showBranch && task.branch && (
              <span className="font-mono truncate max-w-[100px]" title={task.branch}>
                {task.branch}
              </span>
            )}
            <span className="flex-1" />
            {cardSettings.showTimestamp && !isPipelineActive && (
              <span className="text-text-secondary/50">
                {formatRelativeTime(task.updatedAt)}
              </span>
            )}
          </div>
        )}

        {/* Labels */}
        {cardSettings.showLabels && labels.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {labels.slice(0, 3).map((label) => (
              <span key={label} className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-secondary">
                {label}
              </span>
            ))}
            {labels.length > 3 && (
              <span className="text-[10px] text-text-secondary/70">+{labels.length - 3}</span>
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
        onMoveToColumn={actions.handleMoveToColumn}
        onOpenTask={handleClick}
        onDuplicateTask={actions.handleDuplicateTask}
        onArchiveTask={actions.handleArchiveTask}
        onDeleteTask={actions.handleDeleteTask}
        onRunAgent={actions.handleRunAgent}
        onStopAgent={actions.handleStopAgent}
        onStartSiege={() => { void actions.handleStartSiege(); }}
        onStopSiege={() => { void actions.handleStopSiege(); }}
        onConfigureTask={() => { setShowSettings(true) }}
      />
    )}

    {/* Task Settings Modal */}
    {showSettings && (
      <TaskSettingsModal
        task={task}
        onClose={() => { setShowSettings(false); setSettingsTab('triggers') }}
        initialTab={settingsTab}
      />
    )}
    </>
  )
})
