import { type ReactNode } from 'react'

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
        onChange={(e) => onChange(parseFloat(e.target.value))}
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
