import { type SelectHTMLAttributes } from 'react'

type DropdownOption = {
  value: string
  label: string
}

type DropdownProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  options: DropdownOption[]
  label?: string
}

export function Dropdown({ options, label, className = '', id, ...props }: DropdownProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-xs text-text-secondary">
          {label}
        </label>
      )}
      <select
        id={id}
        className={`appearance-none rounded-lg border border-border-default bg-surface px-3 py-1.5 pr-8 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 ${className}`}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
