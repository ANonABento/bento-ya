import { useState } from 'react'
import { motion } from 'motion/react'
import { COMMUNITY_TEMPLATES, type CommunityTemplate } from '@/types/templates'
import { useTemplatesStore } from '@/stores/templates-store'

type Props = {
  onClose: () => void
}

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function CommunityGallery({ onClose }: Props) {
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set())
  const { importTemplate } = useTemplatesStore()

  const allTags = Array.from(new Set(COMMUNITY_TEMPLATES.flatMap((t) => t.tags)))

  const filteredTemplates = selectedTag
    ? COMMUNITY_TEMPLATES.filter((t) => t.tags.includes(selectedTag))
    : COMMUNITY_TEMPLATES

  const handleInstall = (template: CommunityTemplate) => {
    const json = JSON.stringify({
      name: template.name,
      description: template.description,
      columns: template.columns,
    })
    importTemplate(json)
    setInstalledIds((prev) => new Set(prev).add(template.id))
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-border-default bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
          <div>
            <h2 className="text-xl font-semibold text-text-primary">Community Templates</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Browse and install templates created by the community
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-bg hover:text-text-primary"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* Tags Filter */}
        <div className="border-b border-border-default px-6 py-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { setSelectedTag(null) }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                selectedTag === null
                  ? 'bg-accent text-white'
                  : 'bg-bg text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              }`}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => { setSelectedTag(tag) }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  selectedTag === tag
                    ? 'bg-accent text-white'
                    : 'bg-bg text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Templates Grid */}
        <div className="max-h-[calc(85vh-180px)] overflow-y-auto p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {filteredTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                isInstalled={installedIds.has(template.id)}
                onInstall={() => { handleInstall(template) }}
              />
            ))}
          </div>

          {filteredTemplates.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12">
              <p className="text-text-secondary">No templates found for this tag</p>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

function TemplateCard({
  template,
  isInstalled,
  onInstall,
}: {
  template: CommunityTemplate
  isInstalled: boolean
  onInstall: () => void
}) {
  const [showDetails, setShowDetails] = useState(false)

  return (
    <div className="rounded-xl border border-border-default bg-bg p-4 transition-colors hover:border-accent/50">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-text-primary">{template.name}</h3>
          <p className="mt-1 text-sm text-text-secondary">by {template.author}</p>
        </div>
        {isInstalled ? (
          <span className="flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
              <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
            </svg>
            Installed
          </span>
        ) : (
          <button
            onClick={onInstall}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/90"
          >
            Install
          </button>
        )}
      </div>

      <p className="mb-3 text-sm text-text-secondary line-clamp-2">{template.description}</p>

      {/* Stats */}
      <div className="mb-3 flex items-center gap-4 text-xs text-text-secondary">
        <span className="flex items-center gap-1">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
            <path d="M8.75 2.75a.75.75 0 0 0-1.5 0v5.69L5.03 6.22a.75.75 0 0 0-1.06 1.06l3.5 3.5a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 0 0-1.06-1.06L8.75 8.44V2.75Z" />
            <path d="M3.5 9.75a.75.75 0 0 0-1.5 0v1.5A2.75 2.75 0 0 0 4.75 14h6.5A2.75 2.75 0 0 0 14 11.25v-1.5a.75.75 0 0 0-1.5 0v1.5c0 .69-.56 1.25-1.25 1.25h-6.5c-.69 0-1.25-.56-1.25-1.25v-1.5Z" />
          </svg>
          {formatNumber(template.downloads)}
        </span>
        <span className="flex items-center gap-1">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
            <path fillRule="evenodd" d="M8 1.75a.75.75 0 0 1 .692.462l1.41 3.393 3.664.293a.75.75 0 0 1 .428 1.317l-2.791 2.39.853 3.575a.75.75 0 0 1-1.12.814L7.998 12.08l-3.135 1.915a.75.75 0 0 1-1.12-.814l.852-3.574-2.79-2.39a.75.75 0 0 1 .427-1.318l3.663-.293 1.41-3.393A.75.75 0 0 1 8 1.75Z" clipRule="evenodd" />
          </svg>
          {template.stars}
        </span>
        <span>{template.columns.length} columns</span>
      </div>

      {/* Tags */}
      <div className="mb-3 flex flex-wrap gap-1">
        {template.tags.map((tag) => (
          <span
            key={tag}
            className="rounded bg-surface px-2 py-0.5 text-xs text-text-secondary"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Preview Toggle */}
      <button
        onClick={() => { setShowDetails(!showDetails) }}
        className="flex items-center gap-1 text-xs text-accent hover:underline"
      >
        {showDetails ? 'Hide' : 'Preview'} columns
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`h-3 w-3 transition-transform ${showDetails ? 'rotate-180' : ''}`}
        >
          <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      </button>

      {/* Column Preview */}
      {showDetails && (
        <div className="mt-3 rounded-lg border border-border-default bg-surface p-3">
          <div className="flex flex-wrap gap-2">
            {template.columns.map((col, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 rounded bg-bg px-2 py-1 text-xs"
                style={col.color ? { borderLeft: `3px solid ${col.color}` } : undefined}
              >
                <span>{col.icon}</span>
                <span className="text-text-primary">{col.name}</span>
                {col.autoAdvance && (
                  <span className="text-accent" title="Auto-advance enabled">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                      <path fillRule="evenodd" d="M2 8a.75.75 0 0 1 .75-.75h8.69L8.22 4.03a.75.75 0 0 1 1.06-1.06l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06-1.06l3.22-3.22H2.75A.75.75 0 0 1 2 8Z" clipRule="evenodd" />
                    </svg>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
