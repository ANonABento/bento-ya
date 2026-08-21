import { memo, useMemo, useState, useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { AnimatePresence } from 'motion/react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Task } from '@/types'
import { useUIStore } from '@/stores/ui-store'
import { useAttentionStore } from '@/stores/attention-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useColumnStore } from '@/stores/column-store'
import { useTaskStore } from '@/stores/task-store'
import { useLabelStore } from '@/stores/label-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { TaskContextMenu } from './task-context-menu'
import { TaskSettingsModal } from './task-settings-modal'
import { TaskQuickActions } from './task-quick-actions'
import { TaskCardExpanded } from './task-card-expanded'
import { useAgentStreamingStore } from '@/stores/agent-streaming-store'
import { getColumnTriggers } from '@/types/column'
import { useCardPosition } from '@/hooks/use-card-positions'
import { useDepDragContext } from '@/hooks/use-dep-drag-context'
import { holdTask } from '@/lib/ipc/agent'
import { updateTask as updateTaskApi } from '@/lib/ipc/task'
import { parseDeps } from '@/lib/dependency-utils'
import { PIPELINE_LABELS, PIPELINE_COLORS, formatRelativeTime } from './task-card-utils'
import { AgentDoneBadge, PrStatusIndicator, SiegeBadge } from './task-card-badges'
import { useTaskCardActions } from './use-task-card-actions'
import { AttentionBanner, BlockedBanner, QueuedBanner, QualityGateBanner, PipelineErrorBanner } from './task-card-status'
import { AgentActivityPreview } from './task-card-activity'
import { useQueueStatus } from '@/hooks/use-queue-status'

type TaskCardProps = {
  task: Task
  isSelected?: boolean
  onSelectionChange?: (taskId: string, event: ReactMouseEvent<HTMLElement>) => void
}

const CARD_INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[role="button"]',
  '[data-card-click-interactive="true"]',
].join(',')

function isInteractiveCardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.closest(CARD_INTERACTIVE_SELECTOR) !== null
}

const BOARD_CENTER_SCROLL_MS = 280

function easeOutCubic(progress: number) {
  return 1 - Math.pow(1 - progress, 3)
}

function getColumnCenteredScrollLeft(scrollContainer: HTMLElement, column: HTMLElement) {
  const colCenter = column.offsetLeft + column.offsetWidth / 2
  const maxScrollLeft = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth)
  const centered = colCenter - scrollContainer.clientWidth / 2
  return Math.min(Math.max(centered, 0), maxScrollLeft)
}

function centerColumnDuringPanelOpen(scrollContainer: HTMLElement, column: HTMLElement) {
  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduceMotion) {
    scrollContainer.scrollLeft = getColumnCenteredScrollLeft(scrollContainer, column)
    return
  }

  const startScrollLeft = scrollContainer.scrollLeft
  const startTime = performance.now()

  const step = (now: number) => {
    const progress = Math.min(1, (now - startTime) / BOARD_CENTER_SCROLL_MS)
    const targetScrollLeft = getColumnCenteredScrollLeft(scrollContainer, column)
    scrollContainer.scrollLeft = startScrollLeft + (targetScrollLeft - startScrollLeft) * easeOutCubic(progress)

    if (progress < 1) {
      requestAnimationFrame(step)
      return
    }

    scrollContainer.scrollLeft = getColumnCenteredScrollLeft(scrollContainer, column)
  }

  requestAnimationFrame(step)
}

