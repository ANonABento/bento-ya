import { useTaskStore } from '@/stores/task-store'
import { useUIStore } from '@/stores/ui-store'
import { useResizablePanel } from '@/hooks/use-resizable-panel'
import { ResizeHandle } from '@/components/shared/resize-handle'
import { AgentPanel } from '@/components/panel/agent-panel'

/** Resizable chat panel docked to the right side of the board.
 *
 * Open / close uses a CSS `width` transition instead of Framer Motion.
 * Why CSS and not motion?
 *
 *   PR #192 added `<AgentPanel key={task.id}>` inside an outer
 *   `<motion.div>` to force a remount on task switch. In some lifecycle
 *   sequences (HMR refresh, tight task→task switching, React StrictMode
 *   double-invokes) motion's animation state could end up convinced
 *   it had animated to the target while motion's async keyframe
 *   resolver had never flushed — leaving the actual element stuck at
 *   the `initial` values (`width: 0; opacity: 0`). The panel mounted
 *   but never visibly opened, so users couldn't see streaming agent
 *   output. With `mode="wait"` the exit on the old key never resolved
 *   either, so the new panel never got to mount at all.
 *
 *   Plain CSS doesn't depend on a JS frame-loop or async keyframe
 *   resolution. The browser sets the inline width on render and
 *   transitions to the target width over `--panel-anim-duration`.
 *   No queued-but-unresolved animations, no stuck exit, no remount-
 *   per-task gymnastics.
 *
 * Stale-content protection (the original reason #192 keyed the inner
 * AgentPanel): we still key `<AgentPanel key={task?.id}>` so switching
 * between tasks unmounts the previous AgentPanel + TerminalView +
 * xterm instance before the new one mounts. That kills any in-flight
 * `ensure_pty_session` / scrollback fetches / Tauri listeners from
 * the old task before they can race with the new task's render.
 *
 * The container itself stays mounted (collapsed to width 0) when no
 * task is selected. Keeping it in the DOM means the CSS transition has
 * an element to animate.
 */

// Animation timing matches the previous Framer Motion spring's
// perceived duration; tuned to feel snappy without overshoot.
const PANEL_ANIM_MS = 200

export function TaskSidePanel({
  taskId,
  onClose,
}: {
  taskId: string | null
  onClose: () => void
}) {
  const tasks = useTaskStore((s) => s.tasks)
  const task = taskId ? tasks.find((t) => t.id === taskId) : null

  const agentPanelWidth = useUIStore((s) => s.agentPanelWidth)
  const setAgentPanelWidth = useUIStore((s) => s.setAgentPanelWidth)

  const { handleMouseDown: handleResize, isDragging } = useResizablePanel({
    direction: 'horizontal',
    size: agentPanelWidth,
    onResize: setAgentPanelWidth,
    disabled: !task,
  })

  const isOpen = !!task
  const targetWidth = isOpen ? agentPanelWidth : 0

  // While the user is actively dragging the resize handle, kill the
  // transition so the panel tracks the cursor 1:1. We restore it as
  // soon as the drag ends.
  const transition = isDragging
    ? 'none'
    : `width ${String(PANEL_ANIM_MS)}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${String(PANEL_ANIM_MS)}ms ease`

  return (
    <div
      className="relative h-full shrink-0 overflow-hidden border-l border-border-default"
      style={{
        width: `${String(targetWidth)}px`,
        opacity: isOpen ? 1 : 0,
        transition,
        // Hide the border when collapsed so a 1px slice doesn't peek
        // out at the edge of the board.
        borderLeftWidth: isOpen ? undefined : 0,
        // Collapsed panel must not catch pointer events (would steal
        // hover/click on the column behind it).
        pointerEvents: isOpen ? undefined : 'none',
      }}
      // Hide from the a11y tree when collapsed.
      aria-hidden={isOpen ? undefined : true}
    >
      <ResizeHandle
        direction="horizontal"
        position="left"
        onMouseDown={handleResize}
      />
      {/*
        Key AgentPanel by task.id so the inner panel + TerminalView +
        xterm fully unmount on task switch. This is the stale-content
        fix from PR #192, kept here. We render `null` when no task is
        active so `useMemo`/`useEffect` chains inside AgentPanel don't
        run against a stale taskId.
      */}
      {task && <AgentPanel key={task.id} task={task} onClose={onClose} />}
    </div>
  )
}
