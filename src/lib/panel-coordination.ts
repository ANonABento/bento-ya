/**
 * Coordinates panel mutual exclusion to avoid circular imports
 * between settings-store and checklist-store.
 */

let closeSettings: (() => void) | null = null
let closeChecklist: (() => void) | null = null

export function registerSettingsClose(fn: () => void) {
  closeSettings = fn
}

export function registerChecklistClose(fn: () => void) {
  closeChecklist = fn
}

export function closeOtherPanels(except: 'settings' | 'checklist') {
  if (except === 'settings' && closeChecklist) closeChecklist()
  if (except === 'checklist' && closeSettings) closeSettings()
}
