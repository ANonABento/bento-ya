import { motion } from 'motion/react'

type Props = {
  onClose: () => void
}

const VERSION = '1.0.0'

const SHORTCUTS = [
  { category: 'Global', items: [
    { keys: ['Cmd', 'K'], desc: 'Command palette' },
    { keys: ['?'], desc: 'Keyboard shortcuts' },
    { keys: ['Cmd', '/'], desc: 'About Bento-ya' },
    { keys: ['Esc'], desc: 'Close panel / cancel' },
  ]},
  { category: 'Workspaces', items: [
    { keys: ['Cmd', '1-9'], desc: 'Switch to workspace 1-9' },
    { keys: ['Cmd', 'T'], desc: 'New workspace' },
    { keys: ['Cmd', 'W'], desc: 'Close workspace' },
    { keys: ['Ctrl', 'Tab'], desc: 'Next workspace' },
    { keys: ['Ctrl', 'Shift', 'Tab'], desc: 'Previous workspace' },
  ]},
  { category: 'Task Cards', items: [
    { keys: ['Enter'], desc: 'Open task' },
    { keys: ['Space'], desc: 'Open task (peek)' },
    { keys: ['D'], desc: 'Duplicate task' },
    { keys: ['L'], desc: 'Link dependencies' },
    { keys: ['M'], desc: 'Move task menu' },
    { keys: ['Del'], desc: 'Delete task menu' },
  ]},
  { category: 'Terminal', items: [
    { keys: ['Ctrl', 'C'], desc: 'Interrupt process' },
  ]},
]

export function AboutModal({ onClose }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-2xl border border-border-default bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
          <h2 className="text-xl font-semibold text-text-primary">About Bento-ya</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-bg hover:text-text-primary"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        <div className="max-h-[calc(85vh-72px)] overflow-y-auto p-6">
          {/* Version Info */}
          <div className="mb-6 text-center">
            <h3 className="text-lg font-semibold text-text-primary">Bento-ya</h3>
            <p className="text-sm text-text-secondary">Version {VERSION}</p>
            <p className="mt-2 text-sm text-text-secondary">
              AI-powered Kanban for developers
            </p>
          </div>

          {/* Features */}
          <div className="mb-6 rounded-xl border border-border-default bg-bg p-4">
            <h4 className="mb-3 font-medium text-text-primary">Features</h4>
            <ul className="space-y-2 text-sm text-text-secondary">
              <li className="flex items-center gap-2">
                <span className="text-success">*</span>
                AI agent pipeline automation
              </li>
              <li className="flex items-center gap-2">
                <span className="text-success">*</span>
                Multi-workspace management
              </li>
              <li className="flex items-center gap-2">
                <span className="text-success">*</span>
                Git branch integration
              </li>
              <li className="flex items-center gap-2">
                <span className="text-success">*</span>
                Voice input with Whisper
              </li>
              <li className="flex items-center gap-2">
                <span className="text-success">*</span>
                Usage cost tracking
              </li>
              <li className="flex items-center gap-2">
                <span className="text-success">*</span>
                Community templates
              </li>
            </ul>
          </div>

          {/* Keyboard Shortcuts */}
          <div className="rounded-xl border border-border-default bg-bg p-4">
            <h4 className="mb-4 font-medium text-text-primary">Keyboard Shortcuts</h4>
            <div className="space-y-4">
              {SHORTCUTS.map((section) => (
                <div key={section.category}>
                  <h5 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-secondary">
                    {section.category}
                  </h5>
                  <div className="space-y-1.5">
                    {section.items.map((item, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-text-secondary">{item.desc}</span>
                        <div className="flex items-center gap-1">
                          {item.keys.map((key, j) => (
                            <span key={j}>
                              <kbd className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-text-primary">
                                {key}
                              </kbd>
                              {j < item.keys.length - 1 && (
                                <span className="mx-0.5 text-text-secondary">+</span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="mt-6 text-center text-xs text-text-secondary">
            <p>Built with Tauri + React + Rust</p>
            <p className="mt-1">MIT License</p>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
