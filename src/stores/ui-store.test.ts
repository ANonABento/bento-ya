import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from './ui-store'

describe('ui-store', () => {
  beforeEach(() => {
    useUIStore.setState({ panelView: 'chat' })
  })

  describe('panelView', () => {
    it('defaults to chat', () => {
      expect(useUIStore.getState().panelView).toBe('chat')
    })

    it('setPanelView switches to detail', () => {
      useUIStore.getState().setPanelView('detail')
      expect(useUIStore.getState().panelView).toBe('detail')
    })

    it('togglePanelView flips chat <-> detail', () => {
      useUIStore.getState().togglePanelView()
      expect(useUIStore.getState().panelView).toBe('detail')
      useUIStore.getState().togglePanelView()
      expect(useUIStore.getState().panelView).toBe('chat')
    })
  })
})
