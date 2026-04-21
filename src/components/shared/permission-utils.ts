export type PermissionMode = 'plan' | 'full'

export const PERMISSION_CLI_FLAGS: Record<PermissionMode, string> = {
  plan: 'plan',
  full: 'bypassPermissions',
}
