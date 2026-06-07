/** IPC wrappers for the Discord MVP. See `.tickets/discord/MVP-PLAN.md`. */

import { invoke } from './invoke'

export type DiscordConfig = {
  enabled: boolean
  hasToken: boolean
  threadChannelId: string
}

export type DiscordSaveResult = DiscordConfig & { running: boolean }

/** Current config for the settings UI (never returns the raw token). */
export async function discordGetConfig(): Promise<DiscordConfig> {
  return invoke('discord_get_config')
}

/** Whether the managed sidecar bridge is currently running. */
export async function discordStatus(): Promise<{ running: boolean; enabled: boolean }> {
  return invoke('discord_status')
}

/** Probe a token by spawning a throwaway sidecar; returns the bot tag. */
export async function discordTestConnection(token: string): Promise<{ tag: string | null }> {
  return invoke('discord_test_connection', { token })
}

/** Persist config and (re)start or stop the managed bridge to match it. */
export async function discordSaveConfig(args: {
  enabled: boolean
  token?: string
  threadChannelId?: string
}): Promise<DiscordSaveResult> {
  return invoke('discord_save_config', {
    enabled: args.enabled,
    token: args.token,
    threadChannelId: args.threadChannelId,
  })
}
