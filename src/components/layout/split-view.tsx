import { motion, AnimatePresence } from 'motion/react'
import { useTaskStore } from '@/stores/task-store'
import { TaskDetailPanel } from '@/components/task-detail/task-detail-panel'
import { AgentPanel } from '@/components/panel/agent-panel'

const SPRING = { type: 'spring' as const, stiffness: 300, damping: 28 }

type SplitViewProps = {
  taskId: string
  onClose: () => void
}

export function SplitView({ taskId, onClose }: SplitViewProps) {
  const tasks = useTaskStore((s) => s.tasks)
  const task = tasks.find((t) => t.id === taskId)

  if (!task) return null

  return (
    <div className="flex h-full">
      {/* Left panel — task details */}
      <motion.div
        initial={{ width: 0, opacity: 0 }}
        animate={{ width: 280, opacity: 1 }}
        exit={{ width: 0, opacity: 0 }}
        transition={SPRING}
        className="shrink-0 overflow-hidden border-r border-border-default bg-surface"
      >
        <div className="h-full w-[280px]">
          <TaskDetailPanel task={task} onClose={onClose} />
        </div>
      </motion.div>

      {/* Right panel — agent chat */}
      <motion.div
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 40 }}
        transition={SPRING}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <AgentPanel task={task} onClose={onClose} />
      </motion.div>
    </div>
  )
}

/** Side panel that slides in from the right, used alongside the kanban board */
export function TaskSidePanel({
  taskId,
  onClose,
}: {
  taskId: string | null
  onClose: () => void
}) {
  return (
    <AnimatePresence mode="wait">
      {taskId && (
        <motion.div
          key="task-side-panel"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: '50%', opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={SPRING}
          className="h-full shrink-0 overflow-hidden border-l border-border-default"
        >
          <SplitView taskId={taskId} onClose={onClose} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
