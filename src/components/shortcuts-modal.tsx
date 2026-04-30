import { useEffect } from 'react'
import { motion } from 'motion/react'

type ShortcutItem = {
  keys: string[]
  desc: string
}

type ShortcutSection = {
  category: string
  items: ShortcutItem[]
}

type Props = {
  onClose: () => void
}

const SHORTCUT_SECTIONS: ShortcutSection[] = [
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

function KbdSequence({ keys }: { keys: string[] }) {
  return (
    <div className="flex min-w-[116px] flex-wrap justify-end gap-1">
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} className="inline-flex items-center gap-1">
          <kbd className="rounded border border-border-default bg-bg px-1.5 py-0.5 font-mono text-[11px] leading-5 text-text-primary">
            {key}
          </kbd>
          {index < keys.length - 1 && (
            <span className="text-xs text-text-secondary">+</span>
          )}
        </span>
      ))}
    </div>
  )
}

export function ShortcutsModal({ onClose }: Props) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border-default bg-surface shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
      >
        <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
          <h2 id="shortcuts-title" className="text-base font-semibold text-text-primary">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-bg hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
            aria-label="Close keyboard shortcuts"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          <div className="grid gap-4 md:grid-cols-2">
            {SHORTCUT_SECTIONS.map((section) => (
              <section key={section.category} className="rounded-lg border border-border-default bg-bg/60 p-3">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  {section.category}
                </h3>
                <div className="space-y-2">
                  {section.items.map((item) => (
                    <div key={`${section.category}-${item.keys.join('+')}-${item.desc}`} className="flex items-start justify-between gap-3 text-sm">
                      <span className="min-w-0 text-text-secondary">{item.desc}</span>
                      <KbdSequence keys={item.keys} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
