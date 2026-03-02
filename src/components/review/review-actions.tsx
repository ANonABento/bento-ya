import type { ReviewStatus } from '@/types'

export interface ReviewActionsProps {
  reviewStatus: ReviewStatus | null
  onApprove: () => void
  onReject: () => void
  disabled?: boolean
}

/** Approve/reject buttons for manual review workflow */
export function ReviewActions({ reviewStatus, onApprove, onReject, disabled = false }: ReviewActionsProps) {
  const isApproved = reviewStatus === 'approved'
  const isRejected = reviewStatus === 'rejected'
  
  return (
    <div style={{ display: 'flex', gap: 8, padding: '12px 0', alignItems: 'center' }}>
      <button
        type="button"
        onClick={onApprove}
        disabled={disabled || isApproved}
        style={{
          padding: '6px 16px',
          borderRadius: 6,
          border: isApproved ? '1px solid #4ADE80' : '1px solid rgba(74, 222, 128, 0.5)',
          background: isApproved ? 'rgba(74, 222, 128, 0.25)' : 'rgba(74, 222, 128, 0.1)',
          color: '#4ADE80',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          cursor: disabled || isApproved ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {isApproved ? 'Approved' : 'Approve'}
      </button>
      <button
        type="button"
        onClick={onReject}
        disabled={disabled || isRejected}
        style={{
          padding: '6px 16px',
          borderRadius: 6,
          border: isRejected ? '1px solid #F87171' : '1px solid rgba(248, 113, 113, 0.5)',
          background: isRejected ? 'rgba(248, 113, 113, 0.25)' : 'rgba(248, 113, 113, 0.1)',
          color: '#F87171',
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          cursor: disabled || isRejected ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {isRejected ? 'Rejected' : 'Reject'}
      </button>
    </div>
  )
}
