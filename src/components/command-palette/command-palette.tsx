import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion } from 'motion/react'
import { useTaskStore } from '@/stores/task-store'
import { useColumnStore } from '@/stores/column-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useUIStore } from '@/stores/ui-store'
import { useSettingsStore } from '@/stores/settings-store'

type Command = {
  id: string
  label: string
  category: 'Navigation' | 'Tasks' | 'Workspace' | 'Settings'
  icon?: React.ReactNode
  shortcut?: string[]
  action: () => void
}

type Props = {
  onClose: () => void
  onShowShortcuts: () => void
}

const CATEGORY_ORDER: Command['category'][] = ['Navigation', 'Tasks', 'Workspace', 'Settings']

const SearchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
    <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" />
  </svg>
)

const ArrowIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
    <path fillRule="evenodd" d="M2 8a.75.75 0 0 1 .75-.75h8.69L8.22 4.03a.75.75 0 0 1 1.06-1.06l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06-1.06l3.22-3.22H2.75A.75.75 0 0 1 2 8Z" clipRule="evenodd" />
  </svg>
)

const TaskIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
    <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v.401a2.986 2.986 0 0 0-1.5-.401h-9c-.546 0-1.059.146-1.5.401V3.5ZM3.5 5A1.5 1.5 0 0 0 2 6.5v.401A2.986 2.986 0 0 1 3.5 6.5h9c.546 0 1.059.146 1.5.401V6.5A1.5 1.5 0 0 0 12.5 5h-9ZM2 9.5A1.5 1.5 0 0 1 3.5 8h9a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-3Z" />
  </svg>
)

const WorkspaceIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
    <path d="M3.5 2A1.5 1.5 0 0 0 2 3.5v2A1.5 1.5 0 0 0 3.5 7h2A1.5 1.5 0 0 0 7 5.5v-2A1.5 1.5 0 0 0 5.5 2h-2ZM3.5 9A1.5 1.5 0 0 0 2 10.5v2A1.5 1.5 0 0 0 3.5 14h2A1.5 1.5 0 0 0 7 12.5v-2A1.5 1.5 0 0 0 5.5 9h-2ZM9 3.5A1.5 1.5 0 0 1 10.5 2h2A1.5 1.5 0 0 1 14 3.5v2A1.5 1.5 0 0 1 12.5 7h-2A1.5 1.5 0 0 1 9 5.5v-2ZM10.5 9A1.5 1.5 0 0 0 9 10.5v2a1.5 1.5 0 0 0 1.5 1.5h2a1.5 1.5 0 0 0 1.5-1.5v-2A1.5 1.5 0 0 0 12.5 9h-2Z" />
  </svg>
)

const SettingsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
    <path fillRule="evenodd" d="M6.455 1.45A.5.5 0 0 1 6.952 1h2.096a.5.5 0 0 1 .497.45l.186 1.858a4.996 4.996 0 0 1 1.466.848l1.703-.769a.5.5 0 0 1 .639.206l1.048 1.814a.5.5 0 0 1-.142.656l-1.517 1.09a5.026 5.026 0 0 1 0 1.694l1.517 1.09a.5.5 0 0 1 .142.656l-1.048 1.814a.5.5 0 0 1-.639.206l-1.703-.769c-.433.36-.928.65-1.466.848l-.186 1.858a.5.5 0 0 1-.497.45H6.952a.5.5 0 0 1-.497-.45l-.186-1.858a4.993 4.993 0 0 1-1.466-.848l-1.703.769a.5.5 0 0 1-.639-.206L1.413 10.5a.5.5 0 0 1 .142-.656l1.517-1.09a5.026 5.026 0 0 1 0-1.694l-1.517-1.09a.5.5 0 0 1-.142-.656l1.048-1.814a.5.5 0 0 1 .639-.206l1.703.769c.433-.36.928-.65 1.466-.848l.186-1.858ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" clipRule="evenodd" />
  </svg>
)

const CATEGORY_ICONS: Record<Command['category'], React.ReactNode> = {
  Navigation: <ArrowIcon />,
  Tasks: <TaskIcon />,
  Workspace: <WorkspaceIcon />,
  Settings: <SettingsIcon />,
}

