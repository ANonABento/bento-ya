export type ShortcutItem = {
  keys: readonly string[]
  description: string
}

export type ShortcutSection = {
  category: string
  items: readonly ShortcutItem[]
}

export const KEYBOARD_SHORTCUT_SECTIONS: readonly ShortcutSection[] = [
  {
    category: 'Global',
    items: [
      { keys: ['?'], description: 'Show keyboard shortcuts' },
      { keys: ['Cmd', 'K'], description: 'Search and command palette' },
      { keys: ['Cmd', ','], description: 'Open settings' },
      { keys: ['Cmd', '/'], description: 'About Bento-ya' },
      { keys: ['Esc'], description: 'Close panel or cancel' },
    ],
  },
  {
    category: 'Workspaces',
    items: [
      { keys: ['Cmd', '1-9'], description: 'Switch workspace' },
      { keys: ['Cmd', 'T'], description: 'New workspace' },
      { keys: ['Cmd', 'W'], description: 'Close workspace' },
      { keys: ['Ctrl', 'Tab'], description: 'Next workspace' },
      { keys: ['Ctrl', 'Shift', 'Tab'], description: 'Previous workspace' },
    ],
  },
  {
    category: 'Board',
    items: [
      { keys: ['Cmd', 'J'], description: 'Toggle chef panel' },
      { keys: ['Cmd', 'L'], description: 'Close task chat panel' },
      { keys: ['Cmd', 'Drag'], description: 'Link task dependencies' },
      { keys: ['Esc'], description: 'Cancel dependency link' },
    ],
  },
  {
    category: 'Task Cards',
    items: [
      { keys: ['Enter'], description: 'Open task' },
      { keys: ['Space'], description: 'Run or stop agent' },
      { keys: ['R'], description: 'Retry failed pipeline' },
      { keys: ['ArrowRight'], description: 'Move task to next column' },
      { keys: ['M'], description: 'Open move task menu' },
      { keys: ['D'], description: 'Duplicate task' },
      { keys: ['L'], description: 'Edit dependencies' },
      { keys: ['Del'], description: 'Confirm/delete task' },
      { keys: ['Backspace'], description: 'Confirm/delete task' },
    ],
  },
  {
    category: 'Command Palette',
    items: [
      { keys: ['ArrowDown'], description: 'Select next command' },
      { keys: ['ArrowUp'], description: 'Select previous command' },
      { keys: ['Enter'], description: 'Run selected command' },
      { keys: ['Cmd', 'Enter'], description: 'Create task from search text' },
      { keys: ['Esc'], description: 'Close command palette' },
    ],
  },
  {
    category: 'Editing',
    items: [
      { keys: ['Enter'], description: 'Submit message, task, or checklist item' },
      { keys: ['Shift', 'Enter'], description: 'Insert newline in message' },
      { keys: ['Esc'], description: 'Cancel inline edit' },
    ],
  },
  {
    category: 'Terminal',
    items: [
      { keys: ['Ctrl', 'C'], description: 'Interrupt process' },
    ],
  },
]
