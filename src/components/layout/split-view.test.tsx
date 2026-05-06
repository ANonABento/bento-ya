/**
 * Regression tests for the right-side TaskSidePanel.
 *
 * The bug this guards against:
 *
 *   PR #192 added `<AgentPanel key={task.id}>` inside an outer
 *   `<motion.div>` to fix a stale-content issue. In some lifecycle
 *   sequences (HMR refresh, React StrictMode double-invokes, tight
 *   task→task switching) Framer Motion's animation state could end
 *   up convinced it had animated to the target while motion's async
 *   keyframe resolver had never flushed — leaving the actual element
 *   stuck at the `initial` values (`width: 0; opacity: 0`). The
 *   panel mounted but never visibly opened, so users could not see
 *   streaming agent output. With `mode="wait"` the exit on the old
 *   key never resolved either, so the new panel never got to mount.
 *
 *   The fix swaps Framer Motion for a plain CSS `width` transition:
 *   no JS frame-loop dependency, no async keyframe resolver, no
 *   AnimatePresence orchestration that can stall. The container
 *   stays mounted and just transitions its width between 0 and the
 *   configured panel width.
 *
 *   Stale-content protection is preserved by keeping
 *   `<AgentPanel key={task.id}>` so the inner panel + TerminalView
 *   + xterm fully unmount on task switch (the original purpose of
 *   #192's key).
 *
 * jsdom doesn't run CSS transitions, so these tests assert the
 * structural invariants that make the bug impossible:
 *   - When a task is selected, the container's inline style targets
 *     the configured panel width and opacity:1 (not 0).
 *   - When no task is selected, the container collapses to width:0
 *     and opacity:0.
 *   - The AgentPanel inside is keyed by task.id, so switching tasks
 *     forces a fresh AgentPanel + xterm.
 */

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@/types'
import { useTaskStore } from '@/stores/task-store'
import { useUIStore } from '@/stores/ui-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { TaskSidePanel } from './split-view'

// AgentPanel pulls in xterm + Tauri PTY plumbing — heavy and unnecessary
// for the structural invariants we're checking here. Stub it with a
// simple tagged div so tests can verify it mounts/remounts.
vi.mock('@/components/panel/agent-panel', () => ({
  AgentPanel: ({ task }: { task: Task; onClose?: () => void }) => (
    <div data-testid="agent-panel" data-task-id={task.id}>
      Agent for {task.title}
    </div>
  ),
}))

// ResizeHandle is decorative for these tests; stub to a no-op.
vi.mock('@/components/shared/resize-handle', () => ({
  ResizeHandle: () => <div data-testid="resize-handle" />,
}))

const PANEL_CLASS_SELECTOR = '.border-l.border-border-default'