export function CommandPalette({ onClose, onShowShortcuts }: Props) {
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  // Store data
  const tasks = useTaskStore((s) => s.tasks)
  const addTask = useTaskStore((s) => s.add)
  const duplicateTask = useTaskStore((s) => s.duplicate)
  const columns = useColumnStore((s) => s.columns)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActive)
  const openTask = useUIStore((s) => s.openTask)
  const closeTask = useUIStore((s) => s.closeTask)
  const activeTaskId = useUIStore((s) => s.activeTaskId)
  const togglePanel = useUIStore((s) => s.togglePanel)
  const openSettings = useSettingsStore((s) => s.openSettings)

  // Build command list
  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = []

    // Navigation: go to task
    for (const task of tasks) {
      cmds.push({
        id: `nav-task-${task.id}`,
        label: `Go to task: ${task.title}`,
        category: 'Navigation',
        action: () => { openTask(task.id) },
      })
    }

    // Navigation: board view
    cmds.push({
      id: 'nav-board',
      label: 'Go to board view',
      category: 'Navigation',
      shortcut: ['Esc'],
      action: () => { closeTask() },
    })

    // Tasks: create new
    cmds.push({
      id: 'task-create',
      label: 'Create new task',
      category: 'Tasks',
      shortcut: ['Cmd', 'Enter'],
      action: () => {
        const firstColumn = columns.sort((a, b) => a.position - b.position)[0]
        if (firstColumn && activeWorkspaceId) {
          void addTask(activeWorkspaceId, firstColumn.id, search || 'New Task', '')
        }
      },
    })

    // Tasks: duplicate active task
    if (activeTaskId) {
      const activeTask = tasks.find((t) => t.id === activeTaskId)
      if (activeTask) {
        cmds.push({
          id: 'task-duplicate',
          label: `Duplicate task: ${activeTask.title}`,
          category: 'Tasks',
          action: () => { void duplicateTask(activeTask.id) },
        })
      }
    }

    // Workspace: switch
    for (const ws of workspaces) {
      if (ws.id !== activeWorkspaceId) {
        cmds.push({
          id: `ws-switch-${ws.id}`,
          label: `Switch to: ${ws.name}`,
          category: 'Workspace',
          action: () => { setActiveWorkspace(ws.id) },
        })
      }
    }

    // Workspace: toggle panel
    cmds.push({
      id: 'ws-toggle-panel',
      label: 'Toggle chef panel',
      category: 'Workspace',
      action: () => { togglePanel() },
    })

    // Settings
    cmds.push({
      id: 'settings-open',
      label: 'Open settings',
      category: 'Settings',
      shortcut: ['Cmd', ','],
      action: () => { openSettings() },
    })

    cmds.push({
      id: 'settings-shortcuts',
      label: 'Show keyboard shortcuts',
      category: 'Settings',
      shortcut: ['Cmd', '/'],
      action: () => { onShowShortcuts() },
    })

    return cmds
  }, [tasks, columns, workspaces, activeWorkspaceId, activeTaskId, search, openTask, closeTask, addTask, duplicateTask, setActiveWorkspace, togglePanel, openSettings, onShowShortcuts])

  // Filter commands
  const filtered = useMemo(() => {
    if (!search) return commands
    const q = search.toLowerCase()
    return commands.filter((cmd) => cmd.label.toLowerCase().includes(q))
  }, [commands, search])

  // Group by category
  const grouped = useMemo(() => {
    const groups: { category: Command['category']; commands: Command[] }[] = []
    for (const cat of CATEGORY_ORDER) {
      const catCommands = filtered.filter((cmd) => cmd.category === cat)
      if (catCommands.length > 0) {
        groups.push({ category: cat, commands: catCommands })
      }
    }
    return groups
  }, [filtered])

  // Flat list for keyboard navigation
  const flatList = useMemo(() => grouped.flatMap((g) => g.commands), [grouped])

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [search])

  // Scroll selected item into view
  useEffect(() => {
    const el = itemRefs.current.get(selectedIndex)
    if (el) {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const executeCommand = useCallback((cmd: Command) => {
    onClose()
    cmd.action()
  }, [onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % flatList.length)
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + flatList.length) % flatList.length)
        break
      case 'Enter':
        e.preventDefault()
        if (flatList[selectedIndex]) {
          executeCommand(flatList[selectedIndex])
        }
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }, [flatList, selectedIndex, executeCommand, onClose])

  // Track flat index for rendering
  let flatIndex = -1

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -20 }}
        className="flex w-full max-w-[550px] flex-col overflow-hidden rounded-xl border border-border-default bg-surface shadow-2xl"
        style={{ maxHeight: '400px' }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border-default px-4 py-3">
          <div className="text-text-secondary">
            <SearchIcon />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value) }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            autoFocus
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-secondary focus:outline-none"
          />
          <kbd className="rounded bg-bg px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
            Esc
          </kbd>
        </div>

        {/* Command list */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2">
          {flatList.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-text-secondary">
              No commands found
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.category} className="mb-1">
                <div className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-text-secondary">
                  {group.category}
                </div>
                {group.commands.map((cmd) => {
                  flatIndex++
                  const idx = flatIndex
                  const isSelected = idx === selectedIndex
                  return (
                    <div
                      key={cmd.id}
                      ref={(el) => {
                        if (el) itemRefs.current.set(idx, el)
                        else itemRefs.current.delete(idx)
                      }}
                      onClick={() => { executeCommand(cmd) }}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                        isSelected ? 'bg-surface-hover text-text-primary' : 'text-text-primary hover:bg-surface-hover'
                      }`}
                    >
                      <span className="text-text-secondary">
                        {cmd.icon ?? CATEGORY_ICONS[cmd.category]}
                      </span>
                      <span className="flex-1 truncate">{cmd.label}</span>
                      {cmd.shortcut && (
                        <div className="flex items-center gap-0.5">
                          {cmd.shortcut.map((key, j) => (
                            <span key={j}>
                              <kbd className="rounded bg-bg px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                                {key}
                              </kbd>
                              {j < cmd.shortcut!.length - 1 && (
                                <span className="mx-0.5 text-[10px] text-text-secondary">+</span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
