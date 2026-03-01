import { useSettingsStore } from '@/stores/settings-store'
import type { VoiceConfig } from '@/types/settings'
import { SettingSection, SettingRow, SettingCard, SettingInput, SettingSlider } from '@/components/shared/setting-components'
import { Toggle } from '@/components/shared/toggle'
import { Dropdown } from '@/components/shared/dropdown'

const WHISPER_MODELS = [
  { id: 'tiny', label: 'Tiny', size: '39 MB', description: 'Fastest, least accurate' },
  { id: 'base', label: 'Base', size: '74 MB', description: 'Good balance' },
  { id: 'small', label: 'Small', size: '244 MB', description: 'Better accuracy' },
  { id: 'medium', label: 'Medium', size: '769 MB', description: 'High accuracy' },
  { id: 'large', label: 'Large', size: '1550 MB', description: 'Best accuracy' },
] as const

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
]

export function VoiceTab() {
  const global = useSettingsStore((s) => s.global)
  const updateGlobal = useSettingsStore((s) => s.updateGlobal)
  const voice = global.voice

  const updateVoice = (updates: Partial<VoiceConfig>) => {
    updateGlobal('voice', { ...voice, ...updates })
  }

  return (
    <div className="space-y-6">
      <SettingSection title="Voice Input">
        <SettingRow
          label="Enable voice input"
          description="Use speech-to-text with Whisper"
        >
          <Toggle
            checked={voice.enabled}
            onChange={(checked) => updateVoice({ enabled: checked })}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Whisper Model" description="Choose model size based on accuracy vs speed tradeoff">
        <div className="space-y-2">
          {WHISPER_MODELS.map((model) => (
            <SettingCard
              key={model.id}
              active={voice.model === model.id}
              onClick={() => updateVoice({ model: model.id })}
              className={!voice.enabled ? 'opacity-50 pointer-events-none' : ''}
            >
              <div className="flex w-full items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-text-primary">{model.label}</span>
                  <span className="ml-2 text-xs text-text-secondary">{model.description}</span>
                </div>
                <span className="text-xs text-text-secondary">{model.size}</span>
              </div>
            </SettingCard>
          ))}
        </div>
      </SettingSection>

      <SettingSection title="Language">
        <Dropdown
          options={LANGUAGES}
          value={voice.language}
          onChange={(value) => updateVoice({ language: value })}
          disabled={!voice.enabled}
        />
      </SettingSection>

      <SettingSection title="Hotkey" description="Keyboard shortcut to activate voice input">
        <SettingInput
          value={voice.hotkey}
          onChange={(value) => updateVoice({ hotkey: value })}
          placeholder="Cmd+Shift+V"
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
            onChange={(checked) => updateVoice({ pushToTalk: checked })}
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
          onChange={(value) => updateVoice({ sensitivity: value })}
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
