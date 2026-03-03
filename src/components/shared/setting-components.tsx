import { type ReactNode, useState, useCallback, useRef, useEffect } from 'react'

// ─── SettingSection ──────────────────────────────────────────────────────────

type SettingSectionProps = {
  title: string
  description?: string
  children: ReactNode
  border?: boolean
}

export function SettingSection({ title, description, children, border = false }: SettingSectionProps) {
  return (
    <section className={border ? 'border-t border-border-default pt-6' : ''}>
      <div className="mb-4">
        <h3 className="text-sm font-medium text-text-primary">{title}</h3>
        {description && (
          <p className="mt-1 text-xs text-text-secondary">{description}</p>
        )}
      </div>
      {children}
    </section>
  )
}

// ─── SettingRow ──────────────────────────────────────────────────────────────

type SettingRowProps = {
  label: string
  description?: string
  children: ReactNode
  vertical?: boolean
}

export function SettingRow({ label, description, children, vertical = false }: SettingRowProps) {
  if (vertical) {
    return (
      <div className="space-y-2">
        <div>
          <label className="text-sm text-text-primary">{label}</label>
          {description && (
            <p className="mt-0.5 text-xs text-text-secondary">{description}</p>
          )}
        </div>
        {children}
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        <label className="text-sm text-text-primary">{label}</label>
        {description && (
          <p className="mt-0.5 text-xs text-text-secondary">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

// ─── SettingCard ─────────────────────────────────────────────────────────────

type SettingCardProps = {
  children: ReactNode
  active?: boolean
  onClick?: () => void
  className?: string
}

export function SettingCard({ children, active = false, onClick, className = '' }: SettingCardProps) {
  const Component = onClick ? 'button' : 'div'

  return (
    <Component
      onClick={onClick}
      className={`flex w-full flex-col items-start rounded-lg border p-3 text-left transition-colors ${
        active
          ? 'border-accent bg-accent/5'
          : 'border-border-default hover:border-accent/50'
      } ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {children}
    </Component>
  )
}

// ─── SettingInput ────────────────────────────────────────────────────────────

type SettingInputProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  type?: 'text' | 'password'
  mono?: boolean
}

export function SettingInput({
  value,
  onChange,
  placeholder,
  disabled = false,
  type = 'text',
  mono = false,
}: SettingInputProps) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50 ${
        mono ? 'font-mono' : ''
      }`}
    />
  )
}

// ─── SettingTextarea ─────────────────────────────────────────────────────────

type SettingTextareaProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  rows?: number
}

export function SettingTextarea({
  value,
  onChange,
  placeholder,
  disabled = false,
  rows = 4,
}: SettingTextareaProps) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
      className="w-full resize-none rounded-lg border border-border-default bg-surface px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-secondary/50 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
    />
  )
}

// ─── SettingSlider ───────────────────────────────────────────────────────────

type SettingSliderProps = {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  disabled?: boolean
  showValue?: boolean
  formatValue?: (value: number) => string
}

export function SettingSlider({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled = false,
  showValue = true,
  formatValue = (v) => String(v),
}: SettingSliderProps) {
  return (
    <div className="flex items-center gap-4">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => { onChange(parseFloat(e.target.value)) }}
        disabled={disabled}
        className="flex-1 accent-accent disabled:opacity-50"
      />
      {showValue && (
        <span className="w-12 text-right text-sm tabular-nums text-text-primary">
          {formatValue(value)}
        </span>
      )}
    </div>
  )
}

// ─── ShortcutRecorder ─────────────────────────────────────────────────────────

type ShortcutRecorderProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

function formatKey(key: string): string {
  const keyMap: Record<string, string> = {
    Meta: '⌘',
    Control: 'Ctrl',
    Alt: '⌥',
    Shift: '⇧',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    Backspace: '⌫',
    Delete: 'Del',
    Enter: '↵',
    Tab: '⇥',
    ' ': 'Space',
  }
  return keyMap[key] ?? key.toUpperCase()
}

export function ShortcutRecorder({
  value,
  onChange,
  placeholder = 'Click to record shortcut',
  disabled = false,
}: ShortcutRecorderProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [pressedKeys, setPressedKeys] = useState<string[]>([])
  const inputRef = useRef<HTMLButtonElement>(null)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const key = e.key

    // Ignore lone modifier keys until a regular key is pressed
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) {
      setPressedKeys((prev) => {
        if (!prev.includes(key)) {
          return [...prev, key]
        }
        return prev
      })
      return
    }

    // Build the shortcut string
    const modifiers: string[] = []
    if (e.metaKey) modifiers.push('Cmd')
    if (e.ctrlKey) modifiers.push('Ctrl')
    if (e.altKey) modifiers.push('Alt')
    if (e.shiftKey) modifiers.push('Shift')

    const shortcut = [...modifiers, formatKey(key)].join('+')
    onChange(shortcut)
    setIsRecording(false)
    setPressedKeys([])
    inputRef.current?.blur()
  }, [onChange])

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    const key = e.key
    setPressedKeys((prev) => prev.filter((k) => k !== key))
  }, [])

  useEffect(() => {
    if (isRecording) {
      window.addEventListener('keydown', handleKeyDown)
      window.addEventListener('keyup', handleKeyUp)
      return () => {
        window.removeEventListener('keydown', handleKeyDown)
        window.removeEventListener('keyup', handleKeyUp)
      }
    }
  }, [isRecording, handleKeyDown, handleKeyUp])

  const displayValue = isRecording
    ? pressedKeys.length > 0
      ? pressedKeys.map(formatKey).join('+') + '...'
      : 'Press keys...'
    : value || placeholder

  return (
    <div className="flex items-center gap-2">
      <button
        ref={inputRef}
        type="button"
        onClick={() => { if (!disabled) setIsRecording(true) }}
        onBlur={() => {
          setIsRecording(false)
          setPressedKeys([])
        }}
        disabled={disabled}
        className={`flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50 ${
          isRecording
            ? 'border-accent bg-accent/10 text-accent'
            : value
              ? 'border-border-default bg-surface text-text-primary'
              : 'border-border-default bg-surface text-text-secondary/50'
        }`}
      >
        <span className="font-mono">{displayValue}</span>
      </button>
      {value && !disabled && (
        <button
          type="button"
          onClick={() => { onChange('') }}
          className="rounded p-1.5 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          title="Clear shortcut"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm2.78-4.22a.75.75 0 0 1-1.06 0L8 9.06l-1.72 1.72a.75.75 0 0 1-1.06-1.06L6.94 8 5.22 6.28a.75.75 0 0 1 1.06-1.06L8 6.94l1.72-1.72a.75.75 0 1 1 1.06 1.06L9.06 8l1.72 1.72a.75.75 0 0 1 0 1.06Z" clipRule="evenodd" />
          </svg>
        </button>
      )}
    </div>
  )
}
