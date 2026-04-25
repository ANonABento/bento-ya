import { memo, useMemo, useState, useCallback, useEffect, useRef } from 'react'
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
import { useDepDragContext } from '@/hooks/use-dep-drag-context'
import { parseDeps } from '@/lib/dependency-utils'
import { PIPELINE_LABELS, PIPELINE_COLORS, formatRelativeTime } from './task-card-utils'
import { PrStatusIndicator, SiegeBadge } from './task-card-badges'
import { useTaskCardActions } from './use-task-card-actions'
import { AttentionBanner, BlockedBanner, QualityGateBanner, PipelineErrorBanner } from './task-card-status'
import { AgentActivityPreview } from './task-card-activity'

const DELETE_CONFIRM_TIMEOUT_MS = 2000

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

  // Resolve trigger info for this task's column once. `columnHasTrigger` decides
  // whether the Run button is meaningful — a manual-only column has nothing to
  // spawn, so showing Play would be misleading.
  const { exitCriteria, columnHasTrigger } = useMemo(() => {
    const col = columns.find(c => c.id === task.columnId)
    if (!col) return { exitCriteria: null, columnHasTrigger: false }
    const t = getColumnTriggers(col)
    const hasTrigger = (t.on_entry?.type ?? 'none') !== 'none'
                    || (t.on_exit?.type ?? 'none') !== 'none'
    return { exitCriteria: t.exit_criteria ?? null, columnHasTrigger: hasTrigger }
  }, [columns, task.columnId])

  const isQualityGate = exitCriteria?.type === 'manual_approval'

  // Live agent streaming data
  const agentStream = useAgentStreamingStore((s) => s.streams.get(task.id))

  // All action handlers. Destructure the ones we wrap in useCallbacks so their
  // deps point at the stable inner refs rather than the actions object (which
  // is a fresh literal each render and would defeat the TaskQuickActions memo).
  const actions = useTaskCardActions(task)
  const { handleMoveToColumn, handleRetryPipeline, handleDeleteTask } = actions

  const { registerCard } = useCardPosition()
  const { onDepDragStart, setHoveredTaskId, hoveredTaskId } = useDepDragContext()

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

  // Stable refs so memoized children (TaskQuickActions) actually skip re-render
  // when only hover/dim state changes on the parent card.
  const handleClick = useCallback(() => {
    if (hasAttention) {
      markViewed(task.id)
    }
    openTask(task.id)
  }, [hasAttention, markViewed, openTask, task.id])

  const handlePrClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (task.prUrl) {
      window.open(task.prUrl, '_blank')
    }
  }, [task.prUrl])

  // Right-click and the "More" button open the same menu at the cursor.
  const openContextMenuAt = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  // Derive blocker task names for the blocked badge
  const blockerInfo = useMemo(() => {
    if (!task.blocked) return null
    const deps = parseDeps(task.dependencies)
    if (deps.length === 0) return null
    const allTasks = useTaskStore.getState().tasks
    const names = deps
      .map(d => allTasks.find(t => t.id === d.task_id)?.title)
      .filter(Boolean)
    return names.length > 0 ? names.join(', ') : null
  }, [task.blocked, task.dependencies])

  // Find next column for "move right" action
  const nextColumnId = useMemo(() => {
    const sorted = columns
      .filter((column) => column.visible)
      .sort((a, b) => a.position - b.position)
    const idx = sorted.findIndex(c => c.id === task.columnId)
    if (idx === -1) return null
    return sorted[idx + 1]?.id ?? null
  }, [columns, task.columnId])

  const handleMoveNext = useCallback(() => {
    if (nextColumnId) {
      handleMoveToColumn(nextColumnId)
    }
  }, [nextColumnId, handleMoveToColumn])

  const handleRetry = useCallback(() => { void handleRetryPipeline() }, [handleRetryPipeline])

  const [deleteConfirmPending, setDeleteConfirmPending] = useState(false)
  const deleteConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear any pending confirm-timer on unmount — the confirming click deletes
  // the task, which unmounts this card while the first click's timer is still
  // scheduled. Without this the timer would setState on an unmounted node.
  useEffect(() => {
    return () => {
      if (deleteConfirmTimerRef.current !== null) {
        clearTimeout(deleteConfirmTimerRef.current)
        deleteConfirmTimerRef.current = null
      }
    }
  }, [])

  const handleDeleteWithConfirm = useCallback(() => {
    if (deleteConfirmTimerRef.current !== null) {
      clearTimeout(deleteConfirmTimerRef.current)
      deleteConfirmTimerRef.current = null
    }
    if (deleteConfirmPending) {
      handleDeleteTask()
      setDeleteConfirmPending(false)
    } else {
      setDeleteConfirmPending(true)
      deleteConfirmTimerRef.current = setTimeout(() => {
        setDeleteConfirmPending(false)
        deleteConfirmTimerRef.current = null
      }, DELETE_CONFIRM_TIMEOUT_MS)
    }
  }, [deleteConfirmPending, handleDeleteTask])

  const needsAttention = hasAttention || task.agentStatus === 'needs_attention'
  const isPipelineActive = task.pipelineState !== 'idle'
  const hasPipelineError = !!task.pipelineError

  // Count incoming dependency links
  const depCount = useMemo(() => parseDeps(task.dependencies).length, [task.dependencies])

  // Is this card connected to the hovered card? (for highlight/dim)
  // Note: reads hovered task's deps via getState() — won't re-render if those change,
  // but hover is transient so staleness is acceptable.
  const isConnectedToHovered = useMemo(() => {
    if (!hoveredTaskId || hoveredTaskId === task.id) return false
    if (parseDeps(task.dependencies).some((d) => d.task_id === hoveredTaskId)) return true
    const hoveredTask = useTaskStore.getState().tasks.find((t) => t.id === hoveredTaskId)
    if (parseDeps(hoveredTask?.dependencies).some((d) => d.task_id === task.id)) return true
    return false
  }, [hoveredTaskId, task.id, task.dependencies])

  const isHovered = hoveredTaskId === task.id
  const someCardHovered = hoveredTaskId !== null
  const isDimmed = someCardHovered && !isHovered && !isConnectedToHovered

  const hasMetadata = (cardSettings.showBranch && task.branch) ||
    (cardSettings.showAgentType && task.agentType) ||
    (cardSettings.showTimestamp && !isPipelineActive) ||
    isPipelineActive ||
    task.siegeActive ||
    task.model ||
    (cardSettings.showPrBadge && task.prNumber) ||
    (cardSettings.showCommentCount && task.prCommentCount > 0) ||
    (cardSettings.showLabels && labels.length > 0) ||
    depCount > 0

  return (
    <>
    <div
      ref={cardRef}
      style={{
        ...style,
        cursor: 'pointer',
        opacity: isDragging ? 0.4 : isDimmed ? 0.3 : task.blocked ? 0.7 : 1,
        transition: 'transform 200ms ease, opacity 200ms ease',
      }}
      onClick={handleClick}
      onContextMenu={openContextMenuAt}
      onKeyDown={(e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return
        switch (e.key) {
          case 'Enter':
            e.preventDefault()
            handleClick()
            break
          case ' ':
            if (task.agentStatus === 'running' || columnHasTrigger) {
              e.preventDefault()
              actions.handleToggleAgent()
            }
            break
          case 'r':
          case 'R':
            if (task.pipelineError) {
              e.preventDefault()
              handleRetry()
            }
            break
          case 'ArrowRight':
            if (nextColumnId) {
              e.preventDefault()
              handleMoveNext()
            }
            break
          case 'Delete':
          case 'Backspace':
            e.preventDefault()
            handleDeleteWithConfirm()
            break
          case 'd':
          case 'D':
            e.preventDefault()
            actions.handleDuplicateTask()
            break
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
      className={`group relative rounded-lg border bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        isConnectedToHovered ? 'border-amber-400 ring-1 ring-amber-400/50 z-10' :
        isHovered ? 'border-accent ring-1 ring-accent/50 z-10' :
        'border-border-default hover:border-accent/50 hover:bg-surface-hover'
      } ${isDragging ? 'z-0' : !isConnectedToHovered && !isHovered ? 'hover:z-10' : ''} ${
        hasPipelineError ? 'border-l-4 border-l-error' : isPipelineActive ? `border-l-4 ${PIPELINE_COLORS[task.pipelineState]}` : ''
      }`}
      onPointerDownCapture={(e) => {
        if (e.metaKey || e.ctrlKey) {
          onDepDragStart(e, task.id)
        }
      }}
      onMouseEnter={() => { if (!isDragging) setHoveredTaskId(task.id) }}
      onMouseLeave={() => { if (!isDragging) setHoveredTaskId(null) }}
    >
      {/* Quick actions on hover */}
      {!isDragging && (
        <TaskQuickActions
          task={task}
          hasNextColumn={!!nextColumnId}
          columnHasTrigger={columnHasTrigger}
          isDeleteConfirmPending={deleteConfirmPending}
          onOpen={handleClick}
          onToggleAgent={actions.handleToggleAgent}
          onRetry={handleRetry}
          onMoveNext={handleMoveNext}
          onRequestDelete={handleDeleteWithConfirm}
          onShowMenu={openContextMenuAt}
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
        {isQualityGate && !hasPipelineError && <QualityGateBanner reviewStatus={task.reviewStatus} />}
        {hasPipelineError && <PipelineErrorBanner task={task} onRetry={handleRetry} />}

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
              <span className="font-mono truncate max-w-[100px] flex items-center gap-1" title={task.worktreePath ? `Worktree: ${task.worktreePath}` : task.branch}>
                {task.worktreePath && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                )}
                {task.branch}
              </span>
            )}
            {depCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-text-secondary/50" title={`${String(depCount)} dependency link${depCount > 1 ? 's' : ''} — hover to see`}>
                <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M6 3L10 3M10 3L10 7M10 3L3 10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-[10px]">{depCount}</span>
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
