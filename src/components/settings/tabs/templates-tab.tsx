import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useTemplatesStore } from '@/stores/templates-store'
import { CommunityGallery } from '@/components/templates/community-gallery'
import type { PipelineTemplate } from '@/types/templates'

export function TemplatesTab() {
  const getAllTemplates = useTemplatesStore((s) => s.getAllTemplates)
  const defaultTemplateId = useTemplatesStore((s) => s.defaultTemplateId)
  const setDefaultTemplate = useTemplatesStore((s) => s.setDefaultTemplate)
  const deleteTemplate = useTemplatesStore((s) => s.deleteTemplate)
  const exportTemplate = useTemplatesStore((s) => s.exportTemplate)
  const importTemplate = useTemplatesStore((s) => s.importTemplate)

  const [selectedTemplate, setSelectedTemplate] = useState<PipelineTemplate | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [showCommunityGallery, setShowCommunityGallery] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const templates = getAllTemplates()

  const handleExport = (template: PipelineTemplate) => {
    const json = exportTemplate(template.id)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${template.name.toLowerCase().replace(/\s+/g, '-')}-template.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const json = event.target?.result as string
        importTemplate(json)
        setImportError(null)
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Failed to import template')
      }
    }
    reader.readAsText(file)

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">Pipeline Templates</h3>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
          />
          <button
            onClick={() => { setShowCommunityGallery(true) }}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/90"
          >
            Browse Community
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-border-default px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-accent hover:text-text-primary"
          >
            Import
          </button>
        </div>
      </div>

      {importError && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {importError}
        </div>
      )}

      <div className="space-y-2">
        {templates.map((template) => (
          <div
            key={template.id}
            className={`rounded-lg border p-3 transition-colors ${
              defaultTemplateId === template.id
                ? 'border-accent bg-accent/5'
                : 'border-border-default hover:border-accent/50'
            }`}
          >
            <div className="flex items-start justify-between">
              <div
                className="flex-1 cursor-pointer"
                onClick={() => { setSelectedTemplate(selectedTemplate?.id === template.id ? null : template); }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{template.name}</span>
                  {template.isBuiltIn && (
                    <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-text-secondary">
                      Built-in
                    </span>
                  )}
                  {defaultTemplateId === template.id && (
                    <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent">
                      Default
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-text-secondary">{template.description}</p>
              </div>

              <div className="flex items-center gap-1">
                {defaultTemplateId !== template.id && (
                  <button
                    onClick={() => { setDefaultTemplate(template.id); }}
                    className="rounded p-1.5 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                    title="Set as default"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                      <path fillRule="evenodd" d="M8 1.75a.75.75 0 0 1 .692.462l1.41 3.393 3.664.293a.75.75 0 0 1 .428 1.317l-2.791 2.39.853 3.575a.75.75 0 0 1-1.12.814L8 12.09l-3.136 1.904a.75.75 0 0 1-1.12-.814l.853-3.575-2.79-2.39a.75.75 0 0 1 .427-1.317l3.664-.293 1.41-3.393A.75.75 0 0 1 8 1.75Z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={() => { handleExport(template); }}
                  className="rounded p-1.5 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                  title="Export"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                    <path d="M8.75 2.75a.75.75 0 0 0-1.5 0v5.69L5.03 6.22a.75.75 0 0 0-1.06 1.06l3.5 3.5a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 0 0-1.06-1.06L8.75 8.44V2.75Z" />
                    <path d="M3.5 9.75a.75.75 0 0 0-1.5 0v1.5A2.75 2.75 0 0 0 4.75 14h6.5A2.75 2.75 0 0 0 14 11.25v-1.5a.75.75 0 0 0-1.5 0v1.5c0 .69-.56 1.25-1.25 1.25h-6.5c-.69 0-1.25-.56-1.25-1.25v-1.5Z" />
                  </svg>
                </button>
                {!template.isBuiltIn && (
                  <button
                    onClick={() => { deleteTemplate(template.id); }}
                    className="rounded p-1.5 text-text-secondary transition-colors hover:bg-error/10 hover:text-error"
                    title="Delete"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                      <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.711Z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Expanded view */}
            <AnimatePresence>
              {selectedTemplate?.id === template.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-4 border-t border-border-default pt-4">
                    <h4 className="mb-2 text-xs font-medium text-text-secondary">Columns</h4>
                    <div className="flex flex-wrap gap-2">
                      {template.columns.map((col, index) => (
                        <div
                          key={index}
                          className="flex items-center gap-1.5 rounded-lg border border-border-default bg-surface px-2 py-1"
                        >
                          <span>{col.icon}</span>
                          <span className="text-xs text-text-primary">{col.name}</span>
                          {col.autoAdvance && (
                            <span className="text-[10px] text-accent">→</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border-default bg-surface/50 p-4">
        <p className="text-sm text-text-secondary">
          To save your current pipeline as a template, go to the Columns tab in workspace settings
          and click "Save as Template".
        </p>
      </div>

      {/* Community Gallery Modal */}
      <AnimatePresence>
        {showCommunityGallery && (
          <CommunityGallery onClose={() => { setShowCommunityGallery(false); }} />
        )}
      </AnimatePresence>
    </div>
  )
}
