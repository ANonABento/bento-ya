/**
 * Interactive runtime view (Phase 2).
 *
 * Thin wrapper around `TerminalView` that adds a control bar with
 * Interrupt / Restart / model-switch controls. The xterm canvas is the
 * same one headless+terminal mode uses — interactive mode is a different
 * spawn shape, but the rendering primitive is identical.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  agentInterrupt,
  agentPause,
  agentRestart,
  agentResume,
  agentSwitchModel,
} from '@/lib/ipc/agent-interactive'
import { listen, type UnlistenFn } from '@/lib/ipc'
import { EventChannels } from '@/types/events'
import { TerminalView } from './terminal-view'

type InteractiveAgentViewProps = {
  taskId: string
  workingDir: string
  /** Backend-reported agent status. Drives the "stopped" indicator. */
  agentStatus?: string | null
  /** Phase 5 — Unix ms when the user paused this task's agent.
   *  null/undefined = not paused. */
  agentPausedAt?: number | null
}

type LiveStatus = 'running' | 'idle' | 'stopped' | 'paused'

/** Bytes-of-silence threshold used to flip "running" to "idle". */
const IDLE_AFTER_MS = 1200

const MODEL_OPTIONS = ['opus', 'sonnet', 'haiku'] as const
type ModelOption = (typeof MODEL_OPTIONS)[number]

