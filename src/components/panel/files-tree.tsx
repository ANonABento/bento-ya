import { useState } from 'react'
import type { FileEntry } from '@/lib/ipc'
import type { GroupedFiles, FileCategory } from '@/hooks/use-workspace-files'

type FilesTreeProps = {
  groupedFiles: GroupedFiles
  selectedFile: FileEntry | null
  onSelectFile: (file: FileEntry) => void
  loading?: boolean
}

type CategoryConfig = {
  key: FileCategory
  label: string
  icon: React.ReactNode
}

const CATEGORIES: CategoryConfig[] = [
  {
    key: 'context',
    label: 'Context',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
        <path d="M2 4a2 2 0 0 1 2-2h4.586A2 2 0 0 1 10 2.586L13.414 6A2 2 0 0 1 14 7.414V12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Z" />
      </svg>
    ),
  },
  {
    key: 'tickets',
    label: 'Tickets',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
        <path fillRule="evenodd" d="M1 8.74c0 .983.713 1.825 1.69 1.943.904.108 1.817.19 2.737.243a25.86 25.86 0 0 0 3.163.01c.675-.033 1.323-.095 1.943-.185A.75.75 0 0 0 12 10.02V8.5a.75.75 0 0 0-.75-.75H9.5a.75.75 0 0 1 0-1.5h1.75A.75.75 0 0 0 12 5.5V3.75a.75.75 0 0 0-.75-.75H4.75A.75.75 0 0 0 4 3.75v1.5a.75.75 0 0 1-1.5 0V3.562c0-.783.512-1.488 1.27-1.704A29.426 29.426 0 0 1 8 1.25c1.437 0 2.866.12 4.23.348.758.126 1.27.831 1.27 1.62v5.407c0 .818-.544 1.54-1.323 1.72a27.75 27.75 0 0 1-2.098.396v1.509a.75.75 0 0 1-.236.547l-2.75 2.638a.75.75 0 0 1-1.036 0l-2.75-2.638a.75.75 0 0 1-.236-.547v-1.509a27.71 27.71 0 0 1-2.098-.396A1.754 1.754 0 0 1 1 8.74Z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    key: 'notes',
    label: 'Notes',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
        <path fillRule="evenodd" d="M4 1.75a.75.75 0 0 1 1.5 0V3h5V1.75a.75.75 0 0 1 1.5 0V3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2V1.75ZM4.5 6a1 1 0 0 0-1 1v4.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-7Z" clipRule="evenodd" />
      </svg>
    ),
  },
]

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${String(days)}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function FilesTree({ groupedFiles, selectedFile, onSelectFile, loading }: FilesTreeProps) {
  const [collapsed, setCollapsed] = useState<Record<FileCategory, boolean>>({
    context: false,
    tickets: false,
    notes: false,
  })

  const toggleCategory = (category: FileCategory) => {
    setCollapsed((prev) => ({ ...prev, [category]: !prev[category] }))
  }

  const totalFiles = groupedFiles.context.length + groupedFiles.tickets.length + groupedFiles.notes.length

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-text-secondary/30 border-t-text-secondary" />
      </div>
    )
  }

  if (totalFiles === 0) {
    return (
      <div className="py-8 text-center">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-8 w-8 mx-auto text-text-secondary/30 mb-2">
          <path d="M3.75 3A1.75 1.75 0 0 0 2 4.75v3.26a3.235 3.235 0 0 1 1.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0 0 16.25 5h-4.836a.25.25 0 0 1-.177-.073L9.823 3.513A1.75 1.75 0 0 0 8.586 3H3.75Z" />
          <path fillRule="evenodd" d="M2 9.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 .75.75v5a1.75 1.75 0 0 1-1.75 1.75H3.75A1.75 1.75 0 0 1 2 14.25v-5Z" clipRule="evenodd" />
        </svg>
        <p className="text-xs text-text-secondary/70">No markdown files found</p>
        <p className="text-xs text-text-secondary/50 mt-1">Add .md files to your workspace</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {CATEGORIES.map((cat) => {
        const files = groupedFiles[cat.key]
        if (files.length === 0) return null

        const isCollapsed = collapsed[cat.key]

        return (
          <div key={cat.key}>
            {/* Category header */}
            <button
              type="button"
              onClick={() => { toggleCategory(cat.key) }}
              className="w-full flex items-center gap-2 px-2 py-1 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className={`h-3 w-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
              >
                <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
              {cat.icon}
              <span className="flex-1 text-left">{cat.label}</span>
              <span className="text-text-secondary/50">{files.length}</span>
            </button>

            {/* Files list */}
            {!isCollapsed && (
              <ul className="ml-3 space-y-0.5">
                {files.map((file) => {
                  const isSelected = selectedFile?.path === file.path

                  return (
                    <li key={file.path}>
                      <button
                        type="button"
                        onClick={() => { onSelectFile(file) }}
                        className={`w-full flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors ${
                          isSelected
                            ? 'bg-surface-hover text-text-primary'
                            : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                        }`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 shrink-0 text-text-secondary/50">
                          <path fillRule="evenodd" d="M4 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.414A2 2 0 0 0 13.414 6L10 2.586A2 2 0 0 0 8.586 2H4Zm5 2a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H9Z" clipRule="evenodd" />
                        </svg>
                        <span className="truncate flex-1">{file.name}</span>
                        <span className="text-text-secondary/40 text-[10px]">{formatDate(file.modifiedAt)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
