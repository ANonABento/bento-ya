export interface ReviewActionsProps {
  onApprove?: () => void
  onReject?: () => void
  disabled?: boolean
}

/** Placeholder approve/reject buttons for v0.1 — full pipeline integration in v0.2. */
export function ReviewActions({ onApprove, onReject, disabled = false }: ReviewActionsProps) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '12px 0' }}>
      <button
        type="button"
        onClick={onApprove}
        disabled={disabled}
        style={{
          padding: '6px 16px',
          borderRadius: 6,
          border: '1px solid #4ADE80',
          background: 'rgba(74, 222, 128, 0.1)',
          color: '#4ADE80',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        Approve
      </button>
      <button
        type="button"
        onClick={onReject}
        disabled={disabled}
        style={{
          padding: '6px 16px',
          borderRadius: 6,
          border: '1px solid #F87171',
          background: 'rgba(248, 113, 113, 0.1)',
          color: '#F87171',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        Reject
      </button>
    </div>
  )
}
