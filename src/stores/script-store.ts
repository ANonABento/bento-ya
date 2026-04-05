import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { Script } from '@/types'
import * as ipc from '@/lib/ipc'

type ScriptState = {
  scripts: Script[]
  loaded: boolean

  load: () => Promise<void>
  getScriptName: (id: string) => string | undefined
}

export const useScriptStore = create<ScriptState>()(
  devtools(
    (set, get) => ({
      scripts: [],
      loaded: false,

      load: async () => {
        if (get().loaded) return
        const scripts = await ipc.listScripts()
        set({ scripts, loaded: true })
      },

      getScriptName: (id) => {
        return get().scripts.find((s) => s.id === id)?.name
      },
    }),
    { name: 'script-store' },
  ),
)
