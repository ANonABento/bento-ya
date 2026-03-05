import { type SelectHTMLAttributes } from 'react'

type SelectOption = {
  value: string
  label: string
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
}

export function Select({ options, value, onChange, disabled, className = '', ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => { onChange(e.target.value); }}
        disabled={disabled}
        className={`w-full appearance-none rounded-lg border border-border-default bg-surface px-3 py-2 pr-10 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 text-text-secondary"
        >
          <path
            fillRule="evenodd"
            d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </div>
    </div>
  )
}
