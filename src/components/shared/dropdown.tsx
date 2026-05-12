import { useState, useRef, useEffect, useId } from 'react'
import { motion, AnimatePresence } from 'motion/react'

type DropdownOption = {
  value: string
  label: string
  description?: string
}

type DropdownProps = {
  options: DropdownOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  label?: string
}

export function Dropdown({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  label,
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const labelId = useId()

  const selected = options.find((opt) => opt.value === value)

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => { document.removeEventListener('mousedown', handleClickOutside); }
    }
  }, [isOpen])

  // Reset focused index when closing
  useEffect(() => {
    if (!isOpen) setFocusedIndex(-1)
    else {
      // Default focus to current selected option
      const idx = options.findIndex((o) => o.value === value)
      setFocusedIndex(idx >= 0 ? idx : 0)
    }
  }, [isOpen, options, value])

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'Enter':
      case ' ':
      case 'ArrowDown':
        e.preventDefault()
        if (!disabled) setIsOpen(true)
        break
      case 'ArrowUp':
        e.preventDefault()
        if (!disabled) setIsOpen(true)
        break
      case 'Escape':
        setIsOpen(false)
        break
    }
  }

  function handleListKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIndex((i) => Math.min(i + 1, options.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex((i) => Math.max(i - 1, 0))
        break
      case 'Enter':
      case ' ': {
        e.preventDefault()
        const option = options[focusedIndex]
        if (option) {
          onChange(option.value)
          setIsOpen(false)
        }
        break
      }
      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        break
      case 'Tab':
        setIsOpen(false)
        break
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label id={labelId} className="mb-2 block text-xs font-medium text-text-secondary">{label}</label>
      )}

      {/* Trigger */}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-labelledby={label ? labelId : undefined}
        onClick={() => { if (!disabled) setIsOpen(!isOpen); }}
        onKeyDown={handleTriggerKeyDown}
        disabled={disabled}
        className={`flex w-full items-center justify-between rounded-lg border bg-surface px-3 py-2 text-left text-sm transition-colors ${
          isOpen
            ? 'border-accent ring-2 ring-accent/20'
            : 'border-border-default hover:border-accent/50'
        } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
      >
        <span className={selected ? 'text-text-primary' : 'text-text-secondary/50'}>
          {selected?.label ?? placeholder}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className={`h-4 w-4 text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          <path
            fillRule="evenodd"
            d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border-default bg-surface shadow-lg"
          >
            <div
              id={listboxId}
              role="listbox"
              aria-label={label ?? placeholder}
              onKeyDown={handleListKeyDown}
              tabIndex={-1}
              className="max-h-60 overflow-y-auto py-1"
            >
              {options.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  data-focused={index === focusedIndex}
                  onClick={() => {
                    onChange(option.value)
                    setIsOpen(false)
                  }}
                  onMouseEnter={() => { setFocusedIndex(index) }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                    option.value === value
                      ? 'bg-accent/10 text-text-primary'
                      : index === focusedIndex
                        ? 'bg-surface-hover text-text-primary'
                        : 'text-text-primary hover:bg-surface-hover'
                  }`}
                >
                  {/* Check mark for selected */}
                  <span className="w-4 shrink-0" aria-hidden="true">
                    {option.value === value && (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="h-4 w-4 text-accent"
                      >
                        <path
                          fillRule="evenodd"
                          d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </span>
                  <div className="flex-1">
                    <span className="text-sm">{option.label}</span>
                    {option.description && (
                      <p className="text-xs text-text-secondary">{option.description}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
