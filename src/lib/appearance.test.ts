import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  DEFAULT_APPEARANCE,
  applyAppearance,
  getAppearanceConfig,
  initializeAppearance,
} from './appearance'

/**
 * These settings work by putting attributes and a custom property on the
 * document *element*, which `src/index.css` then selects on. jsdom can't
 * evaluate the Tailwind side of that, but it can pin the half that broke
 * before: every value has to land on <html>, not <body>, or the `[data-*]`
 * selectors and `--base-font-size` never match anything.
 */
describe('appearance', () => {
  const root = document.documentElement

  beforeEach(() => {
    localStorage.clear()
    root.removeAttribute('style')
    for (const attr of ['data-font-size', 'data-card-density', 'data-animation-speed']) {
      root.removeAttribute(attr)
    }
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('applies every setting to the document element', () => {
    applyAppearance({
      accentColor: '#123456',
      fontSize: 'large',
      cardDensity: 'compact',
      animationSpeed: 'none',
    })

    expect(root.style.getPropertyValue('--accent')).toBe('#123456')
    expect(root.getAttribute('data-font-size')).toBe('large')
    expect(root.getAttribute('data-card-density')).toBe('compact')
    expect(root.getAttribute('data-animation-speed')).toBe('none')
    expect(document.body.getAttribute('data-font-size')).toBeNull()
  })

  it('leaves untouched settings alone on a partial update', () => {
    applyAppearance({ fontSize: 'small', cardDensity: 'spacious' })
    applyAppearance({ fontSize: 'large' })

    expect(root.getAttribute('data-font-size')).toBe('large')
    expect(root.getAttribute('data-card-density')).toBe('spacious')
  })

  it('reads the persisted settings blob', () => {
    localStorage.setItem(
      'bento-settings',
      JSON.stringify({ state: { global: { appearance: { fontSize: 'large' } } } }),
    )

    const config = getAppearanceConfig()
    expect(config.fontSize).toBe('large')
    // Absent keys fall back rather than coming back undefined.
    expect(config.cardDensity).toBe(DEFAULT_APPEARANCE.cardDensity)
  })

  it('falls back to defaults when storage is missing or corrupt', () => {
    expect(getAppearanceConfig()).toEqual(DEFAULT_APPEARANCE)

    localStorage.setItem('bento-settings', 'not json')
    expect(getAppearanceConfig()).toEqual(DEFAULT_APPEARANCE)
  })

  it('initializes from storage on startup', () => {
    localStorage.setItem(
      'bento-settings',
      JSON.stringify({ state: { global: { appearance: { animationSpeed: 'reduced' } } } }),
    )

    initializeAppearance()
    expect(root.getAttribute('data-animation-speed')).toBe('reduced')
    // Defaults still get applied for the keys storage didn't carry.
    expect(root.getAttribute('data-font-size')).toBe(DEFAULT_APPEARANCE.fontSize)
  })
})
