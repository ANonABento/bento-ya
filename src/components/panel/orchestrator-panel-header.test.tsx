import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OrchestratorPanelHeader } from './orchestrator-panel-header'

describe('OrchestratorPanelHeader', () => {
  it('keeps header background toggle behavior while button clicks stay scoped to their own actions', () => {
    const toggleFromBackground = vi.fn()
    const onToggleSidebar = vi.fn()
    const onToggleHistory = vi.fn()
    const onNewChat = vi.fn()

    render(
      <OrchestratorPanelHeader
        isPanelCollapsed={false}
        isRightDock={false}
        sidebarMode={null}
        isProcessing={false}
        processingStartTime={null}
        canCreateNewChat
        onHeaderClick={(event) => {
          if (!(event.target as HTMLElement).closest('button')) {
            toggleFromBackground()
          }
        }}
        onToggleSidebar={onToggleSidebar}
        onToggleHistory={onToggleHistory}
        onToggleFiles={vi.fn()}
        onToggleDashboard={vi.fn()}
        onNewChat={onNewChat}
        onToggleDock={vi.fn()}
        onTogglePanel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('Chef'))
    expect(toggleFromBackground).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(onToggleSidebar).toHaveBeenCalledWith('history')
    expect(onToggleHistory).toHaveBeenCalledTimes(1)
    expect(toggleFromBackground).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /new/i }))
    expect(onNewChat).toHaveBeenCalledTimes(1)
    expect(toggleFromBackground).toHaveBeenCalledTimes(1)
  }, 20_000)

  it('keeps the New action disabled when there is no chat history', () => {
    render(
      <OrchestratorPanelHeader
        isPanelCollapsed={false}
        isRightDock={true}
        sidebarMode={null}
        isProcessing={false}
        processingStartTime={null}
        canCreateNewChat={false}
        onHeaderClick={vi.fn()}
        onToggleSidebar={vi.fn()}
        onToggleHistory={vi.fn()}
        onToggleFiles={vi.fn()}
        onToggleDashboard={vi.fn()}
        onNewChat={vi.fn()}
        onToggleDock={vi.fn()}
        onTogglePanel={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /new/i })).toBeDisabled()
  })
})
