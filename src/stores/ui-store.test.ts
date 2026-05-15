import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from './ui-store'

describe('ui-store', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1200,
    })
    useUIStore.setState({
      isPanelCollapsed: false,
      viewMode: 'board',
      activeTaskId: null,
      agentPanelWidth: 500,
    })
  })

  describe('togglePanel', () => {
    it('defaults to not collapsed', () => {
      expect(useUIStore.getState().isPanelCollapsed).toBe(false)
    })

    it('togglePanel collapses and expands', () => {
      useUIStore.getState().togglePanel()
      expect(useUIStore.getState().isPanelCollapsed).toBe(true)
      useUIStore.getState().togglePanel()
      expect(useUIStore.getState().isPanelCollapsed).toBe(false)
    })
  })

  describe('agent panel sizing', () => {
    it('opens chat without overwriting the persisted agent panel width', () => {
      useUIStore.setState({ agentPanelWidth: 760 })

      useUIStore.getState().openChat('task-1')

      expect(useUIStore.getState().viewMode).toBe('chat')
      expect(useUIStore.getState().activeTaskId).toBe('task-1')
      expect(useUIStore.getState().agentPanelWidth).toBe(760)
    })

    it('clamps an oversized persisted agent panel width when opening chat', () => {
      useUIStore.setState({ agentPanelWidth: 2000 })

      useUIStore.getState().openChat('task-1')

      expect(useUIStore.getState().agentPanelWidth).toBe(900)
    })

    it('clamps manual agent panel resize to leave one board column visible', () => {
      useUIStore.getState().setAgentPanelWidth(2000)

      expect(useUIStore.getState().agentPanelWidth).toBe(900)
    })
  })
})
