import { invoke } from './invoke'

// ─── CLI detection ──────────────────────────────────────────────────────────

export type DetectedCli = {
  id: string
  name: string
  path: string
  version: string | null
  isAvailable: boolean
}

export async function detectClis(): Promise<DetectedCli[]> {
  return invoke<DetectedCli[]>('detect_clis')
}

export async function detectSingleCli(cliId: string): Promise<DetectedCli> {
  return invoke<DetectedCli>('detect_single_cli', { cliId })
}

export async function verifyCliPath(path: string): Promise<DetectedCli> {
  return invoke<DetectedCli>('verify_cli_path', { path })
}

// ─── CLI Capabilities ──────────────────────────────────────────────────────

export type ModelCapability = {
  id: string
  name: string
  description: string
  supportsExtendedContext: boolean
  contextWindow: string
  maxEffort: string
  available: boolean
}

export type CliCapabilities = {
  cliId: string
  cliVersion: string | null
  models: ModelCapability[]
  detected: boolean
}

export async function getCliCapabilities(cliId: string): Promise<CliCapabilities> {
  return invoke<CliCapabilities>('get_cli_capabilities', { cliId })
}

// ─── CLI Update Check ─────────────────────────────────────────────────────

export type CliUpdateInfo = {
  cliId: string
  currentVersion: string
  latestVersion: string | null
  hasUpdate: boolean
  updateCommand: string | null
}

export async function checkCliUpdate(cliId: string): Promise<CliUpdateInfo> {
  return invoke<CliUpdateInfo>('check_cli_update', { cliId })
}

// ─── CLI compatibility health (Phase 5) ─────────────────────────────────────

export type CliHealthReport = {
  id: string
  name: string
  available: boolean
  path: string | null
  version: string | null
  minVersion: string | null
  versionOk: boolean
  missingFlags: string[]
  /** "ok" | "missing" | "outdated" | "drift" */
  status: string
}

export async function checkCliHealth(): Promise<CliHealthReport[]> {
  return invoke<CliHealthReport[]>('check_cli_health')
}

/** A report worth surfacing: an installed CLI whose flags or version drifted.
 *  A *missing* CLI is intentionally ignored here — onboarding/settings own that. */
export function isCliHealthConcerning(report: CliHealthReport): boolean {
  return report.available && (report.status === 'drift' || report.status === 'outdated')
}
