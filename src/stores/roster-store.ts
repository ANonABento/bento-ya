import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { Agent, RuntimeDescriptor, Skill } from '@/types'
import * as ipc from '@/lib/ipc'

/**
 * Kaiten Agents roster — craftable agent + skill definitions.
 *
 * Read-only like `script-store`: mutations happen in the component and the
 * component calls `reload()`. Keeping writes out of the store means there is
 * exactly one place (the editor) that knows the create-vs-update shape.
 */
type RosterState = {
  agents: Agent[]
  skills: Skill[]
  runtimes: RuntimeDescriptor[]
  loaded: boolean

  /** Load once; a no-op if already loaded. */
  load: () => Promise<void>
  /** Force a refetch — used after a mutation or an out-of-band change. */
  reload: () => Promise<void>
  getAgentName: (id: string) => string | undefined
  /** Resolve skill ids to names, preserving order. Unknown ids yield undefined. */
  resolveSkills: (ids: string[]) => (Skill | undefined)[]
}

async function fetchAll() {
  const [agents, skills, runtimes] = await Promise.all([
    ipc.listAgents(),
    ipc.listSkills(),
    ipc.listAgentRuntimes(),
  ])
  return { agents, skills, runtimes, loaded: true }
}

export const useRosterStore = create<RosterState>()(
  devtools(
    (set, get) => ({
      agents: [],
      skills: [],
      runtimes: [],
      loaded: false,

      load: async () => {
        if (get().loaded) return
        set(await fetchAll())
      },

      reload: async () => {
        set(await fetchAll())
      },

      getAgentName: (id) => get().agents.find((a) => a.id === id)?.name,

      resolveSkills: (ids) => {
        const { skills } = get()
        return ids.map((id) => skills.find((s) => s.id === id))
      },
    }),
    { name: 'roster-store' },
  ),
)
