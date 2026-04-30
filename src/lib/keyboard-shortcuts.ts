export type ShortcutItem = {
  keys: string[]
  desc: string
}

export type ShortcutSection = {
  category: string
  items: ShortcutItem[]
}

export const KEYBOARD_SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    category: 'Global',
    items: [
      { keys: ['?'], desc: 'Show keyboard shortcuts' },
      { keys: ['Cmd', 'K'], desc: 'Search and command palette' },
      { keys: ['Cmd', ','], desc: 'Open settings' },
      { keys: ['Cmd', '/'], desc: 'About Bento-ya' },
      { keys: ['Esc'], desc: 'Close panel or cancel' },
    ],
  },
  {
    category: 'Workspaces',
    items: [
      { keys: ['Cmd', '1-9'], desc: 'Switch workspace' },
      { keys: ['Cmd', 'T'], desc: 'New workspace' },
      { keys: ['Cmd', 'W'], desc: 'Close workspace' },
      { keys: ['Ctrl', 'Tab'], desc: 'Next workspace' },
      { keys: ['Ctrl', 'Shift', 'Tab'], desc: 'Previous workspace' },
    ],
  },
  {
    category: 'Board',
    items: [
      { keys: ['Cmd', 'J'], desc: 'Toggle chef panel' },
      { keys: ['Cmd', 'L'], desc: 'Close task chat panel' },
      { keys: ['Cmd', 'Drag'], desc: 'Link task dependencies' },
      { keys: ['Esc'], desc: 'Cancel dependency link' },
    ],
  },
  {
    category: 'Task Cards',
    items: [
      { keys: ['Enter'], desc: 'Open task' },
      { keys: ['Space'], desc: 'Run or stop agent' },
      { keys: ['R'], desc: 'Retry failed pipeline' },
      { keys: ['ArrowRight'], desc: 'Move task to next column' },
      { keys: ['M'], desc: 'Open move task menu' },
      { keys: ['D'], desc: 'Duplicate task' },
      { keys: ['L'], desc: 'Edit dependencies' },
      { keys: ['Del'], desc: 'Confirm/delete task' },
      { keys: ['Backspace'], desc: 'Confirm/delete task' },
    ],
  },
  {
    category: 'Command Palette',
    items: [
      { keys: ['ArrowDown'], desc: 'Select next command' },
      { keys: ['ArrowUp'], desc: 'Select previous command' },
      { keys: ['Enter'], desc: 'Run selected command' },
      { keys: ['Cmd', 'Enter'], desc: 'Create task from search text' },
      { keys: ['Esc'], desc: 'Close command palette' },
    ],
  },
  {
    category: 'Editing',
    items: [
      { keys: ['Enter'], desc: 'Submit message, task, or checklist item' },
      { keys: ['Shift', 'Enter'], desc: 'Insert newline in message' },
      { keys: ['Esc'], desc: 'Cancel inline edit' },
    ],
  },
  {
    category: 'Terminal',
    items: [
      { keys: ['Ctrl', 'C'], desc: 'Interrupt process' },
    ],
  },
]
