import { motion, AnimatePresence } from 'motion/react'
import { useTaskStore } from '@/stores/task-store'
import { AgentPanel } from '@/components/panel/agent-panel'

const SPRING = { type: 'spring' as const, stiffness: 300, damping: 28 }

/** Chat-only side panel that slides in from the right */
export function TaskSidePanel({
  taskId,
  onClose,
}: {
  taskId: string | null
  onClose: () => void
}) {
  const tasks = useTaskStore((s) => s.tasks)
  const task = taskId ? tasks.find((t) => t.id === taskId) : null

  return (
    <AnimatePresence mode="wait">
      {task && (
        <motion.div
          key="task-chat-panel"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: '50%', opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={SPRING}
          className="h-full shrink-0 overflow-hidden border-l border-border-default"
        >
          <AgentPanel task={task} onClose={onClose} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
