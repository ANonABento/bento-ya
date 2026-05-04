import { useEffect } from 'react'

type Props = {
  onClose: () => void
}

type ShortcutItem = {
  keys: readonly string[]
  description: string
}

type ShortcutSection = {
  category: string
  items: readonly ShortcutItem[]
}

const SHORTCUTS = [
  {
    category: 'Global',
    items: [
      { keys: ['?'], description: 'Open keyboard shortcuts' },
      { keys: ['Cmd', '/'], description: 'Open keyboard shortcuts' },
      { keys: ['Cmd', 'K'], description: 'Open command palette / search' },
      { keys: ['Cmd', ','], description: 'Open settings' },
      { keys: ['Cmd', 'J'], description: 'Toggle chef panel' },
      { keys: ['Esc'], description: 'Close modal, panel, menu, or expanded task' },
    ],
  },
  {
    category: 'Workspaces',
    items: [
      { keys: ['Cmd', '1-9'], description: 'Switch to workspace 1-9' },
      { keys: ['Cmd', 'T'], description: 'New workspace' },
      { keys: ['Cmd', 'W'], description: 'Close current workspace' },
      { keys: ['Ctrl', 'Tab'], description: 'Next workspace' },
      { keys: ['Ctrl', 'Shift', 'Tab'], description: 'Previous workspace' },
    ],
  },
  {
    category: 'Tasks',
    items: [
      { keys: ['Enter'], description: 'Open selected task' },
      { keys: ['Space'], description: 'Run or stop agent for selected task' },
      { keys: ['R'], description: 'Retry failed pipeline for selected task' },
      { keys: ['ArrowRight'], description: 'Move selected task to the next column' },
      { keys: ['D'], description: 'Duplicate selected task' },
      { keys: ['M'], description: 'Open move task menu' },
      { keys: ['L'], description: 'Edit task dependencies' },
      { keys: ['Cmd/Ctrl', 'Drag'], description: 'Link task dependencies' },
      { keys: ['Del'], description: 'Delete selected task' },
      { keys: ['Backspace'], description: 'Delete selected task' },
    ],
  },
  {
    category: 'Command Palette',
    items: [
      { keys: ['ArrowDown'], description: 'Select next command' },
      { keys: ['ArrowUp'], description: 'Select previous command' },
      { keys: ['Enter'], description: 'Run selected command' },
      { keys: ['Cmd', 'Enter'], description: 'Create task from search text' },
    ],
  },
  {
    category: 'Chat & Input',
    items: [
      { keys: ['Cmd', 'L'], description: 'Close agent chat panel' },
      { keys: ['Enter'], description: 'Send message or submit task title' },
      { keys: ['Shift', 'Enter'], description: 'Insert a new line in chat' },
    ],
  },
  {
    category: 'Terminal',
    items: [
      { keys: ['Ctrl', 'C'], description: 'Interrupt running process' },
    ],
  },
] satisfies readonly ShortcutSection[]

function KbdSequence({ keys }: { keys: readonly string[] }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {keys.map((key, index) => (
        <span key={`${key}-${String(index)}`} className="flex items-center gap-1">
          <kbd className="rounded-md border border-border-default bg-bg px-1.5 py-0.5 font-mono text-[11px] leading-5 text-text-primary shadow-sm">
            {key}
          </kbd>
          {index < keys.length - 1 && (
            <span className="text-[11px] text-text-secondary">+</span>
          )}
        </span>
      ))}
    </div>
  )
}

export function ShortcutsModal({ onClose }: Props) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => { window.removeEventListener('keydown', handleKeyDown, true) }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border-default bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
          <div>
            <h2 id="shortcuts-title" className="text-lg font-semibold text-text-primary">
              Keyboard Shortcuts
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              Available outside text fields unless noted.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-bg hover:text-text-primary"
            style={{ cursor: 'pointer' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {SHORTCUTS.map((section) => (
              <section key={section.category} className="rounded-lg border border-border-default bg-bg p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  {section.category}
                </h3>
                <div className="space-y-1.5">
                  {section.items.map((item) => (
                    <div key={item.keys.join('+')} className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
                      <span className="min-w-0 text-text-secondary">{item.description}</span>
                      <KbdSequence keys={item.keys} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
