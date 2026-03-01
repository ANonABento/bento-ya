import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useTaskStore } from '@/stores/task-store'
import { TaskDetailPanel } from '@/components/task-detail/task-detail-panel'
import { TerminalView } from '@/components/terminal/terminal-view'
import { TerminalInput } from '@/components/terminal/terminal-input'
import { useAgent } from '@/hooks/use-agent'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useSettingsStore } from '@/stores/settings-store'

const SPRING = { type: 'spring' as const, stiffness: 300, damping: 28 }

type SplitViewProps = {
  taskId: string
  onClose: () => void
}

export function SplitView({ taskId, onClose }: SplitViewProps) {
  const tasks = useTaskStore((s) => s.tasks)
  const task = tasks.find((t) => t.id === taskId)

  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const workspace = workspaces.find((w) => w.id === activeWorkspaceId)

  // Get settings to determine which CLI to use
  const settings = useSettingsStore((s) => s.getEffective(activeWorkspaceId ?? ''))

  // Find enabled provider that uses CLI mode
  const cliProvider = settings.model.providers.find(
    (p) => p.enabled && p.connectionMode === 'cli'
  )
  const cliPath = cliProvider?.cliPath ?? cliProvider?.id

  const hasStartedRef = useRef(false)
  const prevTaskIdRef = useRef(taskId)
  const { status: agentStatus, startAgent, stopAgent, forceStopAgent } = useAgent({
    taskId,
    agentType: cliProvider?.id ?? 'claude',
    workingDir: workspace?.repoPath,
    cliPath,
  })

  // Reset start flag when taskId changes
  useEffect(() => {
    if (prevTaskIdRef.current !== taskId) {
      hasStartedRef.current = false
      prevTaskIdRef.current = taskId
    }
  }, [taskId])

  // Auto-start agent when split view opens
  useEffect(() => {
    if (!hasStartedRef.current && workspace?.repoPath && cliPath) {
      hasStartedRef.current = true
      void startAgent()
    }
  }, [workspace?.repoPath, cliPath, startAgent])

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

      {/* Right panel — terminal */}
      <motion.div
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 40 }}
        transition={SPRING}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="flex-1 overflow-hidden">
          <TerminalView
            taskId={taskId}
            isActive={true}
          />
        </div>
        <TerminalInput
          taskId={taskId}
          agentStatus={agentStatus}
          onStop={() => { void stopAgent() }}
          onForceStop={() => { void forceStopAgent() }}
          autoFocus
        />
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
