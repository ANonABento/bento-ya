import { vi } from 'vitest'
import type { Workspace, Column, Task, TriggerConfig, ExitConfig } from '@/types'

// Default configs
const defaultTrigger: TriggerConfig = { type: 'none', config: {} }
const defaultExit: ExitConfig = { type: 'manual', config: {} }

// Mock data factories
export const mockWorkspace = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: `ws-${Math.random().toString(36).slice(2, 9)}`,
  name: 'Test Workspace',
  repoPath: '/path/to/repo',
  tabOrder: 0,
  isActive: true,
  config: '{}',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

export const mockColumn = (overrides: Partial<Column> = {}): Column => ({
  id: `col-${Math.random().toString(36).slice(2, 9)}`,
  workspaceId: 'ws-1',
  name: 'Test Column',
  icon: '📋',
  position: 0,
  color: '',
  visible: true,
  trigger: defaultTrigger,
  exitCriteria: defaultExit,
  autoAdvance: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

export const mockTask = (overrides: Partial<Task> = {}): Task => ({
  id: `task-${Math.random().toString(36).slice(2, 9)}`,
  workspaceId: 'ws-1',
  columnId: 'col-1',
  title: 'Test Task',
  description: '',
  branch: null,
  agentType: null,
  agentMode: null,
  agentStatus: null,
  position: 0,
  pipelineState: 'idle',
  pipelineTriggeredAt: null,
  pipelineError: null,
  lastScriptExitCode: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

// Helper to setup invoke mock with responses
export async function setupInvokeMock(responses: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core')
  const mockedInvoke = vi.mocked(invoke)

  mockedInvoke.mockImplementation(async (cmd: string) => {
    if (cmd in responses) {
      return responses[cmd]
    }
    throw new Error(`Unmocked command: ${cmd}`)
  })

  return mockedInvoke
}
