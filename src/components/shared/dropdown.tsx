import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

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
  const containerRef = useRef<HTMLDivElement>(null)

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

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => { document.removeEventListener('keydown', handleKeyDown); }
    }
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="mb-2 block text-xs font-medium text-text-secondary">{label}</label>
      )}

      {/* Trigger */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
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
            <div className="max-h-60 overflow-y-auto py-1">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value)
                    setIsOpen(false)
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                    option.value === value
                      ? 'bg-accent/10 text-text-primary'
                      : 'text-text-primary hover:bg-surface-hover'
                  }`}
                >
                  {/* Check mark for selected */}
                  <span className="w-4 shrink-0">
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
