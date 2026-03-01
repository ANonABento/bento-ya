type SegmentedControlProps<T extends string> = {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
  labels?: Partial<Record<T, string>>
  icons?: Partial<Record<T, React.ReactNode>>
  size?: 'sm' | 'md'
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  labels,
  icons,
  size = 'md',
}: SegmentedControlProps<T>) {
  const sizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
  }

  const buttonPadding = {
    sm: 'px-3 py-1.5',
    md: 'px-4 py-2',
  }

  return (
    <div className="inline-flex rounded-lg border border-border-default bg-surface p-1">
      {options.map((option) => {
        const isSelected = option === value
        const label = labels?.[option] ?? option
        const icon = icons?.[option]

        return (
          <button
            key={option}
            onClick={() => onChange(option)}
            className={`relative flex items-center justify-center gap-1.5 rounded-md font-medium capitalize transition-all ${buttonPadding[size]} ${sizeClasses[size]} ${
              isSelected
                ? 'bg-accent text-bg'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
            }`}
          >
            {icon}
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
