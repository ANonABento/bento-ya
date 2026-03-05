import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { PipelineTemplate, ColumnTemplate } from '@/types/templates'
import { BUILT_IN_TEMPLATES } from '@/types/templates'

type TemplatesState = {
  customTemplates: PipelineTemplate[]
  defaultTemplateId: string

  // Actions
  getAllTemplates: () => PipelineTemplate[]
  getTemplate: (id: string) => PipelineTemplate | undefined
  saveAsTemplate: (name: string, description: string, columns: ColumnTemplate[]) => PipelineTemplate
  deleteTemplate: (id: string) => void
  setDefaultTemplate: (id: string) => void
  exportTemplate: (id: string) => string
  importTemplate: (json: string) => PipelineTemplate
}

export const useTemplatesStore = create<TemplatesState>()(
  devtools(
    persist(
      (set, get) => ({
        customTemplates: [],
        defaultTemplateId: 'standard',

        getAllTemplates: () => {
          return [...BUILT_IN_TEMPLATES, ...get().customTemplates]
        },

        getTemplate: (id) => {
          const all = get().getAllTemplates()
          return all.find((t) => t.id === id)
        },

        saveAsTemplate: (name, description, columns) => {
          const id = `custom-${Date.now().toString()}`
          const template: PipelineTemplate = {
            id,
            name,
            description,
            columns,
            isBuiltIn: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }

          set((state) => ({
            customTemplates: [...state.customTemplates, template],
          }))

          return template
        },

        deleteTemplate: (id) => {
          set((state) => ({
            customTemplates: state.customTemplates.filter((t) => t.id !== id),
            // Reset default if we deleted it
            defaultTemplateId:
              state.defaultTemplateId === id ? 'standard' : state.defaultTemplateId,
          }))
        },

        setDefaultTemplate: (id) => {
          set({ defaultTemplateId: id })
        },

        exportTemplate: (id) => {
          const template = get().getTemplate(id)
          if (!template) throw new Error('Template not found')

          // Export without built-in flag
          const exportable = {
            ...template,
            id: undefined,
            isBuiltIn: undefined,
          }
          return JSON.stringify(exportable, null, 2)
        },

        importTemplate: (json) => {
          const parsed = JSON.parse(json) as Partial<PipelineTemplate>

          if (!parsed.name || !parsed.columns) {
            throw new Error('Invalid template format')
          }

          const template: PipelineTemplate = {
            id: `imported-${Date.now().toString()}`,
            name: parsed.name,
            description: parsed.description ?? '',
            columns: parsed.columns,
            isBuiltIn: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }

          set((state) => ({
            customTemplates: [...state.customTemplates, template],
          }))

          return template
        },
      }),
      {
        name: 'bento-templates',
        partialize: (state) => ({
          customTemplates: state.customTemplates,
          defaultTemplateId: state.defaultTemplateId,
        }),
      },
    ),
    { name: 'templates-store' },
  ),
)
