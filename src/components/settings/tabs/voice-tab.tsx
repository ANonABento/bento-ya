import { useState, useEffect, useCallback } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import type { VoiceConfig, WhisperModelId } from '@/types/settings'
import { SettingSection, SettingRow, SettingSlider, ShortcutRecorder } from '@/components/shared/setting-components'
import { Toggle } from '@/components/shared/toggle'
import { Dropdown } from '@/components/shared/dropdown'
import {
  listWhisperModels,
  downloadWhisperModel,
  deleteWhisperModel,
  onWhisperDownloadProgress,
  onWhisperDownloadComplete,
  type WhisperModelInfo,
} from '@/lib/ipc'

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
]

function ModelCard({
  model,
  isSelected,
  onSelect,
  disabled,
  onDownload,
  onDelete,
  downloadProgress,
  isDownloadingThis,
}: {
  model: WhisperModelInfo
  isSelected: boolean
  onSelect: () => void
  disabled: boolean
  onDownload: () => void
  onDelete: () => void
  downloadProgress: number | null
  isDownloadingThis: boolean
}) {
  const isDownloaded = model.status === 'downloaded'
  const isDownloading = isDownloadingThis || downloadProgress !== null
  const canSelect = isDownloaded && !disabled

  return (
    <div
      className={`relative flex w-full items-center justify-between rounded-lg border p-3 transition-colors ${
        isSelected && isDownloaded
          ? 'border-accent bg-accent/10'
          : 'border-border-default bg-surface hover:bg-surface-hover'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        onClick={canSelect ? onSelect : undefined}
        disabled={!canSelect}
        className="flex flex-1 flex-col items-start text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary capitalize">{model.model}</span>
          <span className="text-xs text-text-secondary">{model.sizeDisplay}</span>
          {isDownloaded && (
            <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
              Downloaded
            </span>
          )}
          {isSelected && isDownloaded && (
            <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              Active
            </span>
          )}
        </div>
        <span className="mt-0.5 text-xs text-text-secondary">{model.description}</span>
      </button>

      <div className="ml-3 flex items-center gap-2">
        {isDownloading ? (
          <div className="flex items-center gap-2">
            {downloadProgress !== null ? (
              <>
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-hover">
                  <div
                    className="h-full bg-accent transition-all"
                    style={{ width: `${String(downloadProgress)}%` }}
                  />
                </div>
                <span className="text-xs text-text-secondary">{Math.round(downloadProgress)}%</span>
              </>
            ) : (
              <span className="text-xs text-text-secondary animate-pulse">Starting...</span>
            )}
          </div>
        ) : isDownloaded ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            disabled={disabled}
            className="rounded px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            title="Delete model"
          >
            Delete
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDownload()
            }}
            disabled={disabled}
            className="rounded bg-accent/10 px-2 py-1 text-xs text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
          >
            Download
          </button>
        )}
      </div>
    </div>
  )
}

export function VoiceTab() {
  const global = useSettingsStore((s) => s.global)
  const updateGlobal = useSettingsStore((s) => s.updateGlobal)
  const voice = global.voice

  const [models, setModels] = useState<WhisperModelInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)

  const updateVoice = (updates: Partial<VoiceConfig>) => {
    updateGlobal('voice', { ...voice, ...updates })
  }

  const loadModels = useCallback(async () => {
    try {
      const list = await listWhisperModels()
      setModels(list)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  // Listen for download progress
  useEffect(() => {
    const unlistenProgress = onWhisperDownloadProgress((payload) => {
      setDownloadProgress((prev) => ({ ...prev, [payload.model]: payload.percent }))
    })

    const unlistenComplete = onWhisperDownloadComplete((payload) => {
      setDownloadingModel(null)
      setDownloadProgress((prev) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [payload.model]: _, ...rest } = prev
        return rest
      })
      void loadModels()
    })

    return () => {
      void unlistenProgress.then((fn) => { fn() })
      void unlistenComplete.then((fn) => { fn() })
    }
  }, [loadModels])

  const handleDownload = async (modelName: string) => {
    setDownloadingModel(modelName)
    setDownloadProgress((prev) => ({ ...prev, [modelName]: 0 }))
    setError(null)

    try {
      await downloadWhisperModel(modelName)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
      setDownloadingModel(null)
      setDownloadProgress((prev) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [modelName]: _, ...rest } = prev
        return rest
      })
    }
  }

  const handleDelete = async (modelName: string) => {
    try {
      await deleteWhisperModel(modelName)
      await loadModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const hasDownloadedModel = models.some((m) => m.status === 'downloaded')

  return (
    <div className="space-y-6">
      <SettingSection title="Voice Input">
        <SettingRow
          label="Enable voice input"
          description="Use local Whisper for speech-to-text (no API key needed)"
        >
          <Toggle
            checked={voice.enabled}
            onChange={(checked) => { updateVoice({ enabled: checked }) }}
          />
        </SettingRow>
        {voice.enabled && !hasDownloadedModel && (
          <p className="mt-2 text-xs text-yellow-400">
            Download at least one model below to use voice input
          </p>
        )}
      </SettingSection>

      <SettingSection
        title="Whisper Models"
        description="Download models for local transcription. Larger = more accurate but slower."
      >
        {error && (
          <p className="mb-3 rounded bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>
        )}
        {loading ? (
          <p className="text-sm text-text-secondary">Loading models...</p>
        ) : (
          <div className="space-y-2">
            {models.map((model) => (
              <ModelCard
                key={model.model}
                model={model}
                isSelected={voice.model === model.model}
                onSelect={() => { updateVoice({ model: model.model as WhisperModelId }) }}
                disabled={!voice.enabled || downloadingModel !== null}
                onDownload={() => void handleDownload(model.model)}
                onDelete={() => void handleDelete(model.model)}
                downloadProgress={downloadProgress[model.model] ?? null}
                isDownloadingThis={downloadingModel === model.model}
              />
            ))}
          </div>
        )}
      </SettingSection>

      <SettingSection title="Language">
        <Dropdown
          options={LANGUAGES}
          value={voice.language}
          onChange={(value) => { updateVoice({ language: value }); }}
          disabled={!voice.enabled}
        />
      </SettingSection>

      <SettingSection title="Hotkey" description="Click to record a keyboard shortcut">
        <ShortcutRecorder
          value={voice.hotkey}
          onChange={(value) => { updateVoice({ hotkey: value }) }}
          placeholder="Click to record shortcut"
          disabled={!voice.enabled}
        />
      </SettingSection>

      <SettingSection title="Input Mode">
        <SettingRow
          label="Push-to-talk"
          description="Hold hotkey to record instead of toggle"
        >
          <Toggle
            checked={voice.pushToTalk}
            onChange={(checked) => { updateVoice({ pushToTalk: checked }); }}
            disabled={!voice.enabled}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection
        title="Sensitivity"
        description="Voice activity detection threshold for auto-start/stop"
      >
        <SettingSlider
          value={voice.sensitivity}
          onChange={(value) => { updateVoice({ sensitivity: value }); }}
          min={0}
          max={1}
          step={0.1}
          disabled={!voice.enabled}
          formatValue={(v) => `${Math.round(v * 100)}%`}
        />
      </SettingSection>
    </div>
  )
}
