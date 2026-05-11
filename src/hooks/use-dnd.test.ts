import { describe, expect, it } from 'vitest'
import { getTaskDropPosition, resolveOverColumnId } from './use-dnd'

const columns = [
  { id: 'setup' },
  { id: 'verify' },
  { id: 'done' },
]

const tasks = [
  { id: 'task-1', columnId: 'setup', position: 0 },
  { id: 'task-2', columnId: 'verify', position: 0 },
  { id: 'task-3', columnId: 'verify', position: 1 },
]

describe('useDnd drop target helpers', () => {
  it('resolves synthetic column droppable ids to real column ids', () => {
    expect(resolveOverColumnId('column-drop-verify', { type: 'column' }, tasks, columns)).toBe('verify')
    expect(resolveOverColumnId('column-drop-setup', undefined, tasks, columns)).toBe('setup')
  })

  it('prefers explicit dnd data when present', () => {
    expect(resolveOverColumnId('some-overlay-id', { type: 'column', columnId: 'verify' }, tasks, columns)).toBe('verify')
  })

  it('resolves task drops through the hovered task column', () => {
    expect(resolveOverColumnId('task-2', undefined, tasks, columns)).toBe('verify')
  })

  it('places drops on task cards at that task index', () => {
    expect(getTaskDropPosition('task-3', 'verify', tasks)).toBe(1)
  })

  it('places drops on column bodies at the end of the target column', () => {
    expect(getTaskDropPosition('column-drop-verify', 'verify', tasks)).toBe(2)
  })
})
