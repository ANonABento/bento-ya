import { type InputHTMLAttributes } from 'react'

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string
}

export function Input({ className = '', label, id, ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-xs text-text-secondary">
          {label}
        </label>
      )}
      <input
        id={id}
        className={`rounded-lg border border-border-default bg-surface px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 ${className}`}
        {...props}
      />
    </div>
  )
}
