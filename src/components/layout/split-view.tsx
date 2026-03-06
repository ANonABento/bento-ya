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
        animate={{ width: 240, opacity: 1 }}
        exit={{ width: 0, opacity: 0 }}
        transition={SPRING}
        className="shrink-0 overflow-hidden border-r border-border-default bg-surface"
      >
        <div className="h-full w-[240px]">
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
        <AgentPanel task={task} />
      </motion.div>
    </div>
  )
}

export function SplitViewWrapper({
  isSplitView,
  taskId,
  onClose,
}: {
  isSplitView: boolean
  taskId: string | null
  onClose: () => void
}) {
  return (
    <AnimatePresence mode="wait">
      {isSplitView && taskId && (
        <motion.div
          key="split-view"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="h-full"
        >
          <SplitView taskId={taskId} onClose={onClose} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