export function InteractiveAgentView({
  taskId,
  workingDir,
  agentStatus,
  agentPausedAt,
}: InteractiveAgentViewProps) {
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('running')
  const [restarting, setRestarting] = useState(false)
  const [interrupting, setInterrupting] = useState(false)
  const [switchingModel, setSwitchingModel] = useState(false)
  const [pauseBusy, setPauseBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastOutputAtRef = useRef<number>(Date.now())
  const isPaused = agentPausedAt != null

  // Listen to pty output events to track "is the agent typing right now?"
  // — used to flip the status pill between running and idle. We don't try
  // to parse the TUI to detect the input prompt directly because that
  // ANSI shape changes between Claude Code releases.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null
    let cancelled = false

    listen<string>(EventChannels.ptyOutput(taskId), () => {
      lastOutputAtRef.current = Date.now()
      setLiveStatus('running')
    }).then((fn) => {
      if (cancelled) {
        fn()
        return
      }
      unlisten = fn
    }).catch((err: unknown) => {
      console.warn('[interactive-agent-view] pty:output listener failed:', err)
    })

    const interval = window.setInterval(() => {
      const elapsed = Date.now() - lastOutputAtRef.current
      if (elapsed > IDLE_AFTER_MS) {
        setLiveStatus('idle')
      }
    }, 400)

    return () => {
      cancelled = true
      if (unlisten) unlisten()
      window.clearInterval(interval)
    }
  }, [taskId])

  const status: LiveStatus =
    agentStatus === 'completed' || agentStatus === 'failed' || agentStatus === 'stopped'
      ? 'stopped'
      : isPaused
        ? 'paused'
        : liveStatus

  // Lock the model dropdown mid-response. Paused doesn't count as
  // mid-response since the agent's not generating; but we don't want
  // to send a slash command into a suspended shell either, so also
  // lock when paused.
  const modelLocked = status === 'running' || isPaused

  const handleInterrupt = useCallback(async () => {
    if (interrupting) return
    setInterrupting(true)
    setError(null)
    try {
      await agentInterrupt(taskId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      window.setTimeout(() => { setInterrupting(false) }, 250)
    }
  }, [interrupting, taskId])

  const handleRestart = useCallback(async () => {
    if (restarting) return
    if (!window.confirm('Restart the interactive agent? Current session will end and a fresh one will spawn with the same trigger config.')) {
      return
    }
    setRestarting(true)
    setError(null)
    try {
      await agentRestart(taskId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      // Generous debounce — the new session needs a moment to land.
      window.setTimeout(() => { setRestarting(false) }, 1500)
    }
  }, [restarting, taskId])

  const handleModelChange = useCallback(async (next: ModelOption) => {
    if (modelLocked || switchingModel) return
    setSwitchingModel(true)
    setError(null)
    try {
      await agentSwitchModel(taskId, next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      window.setTimeout(() => { setSwitchingModel(false) }, 250)
    }
  }, [modelLocked, switchingModel, taskId])

  const handlePauseToggle = useCallback(async () => {
    if (pauseBusy) return
    setPauseBusy(true)
    setError(null)
    try {
      if (isPaused) {
        await agentResume(taskId)
      } else {
        await agentPause(taskId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      window.setTimeout(() => { setPauseBusy(false) }, 200)
    }
  }, [pauseBusy, isPaused, taskId])

  return (
    <div
      data-testid="interactive-agent-view"
      className="flex h-full min-h-0 flex-col bg-bg"
    >
      <ControlBar
        status={status}
        modelLocked={modelLocked}
        interrupting={interrupting}
        restarting={restarting}
        switchingModel={switchingModel}
        isPaused={isPaused}
        pauseBusy={pauseBusy}
        onInterrupt={() => { void handleInterrupt() }}
        onRestart={() => { void handleRestart() }}
        onModelChange={(m) => { void handleModelChange(m) }}
        onPauseToggle={() => { void handlePauseToggle() }}
      />
      {error && (
        <div
          className="border-b border-error/30 bg-error/10 px-3 py-1.5 text-[11px] text-error"
          data-testid="interactive-agent-view-error"
        >
          {error}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <TerminalView taskId={taskId} workingDir={workingDir} />
      </div>
    </div>
  )
}

type ControlBarProps = {
  status: LiveStatus
  modelLocked: boolean
  interrupting: boolean
  restarting: boolean
  switchingModel: boolean
  isPaused: boolean
  pauseBusy: boolean
  onInterrupt: () => void
  onRestart: () => void
  onModelChange: (model: ModelOption) => void
  onPauseToggle: () => void
}

function ControlBar({
  status,
  modelLocked,
  interrupting,
  restarting,
  switchingModel,
  isPaused,
  pauseBusy,
  onInterrupt,
  onRestart,
  onModelChange,
  onPauseToggle,
}: ControlBarProps) {
  const statusColor =
    status === 'running'
      ? 'text-running bg-running/10'
      : status === 'idle'
        ? 'text-text-secondary bg-surface-hover'
        : status === 'paused'
          ? 'text-warning bg-warning/10'
          : 'text-error bg-error/10'

  return (
    <div
      data-testid="interactive-agent-control-bar"
      className="flex items-center justify-between gap-3 border-b border-border-default bg-surface px-3 py-1.5"
    >
      <div className="flex items-center gap-2">
        <span
          data-testid="interactive-agent-status"
          className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium ${statusColor}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === 'running'
                ? 'animate-pulse bg-running'
                : status === 'idle'
                  ? 'bg-text-secondary/60'
                  : status === 'paused'
                    ? 'bg-warning'
                    : 'bg-error'
            }`}
          />
          {status === 'running'
            ? 'Running'
            : status === 'idle'
              ? 'Idle'
              : status === 'paused'
                ? 'Paused'
                : 'Stopped'}
        </span>
        <span className="text-[11px] text-text-secondary/70">Interactive</span>
      </div>
      <div className="flex items-center gap-2">
        <ModelDropdown
          disabled={modelLocked || switchingModel}
          onChange={onModelChange}
        />
        <button
          type="button"
          onClick={onPauseToggle}
          disabled={pauseBusy}
          data-testid="interactive-agent-pause"
          title={
            isPaused
              ? 'Resume the suspended agent process'
              : 'Suspend the agent process (SIGTSTP). In-flight network requests keep going — use Interrupt for a hard stop.'
          }
          className="rounded border border-border-default bg-surface px-2 py-0.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
          style={{ cursor: pauseBusy ? 'wait' : 'pointer' }}
        >
          {isPaused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          onClick={onInterrupt}
          disabled={interrupting}
          data-testid="interactive-agent-interrupt"
          title="Send Ctrl+C — aborts current generation, agent stays at prompt"
          className="rounded border border-border-default bg-surface px-2 py-0.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
          style={{ cursor: interrupting ? 'wait' : 'pointer' }}
        >
          Interrupt
        </button>
        <button
          type="button"
          onClick={onRestart}
          disabled={restarting}
          data-testid="interactive-agent-restart"
          title="Kill the agent and respawn with the same trigger config"
          className="rounded border border-warning/40 bg-surface px-2 py-0.5 text-[11px] font-medium text-warning hover:bg-warning/10 disabled:opacity-50"
          style={{ cursor: restarting ? 'wait' : 'pointer' }}
        >
          Restart
        </button>
      </div>
    </div>
  )
}

function ModelDropdown({
  disabled,
  onChange,
}: {
  disabled: boolean
  onChange: (model: ModelOption) => void
}) {
  return (
    <select
      data-testid="interactive-agent-model"
      disabled={disabled}
      defaultValue=""
      onChange={(e) => {
        const next = e.target.value as ModelOption | ''
        if (next) {
          onChange(next)
          // Reset to placeholder so re-selecting the same model fires again.
          e.target.value = ''
        }
      }}
      title={
        disabled
          ? 'Wait for the agent to finish responding before switching models'
          : 'Send /model <name> to the live agent'
      }
      className="rounded border border-border-default bg-bg px-1.5 py-0.5 text-[11px] text-text-primary disabled:opacity-50"
    >
      <option value="">Model: pick…</option>
      {MODEL_OPTIONS.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  )
}
