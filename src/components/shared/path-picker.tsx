import { useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'

type PathPickerProps = {
  value: string
  onChange: (path: string) => void
  readOnly?: boolean
  placeholder?: string
}

export function PathPicker({ value, onChange, readOnly, placeholder = '/path/to/repo' }: PathPickerProps) {
  const handleBrowse = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false })
      if (selected) {
        onChange(selected)
      }
    } catch {
      // User cancelled or dialog error — ignore
    }
  }, [onChange])

  return (
    <div className="flex gap-2">
      <input
        type="text"
        readOnly={readOnly}
        value={value}
        onChange={readOnly ? undefined : (e) => { onChange(e.target.value) }}
        placeholder={placeholder}
        className="flex-1 rounded-lg border border-border-default bg-bg px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      <button
        type="button"
        onClick={() => { void handleBrowse() }}
        className="shrink-0 rounded-lg border border-border-default bg-bg px-3 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover"
      >
        Browse
      </button>
    </div>
  )
}
