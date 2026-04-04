import { describe, it, expect } from 'vitest'
import { getColumnTriggers, DEFAULT_TRIGGERS } from '@/types/column'
import type { Column } from '@/types/column'

const createMockColumn = (triggers?: Column['triggers']): Column => ({
  id: 'col-1',
  workspaceId: 'ws-1',
  name: 'Test Column',
  icon: 'list',
  position: 0,
  color: '#E8A87C',
  visible: true,
  triggers,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
})

describe('getColumnTriggers', () => {
  it('should return triggers when column has parsed triggers object', () => {
    const triggers = {
      on_entry: { type: 'spawn_cli' as const },
      on_exit: { type: 'none' as const },
      exit_criteria: { type: 'manual' as const, auto_advance: false },
    }
    const column = createMockColumn(triggers)

    const result = getColumnTriggers(column)
    expect(result).toEqual(triggers)
  })

  it('should parse and return triggers when column has JSON string', () => {
    const triggers = {
      on_entry: { type: 'spawn_cli' },
      on_exit: { type: 'none' },
      exit_criteria: { type: 'agent_complete', auto_advance: true },
    }
    // Backend sends triggers as a JSON string
    const column = createMockColumn(JSON.stringify(triggers) as unknown as Column['triggers'])

    const result = getColumnTriggers(column)
    expect(result).toEqual(triggers)
  })

  it('should return DEFAULT_TRIGGERS when triggers is undefined', () => {
    const column = createMockColumn(undefined)

    const result = getColumnTriggers(column)
    expect(result).toEqual(DEFAULT_TRIGGERS)
  })

  it('should return DEFAULT_TRIGGERS when triggers is null', () => {
    const column = createMockColumn(null as unknown as Column['triggers'])

    const result = getColumnTriggers(column)
    expect(result).toEqual(DEFAULT_TRIGGERS)
  })

  it('should return DEFAULT_TRIGGERS when triggers is empty string', () => {
    const column = createMockColumn('' as unknown as Column['triggers'])

    const result = getColumnTriggers(column)
    expect(result).toEqual(DEFAULT_TRIGGERS)
  })

  it('should return DEFAULT_TRIGGERS when triggers is "{}"', () => {
    const column = createMockColumn('{}' as unknown as Column['triggers'])

    const result = getColumnTriggers(column)
    expect(result).toEqual(DEFAULT_TRIGGERS)
  })

  it('should return DEFAULT_TRIGGERS when JSON parse fails', () => {
    const column = createMockColumn('not valid json' as unknown as Column['triggers'])

    const result = getColumnTriggers(column)
    expect(result).toEqual(DEFAULT_TRIGGERS)
  })

  it('should handle triggers with only exit_criteria', () => {
    const triggers = {
      exit_criteria: { type: 'agent_complete' as const, auto_advance: true },
    }
    const column = createMockColumn(triggers)

    const result = getColumnTriggers(column)
    expect(result).toEqual(triggers)
    expect(result.on_entry).toBeUndefined()
    expect(result.on_exit).toBeUndefined()
    expect(result.exit_criteria).toEqual({ type: 'agent_complete', auto_advance: true })
  })
})
