import { invoke } from './invoke'

export type McpHealthStatus = 'healthy' | 'restarting' | 'failed' | 'not_installed'

export type McpHealth = {
  status: McpHealthStatus
  pid: number | null
  restartCount: number
  lastError: string | null
  message: string | null
}

export const MCP_HEALTH_EVENT = 'mcp:health'

export async function getMcpHealth(): Promise<McpHealth> {
  return invoke<McpHealth>('get_mcp_health')
}
