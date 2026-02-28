import { motion, AnimatePresence } from 'motion/react'
import { useChecklistStore } from '@/stores/checklist-store'
import { ChecklistCategorySection } from './checklist-category'

export function ChecklistPanel() {
  const isOpen = useChecklistStore((s) => s.isOpen)
  const closeChecklist = useChecklistStore((s) => s.closeChecklist)
  const checklist = useChecklistStore((s) => s.checklist)
  const categories = useChecklistStore((s) => s.categories)
  const getProgress = useChecklistStore((s) => s.getProgress)

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
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                    <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                  </svg>
                </button>
              </div>

              {/* Progress bar */}
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
                    animate={{ width: `${percentage}%` }}
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
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {categories.length === 0 ? (
                <div className="flex h-full items-center justify-center text-text-secondary">
                  <p className="text-sm">No checklist attached to this workspace</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {categories.map((category) => (
                    <ChecklistCategorySection key={category.id} category={category} />
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
