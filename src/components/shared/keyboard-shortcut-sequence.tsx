type KeyboardShortcutSequenceProps = {
  keys: readonly string[]
  className?: string
  keyClassName?: string
  separatorClassName?: string
}

export function KeyboardShortcutSequence({
  keys,
  className = 'flex items-center gap-1',
  keyClassName = 'rounded bg-bg px-1.5 py-0.5 font-mono text-xs text-text-primary',
  separatorClassName = 'mx-0.5 text-text-secondary',
}: KeyboardShortcutSequenceProps) {
  return (
    <div className={className}>
      {keys.map((key, index) => (
        <span key={`${key}-${String(index)}`} className="inline-flex items-center gap-1">
          <kbd className={keyClassName}>{key}</kbd>
          {index < keys.length - 1 && (
            <span className={separatorClassName}>+</span>
          )}
        </span>
      ))}
    </div>
  )
}
