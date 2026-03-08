import { useRef, useState, useCallback, useEffect } from 'react'

type LabeledSliderProps<T extends string> = {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
  labels?: Partial<Record<T, string>>
}

export function LabeledSlider<T extends string>({
  options,
  value,
  onChange,
  labels,
}: LabeledSliderProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const selectedIndex = options.indexOf(value)

  const updateValue = useCallback((clientX: number) => {
    if (!trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
    const index = Math.round((x / rect.width) * (options.length - 1))
    const option = options[index]
    if (option !== undefined) onChange(option)
  }, [options, onChange])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true)
    updateValue(e.clientX)
  }, [updateValue])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      updateValue(e.clientX)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, updateValue])

  const thumbPosition = (selectedIndex / (options.length - 1)) * 100
  const fillWidth = thumbPosition

  return (
    <div className="w-56">
      {/* Track */}
      <div
        ref={trackRef}
        onMouseDown={handleMouseDown}
        className="relative h-2 cursor-pointer rounded-full bg-surface"
      >
        {/* Fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent"
          style={{ width: `${fillWidth}%` }}
        />

        {/* Thumb */}
        <div
          className="absolute top-1/2 h-4 w-4 rounded-full border-2 border-accent bg-bg shadow-sm"
          style={{
            left: `${thumbPosition}%`,
            transform: `translateX(-50%) translateY(-50%) scale(${isDragging ? 1.1 : 1})`,
          }}
        />

        {/* Tick marks */}
        {options.map((_, index) => (
          <div
            key={index}
            className="absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text-secondary/30"
            style={{ left: `${(index / (options.length - 1)) * 100}%` }}
          />
        ))}
      </div>

      {/* Labels - positioned to align with tick marks */}
      <div className="relative mt-2 h-5">
        {options.map((option, index) => {
          const isSelected = option === value
          const label = labels?.[option] ?? option
          const position = (index / (options.length - 1)) * 100

          return (
            <button
              key={option}
              onClick={() => { onChange(option); }}
              className={`absolute text-xs capitalize transition-colors ${
                isSelected
                  ? 'font-medium text-accent'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
              style={{
                left: `${position}%`,
                transform: 'translateX(-50%)',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