const TEST_TASK_BASE: Omit<Task, 'id' | 'title'> = {
  workspaceId: 'ws-1',
  columnId: 'col-1',
  description: '',
  branch: null,
  agentType: null,
  agentMode: null,
  agentStatus: null,
  queuedAt: null,
  pipelineState: 'idle',
  pipelineTriggeredAt: null,
  pipelineError: null,
  retryCount: 0,
  model: null,
  lastScriptExitCode: null,
  reviewStatus: null,
  prNumber: null,
  prUrl: null,
  siegeIteration: 0,
  siegeActive: false,
  siegeMaxIterations: 0,
  siegeLastChecked: null,
  prMergeable: null,
  prCiStatus: null,
  prReviewDecision: null,
  prCommentCount: 0,
  prIsDraft: false,
  prLabels: '[]',
  prLastFetched: null,
  prHeadSha: null,
  checklist: null,
  estimatedHours: null,
  actualHours: 0,
  notifyStakeholders: null,
  notificationSentAt: null,
  triggerOverrides: null,
  triggerPrompt: null,
  lastOutput: null,
  dependencies: null,
  blocked: false,
  worktreePath: null,
  archivedAt: null,
  labels: [],
  position: 0,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

function makeTask(id: string, title: string): Task {
  return { ...TEST_TASK_BASE, id, title }
}

describe('TaskSidePanel — panel-collapsed regression guard', () => {
  beforeEach(() => {
    useTaskStore.setState({
      tasks: [
        makeTask('task-a', 'Task A'),
        makeTask('task-b', 'Task B'),
      ],
    })
    useWorkspaceStore.setState({
      workspaces: [
        {
          id: 'ws-1',
          name: 'Workspace',
          repoPath: '/tmp/ws',
          tabOrder: 0,
          isActive: true,
          activeTaskCount: 2,
          config: '{}',
          createdAt: '',
          updatedAt: '',
        },
      ],
    })
    useUIStore.setState({ agentPanelWidth: 480 })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('opens the panel to the configured width when a task is selected', () => {
    // The original bug: the container was rendered but stuck at
    // width:0;opacity:0 because Framer Motion's enter animation
    // stalled before painting. This test pins the steady-state:
    // a selected task = panel inline style targets the configured
    // width and full opacity. No JS animation needed.
    useUIStore.setState({ agentPanelWidth: 480 })
    const { container } = render(
      <TaskSidePanel taskId="task-a" onClose={vi.fn()} />,
    )

    const panel = container.querySelector<HTMLElement>(PANEL_CLASS_SELECTOR)
    if (!panel) throw new Error('panel container should be rendered')
    expect(panel.style.width).toBe('480px')
    expect(panel.style.opacity).toBe('1')
    expect(panel.getAttribute('aria-hidden')).toBeNull()
  })

  it('renders the AgentPanel for the currently selected task', () => {
    const { container } = render(
      <TaskSidePanel taskId="task-a" onClose={vi.fn()} />,
    )

    const inner = container.querySelector('[data-testid="agent-panel"]')
    expect(inner).not.toBeNull()
    expect(inner?.getAttribute('data-task-id')).toBe('task-a')
  })

  it('collapses the panel when no task is selected', () => {
    // Container stays mounted (so the CSS transition has something
    // to animate), but its width and opacity are zero, the border
    // is hidden, and pointer events are disabled so it can't steal
    // hover/click on the column behind it.
    const { container } = render(
      <TaskSidePanel taskId={null} onClose={vi.fn()} />,
    )

    const panel = container.querySelector<HTMLElement>(PANEL_CLASS_SELECTOR)
    if (!panel) throw new Error('panel container should always be mounted')
    expect(panel.style.width).toBe('0px')
    expect(panel.style.opacity).toBe('0')
    expect(panel.style.pointerEvents).toBe('none')
    expect(panel.getAttribute('aria-hidden')).toBe('true')
    // No inner agent panel when there's no task.
    expect(container.querySelector('[data-testid="agent-panel"]')).toBeNull()
  })

  it('switches the AgentPanel to the new task on rerender', () => {
    const { container, rerender } = render(
      <TaskSidePanel taskId="task-a" onClose={vi.fn()} />,
    )

    expect(
      container.querySelector('[data-testid="agent-panel"]')?.getAttribute('data-task-id'),
    ).toBe('task-a')

    rerender(<TaskSidePanel taskId="task-b" onClose={vi.fn()} />)

    expect(
      container.querySelector('[data-testid="agent-panel"]')?.getAttribute('data-task-id'),
    ).toBe('task-b')
  })

  it('remounts the AgentPanel when switching tasks (preserves the stale-content fix from #192)', () => {
    // Switching tasks must fully unmount the previous AgentPanel
    // (and its TerminalView + xterm + Tauri listeners) before the
    // new one mounts, so async work from the OLD task can't race
    // with the new task's render. We pin this by checking that
    // the AgentPanel DOM node is a different instance after the
    // switch — which is only true if React unmounted it (and only
    // happens because we key AgentPanel by task.id).
    const { container, rerender } = render(
      <TaskSidePanel taskId="task-a" onClose={vi.fn()} />,
    )

    const before = container.querySelector('[data-testid="agent-panel"]')
    expect(before).not.toBeNull()

    rerender(<TaskSidePanel taskId="task-b" onClose={vi.fn()} />)

    const after = container.querySelector('[data-testid="agent-panel"]')
    expect(after).not.toBeNull()
    expect(after).not.toBe(before)
  })

  it('reopens to the new width when a previously-collapsed panel gets a task selected', () => {
    // Cold path: mount with no task, then receive a task. The
    // container must transition from collapsed (width:0) to open
    // (width:480) without depending on any prior open state.
    const { container, rerender } = render(
      <TaskSidePanel taskId={null} onClose={vi.fn()} />,
    )

    const collapsed = container.querySelector<HTMLElement>(PANEL_CLASS_SELECTOR)
    if (!collapsed) throw new Error('panel container should be mounted')
    expect(collapsed.style.width).toBe('0px')

    rerender(<TaskSidePanel taskId="task-a" onClose={vi.fn()} />)

    const opened = container.querySelector<HTMLElement>(PANEL_CLASS_SELECTOR)
    if (!opened) throw new Error('panel container should still be mounted')
    expect(opened.style.width).toBe('480px')
    expect(opened.style.opacity).toBe('1')
  })

  it('respects updates to agentPanelWidth from the UI store', () => {
    // Catches: someone hard-codes a width or breaks the store
    // wiring, leaving the panel a fixed size. The panel should
    // track whatever the store says.
    useUIStore.setState({ agentPanelWidth: 600 })
    const { container, rerender } = render(
      <TaskSidePanel taskId="task-a" onClose={vi.fn()} />,
    )

    const panel = container.querySelector<HTMLElement>(PANEL_CLASS_SELECTOR)
    if (!panel) throw new Error('panel container should be rendered')
    expect(panel.style.width).toBe('600px')

    act(() => {
      useUIStore.setState({ agentPanelWidth: 720 })
    })
    rerender(<TaskSidePanel taskId="task-a" onClose={vi.fn()} />)

    const after = container.querySelector<HTMLElement>(PANEL_CLASS_SELECTOR)
    if (!after) throw new Error('panel container should be rendered')
    expect(after.style.width).toBe('720px')
  })
})
