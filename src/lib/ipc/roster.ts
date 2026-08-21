import { invoke } from './invoke'
import type { Agent, RuntimeDescriptor, Skill } from '@/types'

// ─── Roster commands (Kaiten Agents) ──────────────────────────────────────
//
// NOTE: command names must stay as string literals inside invoke(...) —
// scripts/check-ipc-registration.js regexes for them and silently ignores
// anything passed through a variable.

export const listAgents = () => invoke<Agent[]>('list_agents')

export const getAgent = (id: string) => invoke<Agent>('get_agent', { id })

export const createAgent = (
  name: string,
  role: string,
  runtime: string,
  config: string,
  avatar: string,
) => invoke<Agent>('create_agent', { name, role, runtime, config, avatar })

export const updateAgent = (
  id: string,
  updates: {
    name?: string
    role?: string
    runtime?: string
    config?: string
    avatar?: string
  },
) => invoke<Agent>('update_agent', { id, ...updates })

export const deleteAgent = (id: string): Promise<void> => invoke('delete_agent', { id })

export const listAgentRuntimes = () => invoke<RuntimeDescriptor[]>('list_agent_runtimes')

export const listSkills = () => invoke<Skill[]>('list_skills')

export const createSkill = (
  name: string,
  description: string,
  trigger: string,
  script: string,
) => invoke<Skill>('create_skill', { name, description, trigger, script })

export const updateSkill = (
  id: string,
  updates: { name?: string; description?: string; trigger?: string; script?: string },
) => invoke<Skill>('update_skill', { id, ...updates })

export const deleteSkill = (id: string): Promise<void> => invoke('delete_skill', { id })
