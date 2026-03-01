import { type ReactNode, type MouseEvent, forwardRef } from 'react'
import { Tooltip } from './tooltip'

type IconButtonProps = {
  icon: ReactNode
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  tooltip?: string
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right'
  size?: 'sm' | 'md'
  variant?: 'ghost' | 'subtle'
  className?: string
  disabled?: boolean
}

const sizeClasses = {
  sm: 'h-5 w-5',
  md: 'h-7 w-7',
}

const variantClasses = {
  ghost: 'text-text-secondary/50 hover:bg-surface-hover hover:text-text-secondary',
  subtle: 'text-text-secondary/70 hover:bg-surface-hover hover:text-text-primary',
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      icon,
      onClick,
      tooltip,
      tooltipSide = 'top',
      size = 'sm',
      variant = 'ghost',
      className = '',
      disabled = false,
    },
    ref
  ) {
    const button = (
      <button
        ref={ref}
        onClick={onClick}
        disabled={disabled}
        className={`flex items-center justify-center rounded transition-colors ${sizeClasses[size]} ${variantClasses[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      >
        {icon}
      </button>
    )

    if (tooltip) {
      return (
        <Tooltip content={tooltip} side={tooltipSide}>
          {button}
        </Tooltip>
      )
    }

    return button
  }
)
