import { describe, it, expect, beforeEach } from 'vitest'
import { useTemplatesStore } from './templates-store'

describe('templates-store', () => {
  beforeEach(() => {
    // Reset to initial state
    useTemplatesStore.setState({
      customTemplates: [],
      defaultTemplateId: 'default',
    })
  })

  describe('getAllTemplates', () => {
    it('should return built-in templates', () => {
      const templates = useTemplatesStore.getState().getAllTemplates()

      expect(templates.length).toBeGreaterThan(0)
      expect(templates.some((t) => t.isBuiltIn)).toBe(true)
    })

    it('should include custom templates', () => {
      const customTemplate = {
        id: 'custom-1',
        name: 'Custom Template',
        description: 'Test description',
        columns: [{ name: 'Todo', icon: '📋', color: null, triggerConfig: '', exitConfig: '', autoAdvance: false }],
        isBuiltIn: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      useTemplatesStore.setState({
        customTemplates: [customTemplate],
      })

      const templates = useTemplatesStore.getState().getAllTemplates()

      expect(templates).toContainEqual(customTemplate)
    })
  })

  describe('importTemplate', () => {
    it('should import valid template JSON', () => {
      const json = JSON.stringify({
        name: 'Imported Template',
        description: 'From JSON',
        columns: [
          { name: 'Backlog', icon: '📋', color: null, triggerConfig: '', exitConfig: '', autoAdvance: false },
          { name: 'Done', icon: '✅', color: null, triggerConfig: '', exitConfig: '', autoAdvance: false },
        ],
      })

      useTemplatesStore.getState().importTemplate(json)

      const templates = useTemplatesStore.getState().getAllTemplates()
      const imported = templates.find((t) => t.name === 'Imported Template')

      expect(imported).toBeDefined()
      expect(imported?.columns).toHaveLength(2)
      expect(imported?.isBuiltIn).toBe(false)
    })

    it('should throw on invalid JSON', () => {
      expect(() => {
        useTemplatesStore.getState().importTemplate('not valid json')
      }).toThrow()
    })

    it('should throw on missing required fields', () => {
      const json = JSON.stringify({ name: 'No Columns' })

      expect(() => {
        useTemplatesStore.getState().importTemplate(json)
      }).toThrow()
    })
  })

  describe('exportTemplate', () => {
    it('should export template as JSON string', () => {
      const templates = useTemplatesStore.getState().getAllTemplates()
      const builtIn = templates.find((t) => t.isBuiltIn)

      if (builtIn) {
        const json = useTemplatesStore.getState().exportTemplate(builtIn.id)
        const parsed = JSON.parse(json) as { name: string; columns: unknown[] }

        expect(parsed.name).toBe(builtIn.name)
        expect(parsed.columns).toEqual(builtIn.columns)
      }
    })
  })

  describe('setDefaultTemplate', () => {
    it('should update default template id', () => {
      useTemplatesStore.getState().setDefaultTemplate('kanban')

      expect(useTemplatesStore.getState().defaultTemplateId).toBe('kanban')
    })
  })

  describe('deleteTemplate', () => {
    it('should delete custom template', () => {
      const customTemplate = {
        id: 'custom-1',
        name: 'Custom Template',
        description: 'Test',
        columns: [],
        isBuiltIn: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      useTemplatesStore.setState({
        customTemplates: [customTemplate],
      })

      useTemplatesStore.getState().deleteTemplate('custom-1')

      const templates = useTemplatesStore.getState().getAllTemplates()
      expect(templates.find((t) => t.id === 'custom-1')).toBeUndefined()
    })

    it('should not delete built-in templates', () => {
      const initialTemplates = useTemplatesStore.getState().getAllTemplates()
      const builtIn = initialTemplates.find((t) => t.isBuiltIn)

      if (builtIn) {
        useTemplatesStore.getState().deleteTemplate(builtIn.id)

        const templates = useTemplatesStore.getState().getAllTemplates()
        expect(templates.find((t) => t.id === builtIn.id)).toBeDefined()
      }
    })
  })
})
