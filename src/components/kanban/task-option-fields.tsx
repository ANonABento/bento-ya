import { useEffect, useState, type ReactNode } from 'react'
import type { AgentRuntimeMode } from '@/types'
import { interactiveModeDevFlag } from '@/lib/ipc/agent-interactive'

// ─── Shared create/edit option controls ──────────────────────────────────────
//
// Model + runtime-mode (+ optional priority) pickers, factored out so the
// new-task surface and the task settings modal drive the same controls from one
// place. Anything an agent/MCP can set at creation, a human can set here too.

export const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const

interface TaskOptionFieldsProps {
  model: string
  onModelChange: (value: string) => void
  runtimeMode: AgentRuntimeMode | ''
  onRuntimeModeChange: (value: AgentRuntimeMode | '') => void
  /** Priority picker is rendered only when this handler is supplied. */
  priority?: string
  onPriorityChange?: (value: string) => void
  /** Disambiguates element ids when more than one instance can mount. */
  idPrefix?: string
  /** Extra content rendered under the runtime select (e.g. resolved-mode hint). */
  runtimeFooter?: ReactNode
  /** Override the default helper copy under each control. */
  modelHelp?: ReactNode
  runtimeHelp?: ReactNode
}

const SELECT_CLASS =
  'w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none'

export function TaskOptionFields({
  model,
  onModelChange,
  runtimeMode,
  onRuntimeModeChange,
  priority,
  onPriorityChange,
  idPrefix = 'task',
  runtimeFooter,
  modelHelp,
  runtimeHelp,
}: TaskOptionFieldsProps) {
  const [devFlagEnabled, setDevFlagEnabled] = useState<boolean | null>(null)

  // Reading the env flag is async-but-fast. While it loads we leave the
  // 'Interactive' option enabled — worst case the user picks it and the
  // backend downgrades to terminal with a warning (already wired up).
  useEffect(() => {
    let cancelled = false
    interactiveModeDevFlag()
      .then((value) => { if (!cancelled) setDevFlagEnabled(value) })
      .catch(() => { if (!cancelled) setDevFlagEnabled(null) })
    return () => { cancelled = true }
  }, [])

  const interactiveDisabled = devFlagEnabled === false
  const runtimeId = `${idPrefix}-runtime-mode`

  return (
    <div className="space-y-4">
      {/* Model */}
      <div>
        <label htmlFor={`${idPrefix}-model`} className="mb-1.5 block text-sm font-medium text-text-secondary">
          Model
        </label>
        <p className="mb-2 text-xs text-text-secondary">
          {modelHelp ?? 'Override the AI model for this task. Leave on Auto to use the column trigger default.'}
        </p>
        <select
          id={`${idPrefix}-model`}
          value={model}
          onChange={(e) => { onModelChange(e.target.value) }}
          className={SELECT_CLASS}
        >
          <option value="">Auto (column default)</option>
          <option value="opus">Opus (most capable)</option>
          <option value="sonnet">Sonnet (fast + capable)</option>
          <option value="haiku">Haiku (quick + light)</option>
        </select>
      </div>

      {/* Priority (optional) */}
      {onPriorityChange && (
        <div>
          <label htmlFor={`${idPrefix}-priority`} className="mb-1.5 block text-sm font-medium text-text-secondary">
            Priority
          </label>
          <select
            id={`${idPrefix}-priority`}
            value={priority ?? 'medium'}
            onChange={(e) => { onPriorityChange(e.target.value) }}
            className={SELECT_CLASS}
          >
            {PRIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Runtime */}
      <div>
        <label htmlFor={runtimeId} className="mb-1.5 block text-sm font-medium text-text-secondary">
          Runtime
        </label>
        {runtimeHelp !== undefined ? (
          <p className="mb-2 text-xs text-text-secondary">{runtimeHelp}</p>
        ) : (
          <p className="mb-2 text-xs text-text-secondary">
            How this task talks to its agent. Leave on inherit to use the
            column&apos;s runtime mode.
          </p>
        )}
        <select
          id={runtimeId}
          value={runtimeMode}
          onChange={(e) => { onRuntimeModeChange(e.target.value as AgentRuntimeMode | '') }}
          className={SELECT_CLASS}
        >
          <option value="">Inherit from column</option>
          <option value="terminal">Headless · terminal (tmux)</option>
          <option value="managed">Headless · bubbles (managed)</option>
          <option value="interactive" disabled={interactiveDisabled}>
            Interactive (live TUI){interactiveDisabled ? ' — set KAITENCODE_INTERACTIVE_MODE_ENABLED=1' : ''}
          </option>
        </select>
        {runtimeFooter}
      </div>
    </div>
  )
}
