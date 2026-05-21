import { useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { useNativeInput } from '@/hooks/use-native-input'
import { getErrorMessage } from '@/lib/errors'

type PathPickerProps = {
  value: string
  onChange: (path: string) => void
  onError?: (message: string) => void
  readOnly?: boolean
  placeholder?: string
}

export function PathPicker({ value, onChange, onError, readOnly, placeholder = '/path/to/repo' }: PathPickerProps) {
  const { ref, handleChange } = useNativeInput(onChange)

  const handleBrowse = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false })
      if (selected) {
        onChange(selected)
      }
    } catch (err) {
      onError?.(`Could not open folder picker: ${getErrorMessage(err)}`)
    }
  }, [onChange, onError])

  return (
    <div className="flex gap-2">
      <input
        ref={readOnly ? undefined : ref}
        type="text"
        readOnly={readOnly}
        value={value}
        onChange={readOnly ? undefined : handleChange}
        placeholder={placeholder}
        data-testid="path-picker"
        className="flex-1 rounded-lg border border-border-default bg-bg px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      <button
        type="button"
        onClick={() => { void handleBrowse() }}
        style={{ cursor: 'pointer' }}
        className="shrink-0 rounded-lg border border-border-default bg-bg px-3 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover"
      >
        Browse
      </button>
    </div>
  )
}
