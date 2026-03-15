import type { AppearanceConfig } from '@/types/settings'

type DensityPickerProps = {
  value: AppearanceConfig['cardDensity']
  onChange: (value: AppearanceConfig['cardDensity']) => void
}

const DENSITIES: {
  id: AppearanceConfig['cardDensity']
  label: string
  scale: number
}[] = [
  { id: 'compact', label: 'Compact', scale: 0.7 },
  { id: 'comfortable', label: 'Comfortable', scale: 1 },
  { id: 'spacious', label: 'Spacious', scale: 1.3 },
]

export function DensityPicker({ value, onChange }: DensityPickerProps) {
  return (
    <div className="inline-flex gap-2 rounded-lg border border-border-default bg-surface p-1">
      {DENSITIES.map((density) => {
        const isSelected = value === density.id

        return (
          <button
            key={density.id}
            onClick={() => { onChange(density.id); }}
            className={`flex flex-col items-center gap-1.5 rounded-md px-3 py-2 transition-all ${
              isSelected
                ? 'bg-accent text-bg'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            {/* Mini card stack icon */}
            <div className="flex flex-col items-center" style={{ gap: `${String(2 * density.scale)}px` }}>
              <div
                className={`rounded ${isSelected ? 'bg-bg/30' : 'bg-text-secondary/20'}`}
                style={{
                  width: `${String(28 * density.scale)}px`,
                  height: `${String(8 * density.scale)}px`
                }}
              />
              <div
                className={`rounded ${isSelected ? 'bg-bg/30' : 'bg-text-secondary/20'}`}
                style={{
                  width: `${String(28 * density.scale)}px`,
                  height: `${String(8 * density.scale)}px`
                }}
              />
            </div>
            <span className="text-xs font-medium">{density.label}</span>
          </button>
        )
      })}
    </div>
  )
}
