import { invoke } from './invoke'

/**
 * Mirror of the backend `AppSettings` struct (`~/.kaitencode/settings.json`).
 * Keys are snake_case to match the on-disk JSON and the `/api/settings` route —
 * `AppSettings` has no serde rename, so the Tauri commands serialize snake_case.
 */
export interface AppSettings {
  max_agent_sessions: number
  gc_interval_minutes: number
  idle_sleep_minutes: number
  idle_kill_hours: number
  archive_purge_days: number
  default_agent_cli: string
  default_model: string
  default_session_strategy: string
  default_advance_mode: string
  /** "terminal" | "managed" | "interactive" | "" (empty = no global default). */
  default_runtime_mode: string
  /** Opt-in gate for interactive runtime mode (Phase 3). */
  interactive_mode_enabled: boolean
}

export async function getAppSettings(): Promise<AppSettings> {
  return invoke<AppSettings>('get_app_settings')
}

/** Merge a partial update (only provided keys change) and persist it. */
export async function updateAppSettings(
  updates: Partial<AppSettings>,
): Promise<AppSettings> {
  return invoke<AppSettings>('update_app_settings', { updates })
}
