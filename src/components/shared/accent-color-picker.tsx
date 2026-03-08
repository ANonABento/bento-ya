import { useRef } from 'react'

type AccentColorPickerProps = {
  value: string
  onChange: (color: string) => void
}

// Curated accent colors that work well in both light and dark themes
const ACCENT_PRESETS = [
  '#E8A87C', // Coral
  '#E879A0', // Rose
  '#A78BFA', // Violet
  '#60A5FA', // Blue
  '#22D3EE', // Cyan
  '#2DD4BF', // Teal
  '#4ADE80', // Green
  '#A3E635', // Lime
  '#FACC15', // Yellow
  '#FB923C', // Orange
] as const

export function AccentColorPicker({ value, onChange }: AccentColorPickerProps) {
  const colorInputRef = useRef<HTMLInputElement>(null)

  // Check if current value is a preset or custom
  const isCustomColor = !ACCENT_PRESETS.some(
    (preset) => preset.toLowerCase() === value.toLowerCase()
  )

  const handleCustomClick = () => {
    colorInputRef.current?.click()
  }

  return (
    <div className="flex items-center gap-2">
      {/* Preset colors */}
      {ACCENT_PRESETS.map((color) => (
        <button
          key={color}
          onClick={() => { onChange(color); }}
          className="h-7 w-7 rounded-full transition-transform hover:scale-110"
          style={{ backgroundColor: color }}
        />
      ))}

      {/* Custom color button */}
      <button
        onClick={handleCustomClick}
        className="relative h-7 w-7 rounded-full transition-colors flex items-center justify-center"
        style={{ backgroundColor: isCustomColor ? value : 'transparent' }}
      >
        {/* Dashed border ring - always visible as indicator this is custom slot */}
        <div
          className={`absolute inset-0 rounded-full border-2 border-dashed transition-colors ${
            isCustomColor ? 'border-white/50' : 'border-text-secondary/40 hover:border-text-secondary'
          }`}
        />

        {/* Plus icon - only when no custom color */}
        {!isCustomColor && (
          <svg className="h-3.5 w-3.5 text-text-secondary/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        )}

        {/* Hidden color input */}
        <input
          ref={colorInputRef}
          type="color"
          value={value}
          onChange={(e) => { onChange(e.target.value); }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </button>
    </div>
  )
}
