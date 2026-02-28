import { useSettingsStore } from '@/stores/settings-store'
import type { VoiceConfig } from '@/types/settings'

const WHISPER_MODELS = [
  { id: 'tiny', label: 'Tiny', size: '39 MB', description: 'Fastest, least accurate' },
  { id: 'base', label: 'Base', size: '74 MB', description: 'Good balance' },
  { id: 'small', label: 'Small', size: '244 MB', description: 'Better accuracy' },
  { id: 'medium', label: 'Medium', size: '769 MB', description: 'High accuracy' },
  { id: 'large', label: 'Large', size: '1550 MB', description: 'Best accuracy' },
] as const

export function VoiceTab() {
  const global = useSettingsStore((s) => s.global)
  const updateGlobal = useSettingsStore((s) => s.updateGlobal)
  const voice = global.voice

  const updateVoice = (updates: Partial<VoiceConfig>) => {
    updateGlobal('voice', { ...voice, ...updates })
  }

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Enable Voice Input</h3>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={voice.enabled}
            onChange={(e) => updateVoice({ enabled: e.target.checked })}
            className="h-4 w-4 rounded border-border-default text-accent focus:ring-accent"
          />
          <span className="text-sm text-text-secondary">
            Enable speech-to-text input using Whisper
          </span>
        </label>
      </section>

      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Whisper Model</h3>
        <div className="grid gap-2">
          {WHISPER_MODELS.map((model) => (
            <button
              key={model.id}
              onClick={() => updateVoice({ model: model.id })}
              disabled={!voice.enabled}
              className={`flex items-center justify-between rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${
                voice.model === model.id
                  ? 'border-accent bg-accent/10'
                  : 'border-border-default hover:border-accent/50'
              }`}
            >
              <div>
                <span className="text-sm font-medium text-text-primary">{model.label}</span>
                <span className="ml-2 text-xs text-text-secondary">{model.description}</span>
              </div>
              <span className="text-xs text-text-secondary">{model.size}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Language</h3>
        <select
          value={voice.language}
          onChange={(e) => updateVoice({ language: e.target.value })}
          disabled={!voice.enabled}
          className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
        >
          <option value="en">English</option>
          <option value="es">Spanish</option>
          <option value="fr">French</option>
          <option value="de">German</option>
          <option value="ja">Japanese</option>
          <option value="zh">Chinese</option>
        </select>
      </section>

      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Hotkey</h3>
        <input
          type="text"
          value={voice.hotkey}
          onChange={(e) => updateVoice({ hotkey: e.target.value })}
          disabled={!voice.enabled}
          placeholder="Cmd+Shift+V"
          className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none disabled:opacity-50"
        />
      </section>

      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Input Mode</h3>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={voice.pushToTalk}
            onChange={(e) => updateVoice({ pushToTalk: e.target.checked })}
            disabled={!voice.enabled}
            className="h-4 w-4 rounded border-border-default text-accent focus:ring-accent"
          />
          <span className="text-sm text-text-secondary">
            Push-to-talk (hold hotkey to record)
          </span>
        </label>
      </section>

      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">
          Sensitivity: {Math.round(voice.sensitivity * 100)}%
        </h3>
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={voice.sensitivity}
          onChange={(e) => updateVoice({ sensitivity: parseFloat(e.target.value) })}
          disabled={!voice.enabled}
          className="w-full disabled:opacity-50"
        />
        <p className="mt-2 text-xs text-text-secondary">
          Voice activity detection sensitivity for auto-start/stop
        </p>
      </section>
    </div>
  )
}
