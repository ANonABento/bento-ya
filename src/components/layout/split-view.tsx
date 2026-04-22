import { motion, AnimatePresence } from 'motion/react'
import { useTaskStore } from '@/stores/task-store'
import { useUIStore } from '@/stores/ui-store'
import { useResizablePanel } from '@/hooks/use-resizable-panel'
import { ResizeHandle } from '@/components/shared/resize-handle'
import { AgentPanel } from '@/components/panel/agent-panel'

const SPRING = { type: 'spring' as const, stiffness: 300, damping: 28 }

/** Resizable chat panel docked to the right */
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

  return (
    <AnimatePresence mode="wait">
      {task && (
        <motion.div
          key={task.id}
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: agentPanelWidth, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={isDragging ? { duration: 0 } : SPRING}
          className="relative h-full shrink-0 overflow-hidden border-l border-border-default"
        >
          <ResizeHandle
            direction="horizontal"
            position="left"
            onMouseDown={handleResize}
          />
          <AgentPanel task={task} onClose={onClose} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
