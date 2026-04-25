import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from './ui-store'

describe('ui-store', () => {
  beforeEach(() => {
    useUIStore.setState({ isPanelCollapsed: false })
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
})
