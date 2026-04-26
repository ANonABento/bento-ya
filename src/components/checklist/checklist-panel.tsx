import { useEffect, useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useChecklistStore } from '@/stores/checklist-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useTaskStore } from '@/stores/task-store'
import { useColumnStore } from '@/stores/column-store'
import { ChecklistCategorySection } from './checklist-category'
import { LoadingSpinner } from '@/components/shared/loading-spinner'
import type { ChecklistItem } from '@/types/checklist'

export function ChecklistPanel() {
  const isOpen = useChecklistStore((s) => s.isOpen)
  const closeChecklist = useChecklistStore((s) => s.closeChecklist)
  const checklist = useChecklistStore((s) => s.checklist)
  const categories = useChecklistStore((s) => s.categories)
  const isLoading = useChecklistStore((s) => s.isLoading)
  const loadChecklist = useChecklistStore((s) => s.loadChecklist)
  const currentWorkspaceId = useChecklistStore((s) => s.currentWorkspaceId)
  const getProgress = useChecklistStore((s) => s.getProgress)
  const getTemplates = useChecklistStore((s) => s.getTemplates)
  const createChecklist = useChecklistStore((s) => s.createChecklist)
  const deleteChecklist = useChecklistStore((s) => s.deleteChecklist)
  const linkItemToTask = useChecklistStore((s) => s.linkItemToTask)
  const runDetection = useChecklistStore((s) => s.runDetection)
  const items = useChecklistStore((s) => s.items)

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const columns = useColumnStore((s) => s.columns)
  const addTask = useTaskStore((s) => s.add)

  const [isDetecting, setIsDetecting] = useState(false)
  const [detectionError, setDetectionError] = useState<string | null>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState('production-readiness')

  // Get the active workspace's repo path
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const repoPath = activeWorkspace?.repoPath
  const templates = getTemplates()
  const selectedTemplate =
    templates.find((template) => template.id === selectedTemplateId) ?? templates[0]

  // Handle auto-detect button click
  const handleRunDetection = useCallback(async () => {
    if (!activeWorkspaceId || !repoPath || isDetecting) return

    setIsDetecting(true)
    setDetectionError(null)

    try {
      await runDetection(activeWorkspaceId, repoPath)
    } catch (error) {
      setDetectionError(error instanceof Error ? error.message : 'Detection failed')
    } finally {
      setIsDetecting(false)
    }
  }, [activeWorkspaceId, repoPath, isDetecting, runDetection])

  const handleCreateChecklist = useCallback(async () => {
    if (!activeWorkspaceId || !selectedTemplate) return

    await createChecklist(activeWorkspaceId, selectedTemplate)
  }, [activeWorkspaceId, createChecklist, selectedTemplate])

  const handleDeleteChecklist = useCallback(async () => {
    if (!activeWorkspaceId || !checklist) return
    if (!window.confirm(`Delete "${checklist.name}"?`)) return

    await deleteChecklist(activeWorkspaceId)
  }, [activeWorkspaceId, checklist, deleteChecklist])

  // Handle "Fix this" button - create a task linked to the checklist item
  const handleFixThis = useCallback(
    async (item: ChecklistItem) => {
      if (!activeWorkspaceId) return

      // Find the first column (usually "Backlog") to add the task to
      const firstColumn = columns[0]
      if (!firstColumn) return

      try {
        // Create a task with the checklist item text as the title
        const newTask = await addTask(
          activeWorkspaceId,
          firstColumn.id,
          `Fix: ${item.text}`,
          `Created from checklist item. Detection type: ${item.detectType ?? 'none'}`,
        )

        linkItemToTask(item.id, item.categoryId, newTask.id)
      } catch {
        // Task creation failure handled by store
      }
    },
    [activeWorkspaceId, columns, addTask, linkItemToTask],
  )

  // Count items with detection configured
  const detectableItemCount = Object.values(items)
    .flat()
    .filter((item) => item.detectType && item.detectType !== 'none').length

  // Load checklist when panel opens or workspace changes
  useEffect(() => {
    if (isOpen && activeWorkspaceId && activeWorkspaceId !== currentWorkspaceId) {
      void loadChecklist(activeWorkspaceId)
    }
  }, [isOpen, activeWorkspaceId, currentWorkspaceId, loadChecklist])

  const { progress, total, percentage } = getProgress()

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeChecklist}
            className="fixed inset-0 z-40 bg-black/50"
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-lg flex-col border-l border-border-default bg-bg shadow-2xl"
          >
            {/* Header */}
            <div className="border-b border-border-default px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-text-primary">
                    {checklist?.name ?? 'Production Checklist'}
                  </h2>
                  {checklist?.description && (
                    <p className="mt-1 text-sm text-text-secondary">{checklist.description}</p>
                  )}
                </div>
                <button
                  onClick={closeChecklist}
                  className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-surface hover:text-text-primary"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-5 w-5"
                  >
                    <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                  </svg>
                </button>
              </div>

              {checklist && (
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => {
                      void handleDeleteChecklist()
                    }}
                    className="rounded-md border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-error hover:text-error"
                  >
                    Delete checklist
                  </button>
                </div>
              )}

              {/* Progress bar */}
              {checklist && (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">Overall Progress</span>
                    <span className="font-medium text-text-primary">
                      {progress}/{total} ({percentage}%)
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${String(percentage)}%` }}
                      transition={{ duration: 0.3 }}
                      className={`h-full rounded-full ${
                        percentage === 100
                          ? 'bg-success'
                          : percentage >= 75
                            ? 'bg-accent'
                            : percentage >= 50
                              ? 'bg-warning'
                              : 'bg-text-secondary'
                      }`}
                    />
                  </div>
                </div>
              )}

              {/* Auto-detect button */}
              {detectableItemCount > 0 && repoPath && (
                <div className="mt-4">
                  <button
                    onClick={() => {
                      void handleRunDetection()
                    }}
                    disabled={isDetecting}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-accent bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
                  >
                    {isDetecting ? (
                      <>
                        <LoadingSpinner />
                        Running detection...
                      </>
                    ) : (
                      <>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className="h-4 w-4"
                        >
                          <path
                            fillRule="evenodd"
                            d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0v2.43l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389 5.5 5.5 0 0 1 9.201-2.466l.312.311h-2.433a.75.75 0 0 0 0 1.5h4.244a.75.75 0 0 0 .53-.22Z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Run Auto-detect ({detectableItemCount} items)
                      </>
                    )}
                  </button>
                  {detectionError && <p className="mt-2 text-xs text-error">{detectionError}</p>}
                </div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {isLoading ? (
                <div className="flex h-full items-center justify-center text-text-secondary">
                  <div className="flex items-center gap-2">
                    <LoadingSpinner size="lg" />
                    <span className="text-sm">Loading checklist...</span>
                  </div>
                </div>
              ) : !checklist ? (
                <div className="flex h-full items-center justify-center">
                  <div className="w-full max-w-sm space-y-4">
                    <div>
                      <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                        Template
                      </label>
                      <select
                        value={selectedTemplate?.id ?? ''}
                        onChange={(event) => {
                          setSelectedTemplateId(event.target.value)
                        }}
                        className="mt-2 w-full rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      >
                        {templates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {selectedTemplate && (
                      <p className="text-sm text-text-secondary">{selectedTemplate.description}</p>
                    )}
                    <button
                      onClick={() => {
                        void handleCreateChecklist()
                      }}
                      disabled={!activeWorkspaceId || !selectedTemplate}
                      className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                    >
                      Create checklist
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {categories.map((category) => (
                    <ChecklistCategorySection
                      key={category.id}
                      category={category}
                      onFixThis={(item) => {
                        void handleFixThis(item)
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
