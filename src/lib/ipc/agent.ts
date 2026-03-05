// Agent IPC commands

import { invoke } from './core'

// ─── Types ─────────────────────────────────────────────────────────────────

export type AgentInfo = {
  taskId: string
  agentType: string
  status: string
  pid: number | null
  workingDir: string
}

export type DetectedCli = {
  id: string
  name: string
  path: string
  version: string | null
  isAvailable: boolean
}

// ─── Agent commands ───────────────────────────────────────────────────────

export async function startAgent(
  taskId: string,
  agentType: string,
  workingDir: string,
  cliPath?: string,
): Promise<AgentInfo> {
  return invoke<AgentInfo>('start_agent', { taskId, agentType, workingDir, cliPath })
}

export async function stopAgent(taskId: string): Promise<void> {
  return invoke<void>('stop_agent', { taskId })
}

export async function getAgentStatus(taskId: string): Promise<AgentInfo> {
  return invoke<AgentInfo>('get_agent_status', { taskId })
}

// ─── CLI detection ──────────────────────────────────────────────────────────

export async function detectClis(): Promise<DetectedCli[]> {
  return invoke<DetectedCli[]>('detect_clis')
}

export async function detectSingleCli(cliId: string): Promise<DetectedCli> {
  return invoke<DetectedCli>('detect_single_cli', { cliId })
}

export async function verifyCliPath(path: string): Promise<DetectedCli> {
  return invoke<DetectedCli>('verify_cli_path', { path })
}

export async function listActiveAgents(): Promise<AgentInfo[]> {
  return invoke<AgentInfo[]>('list_active_agents')
}

// ─── Batch Queue ─────────────────────────────────────────────────────────────

const MAX_CONCURRENT_AGENTS = 5

export type QueuedAgentResult = {
  taskId: string
  spawned: boolean
  queuePosition: number
}

export type BatchQueueResult = {
  results: QueuedAgentResult[]
  runningCount: number
  queuedCount: number
}

/**
 * Queue multiple tasks for agent execution.
 * Spawns up to MAX_CONCURRENT agents immediately, queues the rest.
 * Returns info about which were spawned vs queued.
 */
export async function queueAgentBatch(
  taskIds: string[],
  agentType: string,
  workingDir: string,
  cliPath?: string,
): Promise<BatchQueueResult> {
  // Get current running count
  const activeAgents = await listActiveAgents()
  const currentRunning = activeAgents.length
  const slotsAvailable = Math.max(0, MAX_CONCURRENT_AGENTS - currentRunning)

  const results: QueuedAgentResult[] = []
  let spawned = 0
  let queued = 0

  for (let i = 0; i < taskIds.length; i++) {
    const taskId = taskIds[i]!
    if (spawned < slotsAvailable) {
      // Spawn immediately
      try {
        await startAgent(taskId, agentType, workingDir, cliPath)
        results.push({ taskId, spawned: true, queuePosition: 0 })
        spawned++
      } catch (error) {
        // If spawn fails, queue it instead
        results.push({ taskId, spawned: false, queuePosition: queued + 1 })
        queued++
      }
    } else {
      // Queue for later
      results.push({ taskId, spawned: false, queuePosition: queued + 1 })
      queued++
    }
  }

  return {
    results,
    runningCount: currentRunning + spawned,
    queuedCount: queued,
  }
}
