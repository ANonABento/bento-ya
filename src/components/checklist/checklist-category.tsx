import { motion, AnimatePresence } from 'motion/react'
import { useChecklistStore } from '@/stores/checklist-store'
import type { ChecklistCategory, ChecklistItem } from '@/types/checklist'
import { ChecklistItemRow } from './checklist-item'

type Props = {
  category: ChecklistCategory
  onFixThis?: (item: ChecklistItem) => void
}

export function ChecklistCategorySection({ category, onFixThis }: Props) {
  const items = useChecklistStore((s) => s.items[category.id] ?? [])
  const toggleCategory = useChecklistStore((s) => s.toggleCategory)

  const checkedCount = items.filter((item) => item.checked).length
  const totalCount = items.length
  const percentage = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0

  return (
    <div className="overflow-hidden rounded-lg border border-border-default bg-surface">
      {/* Category Header */}
      <button
        onClick={() => { toggleCategory(category.id) }}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-bg"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{category.icon}</span>
          <span className="font-medium text-text-primary">{category.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-secondary">
            {checkedCount}/{totalCount}
          </span>
          <div className="h-2 w-16 overflow-hidden rounded-full bg-bg">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                percentage === 100
                  ? 'bg-success'
                  : percentage >= 50
                    ? 'bg-accent'
                    : 'bg-text-secondary'
              }`}
              style={{ width: `${String(percentage)}%` }}
            />
          </div>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`h-5 w-5 text-text-secondary transition-transform ${
              category.collapsed ? '' : 'rotate-180'
            }`}
          >
            <path
              fillRule="evenodd"
              d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </button>

      {/* Items */}
      <AnimatePresence initial={false}>
        {!category.collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border-default">
              {items.length === 0 ? (
                <div className="px-4 py-3 text-sm text-text-secondary">
                  No items in this category
                </div>
              ) : (
                <div className="divide-y divide-border-default">
                  {items.map((item) => (
                    <ChecklistItemRow
                      key={item.id}
                      item={item}
                      categoryId={category.id}
                      onFixThis={onFixThis}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
