import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModelUsageWarningBanner } from './model-usage-warning-banner'
import type { UsageByModelSummary } from '@/lib/ipc'

const usage: UsageByModelSummary[] = [
  {
    model: 'claude-sonnet-4-6-20260217',
    totalInputTokens: 700,
    totalOutputTokens: 100,
    totalCostUsd: 0.25,
    recordCount: 2,
  },
  {
    model: 'codex-5.3',
    totalInputTokens: 300,
    totalOutputTokens: 100,
    totalCostUsd: 0.05,
    recordCount: 1,
  },
]

describe('ModelUsageWarningBanner', () => {
  it('shows models at or above 80 percent of their daily token budget', () => {
    render(
      <ModelUsageWarningBanner
        usage={usage}
        modelBudgets={{
          'claude-sonnet-4-6-20260217': 1_000,
          'codex-5.3': 1_000,
        }}
        dismissed={new Set()}
        onDismiss={vi.fn()}
      />,
    )

    expect(screen.getByText('claude-sonnet-4-6-20260217')).toBeInTheDocument()
    expect(screen.getByText(/exceeded 80% of budget/)).toBeInTheDocument()
    expect(screen.getByText(/\(800\/1\.0K tokens,/)).toBeInTheDocument()
    expect(screen.queryByText('codex-5.3')).not.toBeInTheDocument()
  })

  it('hides dismissed models', () => {
    render(
      <ModelUsageWarningBanner
        usage={usage}
        modelBudgets={{ 'claude-sonnet-4-6-20260217': 1_000 }}
        dismissed={new Set(['claude-sonnet-4-6-20260217'])}
        onDismiss={vi.fn()}
      />,
    )

    expect(screen.queryByText('Token limit warning:')).not.toBeInTheDocument()
  })

  it('calls onDismiss from the dismiss button', () => {
    const onDismiss = vi.fn()

    render(
      <ModelUsageWarningBanner
        usage={usage}
        modelBudgets={{ 'claude-sonnet-4-6-20260217': 1_000 }}
        dismissed={new Set()}
        onDismiss={onDismiss}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /dismiss token usage warning/i }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
