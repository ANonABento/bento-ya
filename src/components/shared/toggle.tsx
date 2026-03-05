import { motion } from 'motion/react'

type ToggleProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  size?: 'sm' | 'md'
}

const sizes = {
  sm: { track: 'h-5 w-9', thumb: 'h-4 w-4', translate: 'translate-x-4' },
  md: { track: 'h-6 w-11', thumb: 'h-5 w-5', translate: 'translate-x-5' },
}

export function Toggle({ checked, onChange, disabled = false, size = 'sm' }: ToggleProps) {
  const s = sizes[size]

  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => { onChange(!checked); }}
      className={`relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50 ${s.track} ${
        checked ? 'bg-accent' : 'bg-surface-hover'
      }`}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className={`inline-block rounded-full bg-white shadow-sm ${s.thumb} ${
          checked ? s.translate : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