export const TaskCard = memo(function TaskCard({
  task,
  isSelected = false,
  onSelectionChange,
}: TaskCardProps) {
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

  // Inline title editing — only enabled when the card is expanded
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)
  const titleSkipBlurSaveRef = useRef(false)
  const columns = useColumnStore((s) => s.columns)
  const workspaceLabels = useLabelStore((s) => s.labels)
  const workspaceName = useWorkspaceStore((s) => s.workspaces.find((workspace) => workspace.id === task.workspaceId)?.name)

  // Get exit criteria type for this task's column
  const columnTriggers = useMemo(() => {
    const col = columns.find(c => c.id === task.columnId)
    if (!col) return null
    const triggers = getColumnTriggers(col)
    return triggers.exit_criteria ?? null
  }, [columns, task.columnId])

  const isQualityGate = columnTriggers?.type === 'manual_approval'
  const reviewStatus = task.reviewStatus

  // Check if task is in the last column (Done) for visual dimming
  const isInDoneColumn = useMemo(() => {
    const sorted = columns.filter(c => c.visible).sort((a, b) => a.position - b.position)
    const lastCol = sorted[sorted.length - 1]
    return lastCol != null && lastCol.id === task.columnId
  }, [columns, task.columnId])

  // Live agent streaming data
  const agentStream = useAgentStreamingStore((s) => s.streams.get(task.id))

  // Queue/concurrency status — only subscribed when this task is queued
  const queueStatus = useQueueStatus(task.agentStatus === 'queued' ? task.workspaceId : null)

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

  // Reset title draft when the task changes or edit mode exits
  useEffect(() => {
    if (!editingTitle) setTitleDraft(task.title)
  }, [task.id, task.title, editingTitle])

  async function saveTitle() {
    const trimmed = titleDraft.trim()
    if (!trimmed || trimmed === task.title) {
      setTitleDraft(task.title)
      setEditingTitle(false)
      return
    }
    try {
      await updateTaskApi(task.id, { title: trimmed })
    } catch (err) {
      console.error('Failed to save task title:', err)
      setTitleDraft(task.title)
    } finally {
      setEditingTitle(false)
    }
  }

  const taskLabels = useMemo(() => {
    const labelsById = new Map(workspaceLabels.map((label) => [label.id, label]))
    return task.labels.flatMap((label) => {
      const current = labelsById.get(label.id)
      return current ? [current] : []
    })
  }, [task.labels, workspaceLabels])

  const { displayTitle, titleWorkspaceName } = useMemo(() => {
    const trimmedWorkspaceName = workspaceName?.trim()
    if (!trimmedWorkspaceName) {
      return { displayTitle: task.title, titleWorkspaceName: null }
    }

    const suffix = ` — ${trimmedWorkspaceName}`
    if (!task.title.endsWith(suffix)) {
      return { displayTitle: task.title, titleWorkspaceName: null }
    }

    return {
      displayTitle: task.title.slice(0, -suffix.length).trim(),
      titleWorkspaceName: trimmedWorkspaceName,
    }
  }, [task.title, workspaceName])

  const openChat = useUIStore((s) => s.openChat)
  const closeChat = useUIStore((s) => s.closeChat)
  const collapseTask = useUIStore((s) => s.collapseTask)

  function openTaskDetail() {
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

      const scrollContainer = document.querySelector('[data-board-scroll]')
      const column = cardElRef.current?.closest('[data-column-id]') as HTMLElement | null
      if (scrollContainer && column) {
        centerColumnDuringPanelOpen(scrollContainer as HTMLElement, column)
      }
    }
  }

  function handleClick(e: ReactMouseEvent<HTMLElement>) {
    if (onSelectionChange && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      e.stopPropagation()
      onSelectionChange(task.id, e)
      return
    }

    if (isExpanded && isInteractiveCardTarget(e.target)) {
      return
    }

    openTaskDetail()
  }

  function handlePrClick(e: ReactMouseEvent) {
    e.stopPropagation()
    if (task.prUrl) {
      window.open(task.prUrl, '_blank')
    }
  }

  const handleContextMenu = useCallback((e: ReactMouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const handleShowMenu = useCallback((e: ReactMouseEvent) => {
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

  // MCP attribution: when this task was spawned by another task's agent, resolve
  // the parent's title for the "spawned by …" badge (falls back to the id).
  const spawnedByLabel = useMemo(() => {
    if (!task.createdByTaskId) return null
    const parent = useTaskStore.getState().tasks.find(t => t.id === task.createdByTaskId)
    return parent?.title ?? task.createdByTaskId
  }, [task.createdByTaskId])

  // Find next column for "move right" action
  const nextColumnId = useMemo(() => {
    const sorted = [...columns].sort((a, b) => a.position - b.position)
    const idx = sorted.findIndex(c => c.id === task.columnId)
    if (idx === -1) return null
    return idx < sorted.length - 1 ? (sorted[idx + 1]?.id ?? null) : null
  }, [columns, task.columnId])

  const handleMoveNext = useCallback(() => {
    if (nextColumnId) {
      actions.handleMoveToColumn(nextColumnId)
    }
  }, [nextColumnId, actions])

  const canTriggerWork = useMemo(() => {
    const currentColumn = columns.find((column) => column.id === task.columnId)
    if (!currentColumn) return false
    return getColumnTriggers(currentColumn).on_entry?.type !== 'none'
  }, [columns, task.columnId])

  const handleRetry = useCallback(() => { void actions.handleRetryPipeline() }, [actions])
  const handleToggleHold = useCallback(() => {
    void holdTask(task.id, !task.heldByUser)
  }, [task.id, task.heldByUser])

  const [deleteConfirmPending, setDeleteConfirmPending] = useState(false)
  const deleteConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (deleteConfirmTimerRef.current) {
      clearTimeout(deleteConfirmTimerRef.current)
      deleteConfirmTimerRef.current = null
    }
    setDeleteConfirmPending(false)

    return () => {
      if (deleteConfirmTimerRef.current) {
        clearTimeout(deleteConfirmTimerRef.current)
        deleteConfirmTimerRef.current = null
      }
    }
  }, [task.id])

  const handleDeleteWithConfirm = useCallback(() => {
    if (deleteConfirmPending) {
      actions.handleDeleteTask()
      setDeleteConfirmPending(false)
      if (deleteConfirmTimerRef.current) {
        clearTimeout(deleteConfirmTimerRef.current)
        deleteConfirmTimerRef.current = null
      }
    } else {
      setDeleteConfirmPending(true)
      deleteConfirmTimerRef.current = setTimeout(() => {
        setDeleteConfirmPending(false)
        deleteConfirmTimerRef.current = null
      }, 2000)
    }
  }, [deleteConfirmPending, actions])

  const needsAttention = hasAttention || task.agentStatus === 'needs_attention'
  const canToggleAgent = canTriggerWork || task.agentStatus === 'running'
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
    task.heldByUser ||
    task.agentDoneSignaledAt !== null ||
    titleWorkspaceName ||
    task.model ||
    task.createdByTaskId ||
    (cardSettings.showPrBadge && task.prNumber) ||
    (cardSettings.showCommentCount && task.prCommentCount > 0) ||
    (cardSettings.showLabels && taskLabels.length > 0) ||
    depCount > 0

  let cardOpacity = 1
  if (isDragging) cardOpacity = 0.4
  else if (isDimmed) cardOpacity = 0.3
  else if (task.blocked) cardOpacity = 0.7
  else if (task.archivedAt) cardOpacity = 0.45
  else if (isInDoneColumn) cardOpacity = 0.6

  return (
    <>
    <div
      ref={cardRef}
      role="article"
      aria-label={isSelected ? `${task.title} (selected)` : task.title}
      data-task-id={task.id}
      data-task-status={task.agentStatus ?? 'idle'}
      style={{
        ...style,
        cursor: 'pointer',
        opacity: cardOpacity,
        transition: 'transform 200ms ease, opacity 200ms ease',
      }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={(e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return
        // Don't intercept keyboard shortcuts when user is typing in an input
        const tag = (e.target as HTMLElement).tagName
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'BUTTON' ||
          tag === 'SELECT' ||
          tag === 'A' ||
          (e.target as HTMLElement).isContentEditable
        ) return
        switch (e.key) {
          case 'Enter':
            e.preventDefault()
            openTaskDetail()
            break
          case ' ':
            e.preventDefault()
            if (canToggleAgent) {
              actions.handleToggleAgent()
            }
            break
          case 'r':
          case 'R':
            e.preventDefault()
            if (task.pipelineError) {
              void actions.handleRetryPipeline()
            }
            break
          case 'ArrowRight':
            e.preventDefault()
            handleMoveNext()
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
      className={`group relative shrink-0 overflow-hidden rounded-lg border bg-surface/95 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        isSelected ? 'border-accent ring-2 ring-accent/40 z-20' :
        isConnectedToHovered ? 'border-amber-400 ring-1 ring-amber-400/50 z-10' :
        isHovered ? 'border-accent ring-1 ring-accent/50 z-10' :
        'border-border-default hover:border-accent/50 hover:bg-surface'
      } ${isDragging ? 'z-0' : !isConnectedToHovered && !isHovered ? 'hover:z-10' : ''} ${
        hasPipelineError ? 'border-l-4 border-l-error' : isPipelineActive ? `border-l-4 ${PIPELINE_COLORS[task.pipelineState]}` : ''
      }`}
      onPointerDownCapture={(e) => {
        if ((e.metaKey || e.ctrlKey) && !onSelectionChange) {
          onDepDragStart(e, task.id)
        }
      }}
      onMouseEnter={() => { if (!isDragging) setHoveredTaskId(task.id) }}
      onMouseLeave={() => { if (!isDragging) setHoveredTaskId(null) }}
    >
      {isSelected && (
        <div className="absolute left-2 top-2 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-bg shadow" aria-hidden="true">
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.25 7.31a1 1 0 0 1-1.42.002l-3.25-3.28a1 1 0 1 1 1.42-1.408l2.54 2.563 6.54-6.594a1 1 0 0 1 1.414-.006Z" clipRule="evenodd" />
          </svg>
        </div>
      )}

      {/* Quick actions on hover */}
      {!isDragging && (
        <TaskQuickActions
          onDelete={actions.handleDeleteTask}
          onShowMenu={handleShowMenu}
          confirmDeletePending={deleteConfirmPending}
        />
      )}

      <div
        {...attributes}
        {...listeners}
        className="space-y-2.5 p-3"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        {/* Title — click-to-edit when card is expanded */}
        <div className="flex items-start gap-2 pb-0.5">
          {editingTitle ? (
            <input
              type="text"
              value={titleDraft}
              autoFocus
              aria-label="Edit task title"
              onChange={(e) => { setTitleDraft(e.target.value) }}
              onPointerDown={(e) => { e.stopPropagation() }}
              onClick={(e) => { e.stopPropagation() }}
              onBlur={() => {
                if (titleSkipBlurSaveRef.current) {
                  titleSkipBlurSaveRef.current = false
                  return
                }
                void saveTitle()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.currentTarget.blur()
                } else if (e.key === 'Escape') {
                  titleSkipBlurSaveRef.current = true
                  setTitleDraft(task.title)
                  setEditingTitle(false)
                  e.currentTarget.blur()
                }
              }}
              className="flex-1 rounded-md border border-accent bg-surface-hover px-2 py-1 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-accent/20"
            />
          ) : (
            <h4
              onClick={(e) => {
                if (isExpanded) {
                  e.stopPropagation()
                  setEditingTitle(true)
                }
              }}
              className={`min-w-0 flex-1 pr-7 text-[13px] font-medium leading-snug text-text-primary line-clamp-2 ${isExpanded ? 'hover:text-accent' : ''}`}
              style={isExpanded ? { cursor: 'text' } : undefined}
              title={isExpanded ? 'Click to edit title' : undefined}
            >
              {displayTitle}
            </h4>
          )}
          {task.archivedAt && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); actions.handleUnarchiveTask(); }}
              title="Restore — move back to the active board"
              className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-surface-hover text-text-secondary/80 border border-border-default hover:border-accent hover:text-accent transition-colors"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H4.598a.75.75 0 0 0-.75.75v3.634a.75.75 0 0 0 1.5 0v-2.033l.312.311a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39l-.611.21ZM4.688 8.576a5.5 5.5 0 0 1 9.201-2.466l.312.311h-2.433a.75.75 0 0 0 0 1.5h3.634a.75.75 0 0 0 .75-.75V3.537a.75.75 0 0 0-1.5 0v2.033l-.312-.311A7 7 0 0 0 3.628 8.397a.75.75 0 0 0 1.449.39l-.389-.211Z" clipRule="evenodd" />
              </svg>
              Restore
            </button>
          )}
        </div>

        {/* Description — hidden when expanded (expanded view shows full description) */}
        {!isExpanded && cardSettings.showDescription && task.description && (
          <p className="text-xs leading-relaxed text-text-secondary line-clamp-2 break-words">
            {task.description}
          </p>
        )}

        {/* Status banners */}
        {needsAttention && attention && <AttentionBanner attention={attention} />}
        {task.blocked && <BlockedBanner blockerInfo={blockerInfo} />}
        {task.agentStatus === 'queued' && !hasPipelineError && (
          <QueuedBanner taskId={task.id} queueStatus={queueStatus} />
        )}
        {isQualityGate && !hasPipelineError && <QualityGateBanner reviewStatus={reviewStatus} />}
        {hasPipelineError && <PipelineErrorBanner task={task} onRetry={() => { void actions.handleRetryPipeline() }} />}

        {/* Compact metadata row — hidden when expanded (expanded view has its own) */}
        {!isExpanded && hasMetadata && (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-text-secondary">
            {isPipelineActive && !hasPipelineError && task.pipelineState !== 'running' && (
              <span className="inline-flex items-center gap-1 text-running">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-running opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-running" />
                </span>
                {PIPELINE_LABELS[task.pipelineState]}
              </span>
            )}
            <SiegeBadge task={task} />
            <AgentDoneBadge task={task} />
            {task.heldByUser && (
              <span className="inline-flex items-center gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                Held
              </span>
            )}
            {spawnedByLabel && (
              <span
                className="inline-flex max-w-[160px] items-center gap-1 truncate rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent"
                title={`Spawned by an agent on "${spawnedByLabel}" (chain depth ${String(task.recursionDepth)})`}
              >
                <svg className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 1.5v4M8 10.5v4M3.5 8h-2M14.5 8h-2" strokeLinecap="round" />
                  <circle cx="8" cy="8" r="2.5" />
                </svg>
                <span className="truncate">spawned by {spawnedByLabel}</span>
              </span>
            )}
            {titleWorkspaceName && (
              <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                {titleWorkspaceName}
              </span>
            )}
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
              <span className="flex max-w-[130px] items-center gap-1 truncate font-mono text-[11px]" title={task.worktreePath ? `Worktree: ${task.worktreePath}` : task.branch}>
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
              <span className="text-[10px] text-text-secondary/40 tabular-nums">
                {formatRelativeTime(task.updatedAt)}
              </span>
            )}
          </div>
        )}

        {/* Labels — hidden when expanded */}
        {!isExpanded && cardSettings.showLabels && taskLabels.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {taskLabels.slice(0, 3).map((label) => (
              <span
                key={label.id}
                className="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-[10px] text-text-secondary"
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: label.color }} />
                {label.name}
              </span>
            ))}
            {taskLabels.length > 3 && (
              <span className="text-[10px] text-text-secondary/70">+{taskLabels.length - 3}</span>
            )}
          </div>
        )}

        {/* Agent activity preview sits at the bottom of the closed card. */}
        {!isExpanded && !needsAttention && !hasPipelineError && task.agentStatus !== 'queued' && (
          <AgentActivityPreview task={task} agentStream={agentStream} />
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
        onOpenTask={openTaskDetail}
        onDuplicateTask={actions.handleDuplicateTask}
        onArchiveTask={actions.handleArchiveTask}
        onUnarchiveTask={actions.handleUnarchiveTask}
        onDeleteTask={actions.handleDeleteTask}
        onRunAgent={actions.handleRunAgent}
        onStopAgent={actions.handleStopAgent}
        onRetryPipeline={handleRetry}
        onToggleHold={handleToggleHold}
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
