import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  type Theme,
  type ThemePreference,
  getTheme,
  getThemePreference,
  setThemePreference,
  resolveTheme,
} from '@/lib/theme'

type ThemeState = {
  preference: ThemePreference
  resolved: Theme

  setPreference: (preference: ThemePreference) => void
  cycleTheme: () => void
}

export const useThemeStore = create<ThemeState>()(
  devtools(
    (set) => ({
      preference: getThemePreference(),
      resolved: getTheme(),

      setPreference: (preference) => {
        setThemePreference(preference)
        set({ preference, resolved: resolveTheme(preference) })
      },

      cycleTheme: () => {
        set((state) => {
          const cycle: ThemePreference[] = ['system', 'light', 'dark']
          const currentIndex = cycle.indexOf(state.preference)
          const nextIndex = (currentIndex + 1) % cycle.length
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const nextPreference = cycle[nextIndex]!
          setThemePreference(nextPreference)
          return { preference: nextPreference, resolved: resolveTheme(nextPreference) }
        })
      },
    }),
    { name: 'theme-store' },
  ),
)
