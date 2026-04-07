import { memo, useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { AnimatePresence } from 'motion/react'
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
import { TaskCardExpanded } from './task-card-expanded'
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

export const TaskCard = memo(function TaskCard({ task }: { task: Task }) {
  const expandTask = useUIStore((s) => s.expandTask)
  const expandedTaskId = useUIStore((s) => s.expandedTaskId)
  const isExpanded = expandedTaskId === task.id
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

  const cardElRef = useRef<HTMLElement | null>(null)
  const cardRef = useCallback((element: HTMLElement | null) => {
    cardElRef.current = element
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

  const openChat = useUIStore((s) => s.openChat)
  const closeChat = useUIStore((s) => s.closeChat)
  const collapseTask = useUIStore((s) => s.collapseTask)
  const viewMode = useUIStore((s) => s.viewMode)

  function handleClick() {
    if (hasAttention) {
      markViewed(task.id)
    }

    if (isExpanded) {
      // Re-click: close everything
      collapseTask()
      closeChat()
    } else {
      // Open: expand card + open chat + scroll column to center of board
      expandTask(task.id)
      openChat(task.id)

      // Center the column in the visible board area.
      const scrollContainer = document.querySelector('[data-board-scroll]')
      const column = cardElRef.current?.closest('[data-column-id]') as HTMLElement | null
      if (scrollContainer && column) {
        const colCenter = column.offsetLeft + column.offsetWidth / 2

        let boardWidth: number
        if (viewMode === 'chat') {
          // Panel already open — board width is stable
          boardWidth = scrollContainer.clientWidth
          scrollContainer.scrollTo({
            left: colCenter - boardWidth / 2,
            behavior: 'smooth',
          })
        } else {
          // Panel about to open and animate to final width.
          // Scroll smoothly alongside the panel animation — both arrive
          // at the correct state together. Start from current width,
          // the ResizeObserver fires one final scroll when settled.
          scrollContainer.scrollTo({
            left: colCenter - scrollContainer.clientWidth / 2,
            behavior: 'instant',
          })
          // Then correct to final position once panel settles
          let timer: ReturnType<typeof setTimeout>
          const observer = new ResizeObserver(() => {
            clearTimeout(timer)
            timer = setTimeout(() => {
              observer.disconnect()
              const finalCenter = scrollContainer.clientWidth / 2
              scrollContainer.scrollTo({
                left: colCenter - finalCenter,
                behavior: 'smooth',
              })
            }, 50)
          })
          observer.observe(scrollContainer)
        }
      }
    }
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
    if (!task.blocked) return null
    const deps = parseDeps(task.dependencies)
    if (deps.length === 0) return null
    const allTasks = useTaskStore.getState().tasks
    const names = deps
      .map(d => allTasks.find(t => t.id === d.task_id)?.title)
      .filter(Boolean)
    return names.length > 0 ? names.join(', ') : null
  }, [task.blocked, task.dependencies])

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
      onContextMenu={handleContextMenu}
      onKeyDown={(e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return
        // Don't intercept keyboard shortcuts when user is typing in an input
        const tag = (e.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
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

        {/* Description — hidden when expanded (expanded view shows full description) */}
        {!isExpanded && cardSettings.showDescription && task.description && (
          <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed">
            {task.description}
          </p>
        )}

        {/* Status banners */}
        {needsAttention && attention && <AttentionBanner attention={attention} />}
        {task.blocked && <BlockedBanner blockerInfo={blockerInfo} />}
        {isQualityGate && !hasPipelineError && <QualityGateBanner reviewStatus={reviewStatus} />}
        {hasPipelineError && <PipelineErrorBanner task={task} onRetry={() => { void actions.handleRetryPipeline() }} />}

        {/* Agent activity preview — hidden when expanded */}
        {!isExpanded && !needsAttention && !hasPipelineError && (
          <AgentActivityPreview task={task} agentStream={agentStream} />
        )}

        {/* Compact metadata row — hidden when expanded (expanded view has its own) */}
        {!isExpanded && hasMetadata && (
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

        {/* Labels — hidden when expanded */}
        {!isExpanded && cardSettings.showLabels && labels.length > 0 && (
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

      {/* Expanded card detail */}
      <AnimatePresence>
        {isExpanded && <TaskCardExpanded task={task} />}
      </AnimatePresence>
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
