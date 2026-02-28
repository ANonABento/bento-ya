import { useState } from 'react'
import { motion } from 'motion/react'
import { useChecklistStore } from '@/stores/checklist-store'
import type { ChecklistItem } from '@/types/checklist'

type Props = {
  item: ChecklistItem
  categoryId: string
}

export function ChecklistItemRow({ item, categoryId }: Props) {
  const toggleItem = useChecklistStore((s) => s.toggleItem)
  const updateItemNotes = useChecklistStore((s) => s.updateItemNotes)
  const [showNotes, setShowNotes] = useState(false)
  const [notes, setNotes] = useState(item.notes ?? '')

  const handleToggle = () => {
    toggleItem(item.id, categoryId)
  }

  const handleNotesBlur = () => {
    const trimmedNotes = notes.trim()
    updateItemNotes(item.id, categoryId, trimmedNotes || null)
  }

  return (
    <div className="group">
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Checkbox */}
        <button
          onClick={handleToggle}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
            item.checked
              ? 'border-success bg-success text-white'
              : 'border-border-default bg-bg hover:border-accent'
          }`}
        >
          {item.checked && (
            <motion.svg
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-3.5 w-3.5"
            >
              <path
                fillRule="evenodd"
                d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                clipRule="evenodd"
              />
            </motion.svg>
          )}
        </button>

        {/* Text and Notes */}
        <div className="min-w-0 flex-1">
          <span
            className={`text-sm transition-colors ${
              item.checked ? 'text-text-secondary line-through' : 'text-text-primary'
            }`}
          >
            {item.text}
          </span>

          {/* Notes indicator / toggle */}
          <button
            onClick={() => setShowNotes(!showNotes)}
            className={`ml-2 inline-flex items-center gap-1 text-xs transition-colors ${
              item.notes
                ? 'text-accent hover:text-accent-hover'
                : 'text-text-secondary opacity-0 group-hover:opacity-100 hover:text-text-primary'
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="h-3 w-3"
            >
              <path d="M3.665 3.588A2 2 0 0 1 5.622 2h4.756a2 2 0 0 1 1.957 1.588l1.2 6A2 2 0 0 1 11.578 12H4.422a2 2 0 0 1-1.957-2.412l1.2-6Z" />
              <path d="M3 13.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5Z" />
            </svg>
            {item.notes ? 'Notes' : 'Add note'}
          </button>
        </div>
      </div>

      {/* Notes textarea */}
      {showNotes && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden px-4 pb-3"
        >
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={handleNotesBlur}
            placeholder="Add notes..."
            className="w-full resize-none rounded-md border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            rows={2}
          />
        </motion.div>
      )}
    </div>
  )
}
