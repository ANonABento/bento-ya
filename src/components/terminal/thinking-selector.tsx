interface ThinkingSelectorProps {
  level?: string
}

export function ThinkingSelector({ level = 'Normal' }: ThinkingSelectorProps) {
  return (
    <div
      className="flex cursor-not-allowed items-center gap-1 rounded px-2 py-1 text-xs text-text-muted opacity-50"
      title="Thinking level configuration coming in v0.2"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M6 1v2M6 9v2M1 6h2M9 6h2M2.5 2.5l1.4 1.4M8.1 8.1l1.4 1.4M2.5 9.5l1.4-1.4M8.1 3.9l1.4-1.4" />
      </svg>
      {level}
    </div>
  )
}
