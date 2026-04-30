import type { Column } from '@/types'
import { Button } from '@/components/shared/button'
import { Select } from '@/components/shared/select'

type BulkTaskToolbarProps = {
  selectedCount: number
  columns: Column[]
  currentColumnIds: Set<string>
  archiveColumnId: string | null
  onMoveToColumn: (columnId: string) => void
  onArchive: () => void
  onDelete: () => void
  onClear: () => void
}

export function BulkTaskToolbar({
  selectedCount,
  columns,
  currentColumnIds,
  archiveColumnId,
  onMoveToColumn,
  onArchive,
  onDelete,
  onClear,
}: BulkTaskToolbarProps) {
  if (selectedCount <= 1) return null

  const columnOptions = [
    { value: '', label: 'Move to column...' },
    ...columns
      .filter((column) => column.visible && !currentColumnIds.has(column.id))
      .sort((a, b) => a.position - b.position)
      .map((column) => ({ value: column.id, label: column.name })),
  ]

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-lg border border-border-default bg-surface px-3 py-2 shadow-xl">
        <span className="shrink-0 text-sm font-medium text-text-primary">
          {selectedCount} selected
        </span>
        <div className="w-44">
          <Select
            aria-label="Move selected tasks to column"
            value=""
            options={columnOptions}
            onChange={(value) => {
              if (value) onMoveToColumn(value)
            }}
            className="h-8 py-1 text-xs"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onArchive}
          disabled={!archiveColumnId}
          title={archiveColumnId ? 'Move selected tasks to archive' : 'No archive column exists'}
        >
          Archive
        </Button>
        <Button type="button" size="sm" variant="danger" onClick={onDelete}>
          Delete
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  )
}
