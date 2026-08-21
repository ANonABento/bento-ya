import { useCallback, useEffect, useState } from 'react'
import { getChatDebug, clearChatDebug, type ChatDebugTurn } from '@/lib/ipc/system'

// ─── stream-json parsing ────────────────────────────────────────────────────

type ParsedEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool_use'; name: string; input: unknown }
  | { kind: 'tool_result'; text: string }
  | { kind: 'result'; text: string; meta: string }
  | { kind: 'system'; text: string }
  | { kind: 'raw'; text: string }

function strProp(obj: unknown, key: string): string | null {
  if (obj && typeof obj === 'object' && key in obj) {
    const v = (obj as Record<string, unknown>)[key]
    if (typeof v === 'string') return v
  }
  return null
}

function asText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((b) => strProp(b, 'text') ?? '').join('')
  }
  return ''
}

function parseEvents(lines: string[]): ParsedEvent[] {
  const out: ParsedEvent[] = []
  for (const line of lines) {
    let o: Record<string, unknown>
    try {
      o = JSON.parse(line) as Record<string, unknown>
    } catch {
      out.push({ kind: 'raw', text: line })
      continue
    }
    const type = o.type
    const message = o.message as { content?: unknown[] } | undefined
    if (type === 'assistant' && Array.isArray(message?.content)) {
      for (const b of message.content as Array<Record<string, unknown>>) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
          out.push({ kind: 'text', text: b.text })
        } else if (b.type === 'tool_use') {
          out.push({ kind: 'tool_use', name: strProp(b, 'name') ?? 'tool', input: b.input })
        }
      }
    } else if (type === 'user' && Array.isArray(message?.content)) {
      for (const b of message.content as Array<Record<string, unknown>>) {
        if (b.type === 'tool_result') {
          out.push({ kind: 'tool_result', text: asText(b.content) })
        }
      }
    } else if (type === 'result') {
      const durMs = o.duration_ms
      const costUsd = o.total_cost_usd
      const dur = typeof durMs === 'number' ? `${String(Math.round(durMs / 100) / 10)}s` : null
      const cost = typeof costUsd === 'number' ? `$${costUsd.toFixed(4)}` : null
      out.push({
        kind: 'result',
        text: asText(o.result),
        meta: [strProp(o, 'subtype'), dur, cost].filter(Boolean).join(' · '),
      })
    } else if (type === 'system') {
      out.push({ kind: 'system', text: strProp(o, 'subtype') ?? 'system' })
    }
  }
  return out
}

// ─── arg parsing ────────────────────────────────────────────────────────────

function flagValue(args: string[], flag: string): string | null {
  const i = args.indexOf(flag)
  return i >= 0 ? (args[i + 1] ?? null) : null
}

// ─── components ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-text-secondary/70">{label}</span>
      {children}
    </div>
  )
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-border-default bg-bg p-2 font-mono text-xs leading-relaxed text-text-primary">
      {children}
    </pre>
  )
}

function EventRow({ ev }: { ev: ParsedEvent }) {
  switch (ev.kind) {
    case 'system':
      return <div className="text-xs text-text-secondary/60">⚙ {ev.text}</div>
    case 'text':
      return (
        <div className="rounded border-l-2 border-border-default bg-surface/30 px-2 py-1 text-sm text-text-primary">
          <span className="text-text-secondary/60">assistant </span>
          <span className="whitespace-pre-wrap break-words">{ev.text}</span>
        </div>
      )
    case 'tool_use':
      return (
        <div className="rounded border-l-2 border-accent/50 bg-accent/5 px-2 py-1 text-xs">
          <span className="font-semibold text-accent">🔧 {ev.name}</span>
          <span className="ml-1 break-words font-mono text-text-secondary">{JSON.stringify(ev.input)}</span>
        </div>
      )
    case 'tool_result':
      return (
        <div className="rounded border-l-2 border-running/40 bg-running/5 px-2 py-1 font-mono text-xs text-text-secondary">
          <span className="text-running/80">← result </span>
          <span className="break-words">{ev.text.length > 600 ? `${ev.text.slice(0, 600)}…` : ev.text}</span>
        </div>
      )
    case 'result':
      return (
        <div className="rounded border-l-2 border-running/60 bg-running/5 px-2 py-1 text-xs">
          <span className="font-semibold text-running">✓ result</span>
          {ev.meta && <span className="ml-1 text-text-secondary/70">{ev.meta}</span>}
          {ev.text && <div className="mt-0.5 whitespace-pre-wrap break-words text-text-primary">{ev.text}</div>}
        </div>
      )
    case 'raw':
      return <div className="break-words font-mono text-xs text-text-secondary/50">{ev.text}</div>
  }
}

function TurnCard({ turn }: { turn: ChatDebugTurn }) {
  const [open, setOpen] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [showSys, setShowSys] = useState(false)

  const model = flagValue(turn.args, '--model')
  const systemPrompt = flagValue(turn.args, '--system-prompt')
  const mcpConfig = flagValue(turn.args, '--mcp-config')
  const allowedTools = flagValue(turn.args, '--allowedTools')
  const resume = flagValue(turn.args, '--resume')
  const events = parseEvents(turn.output)
  const cli = turn.command.split('/').pop() ?? turn.command
  const time = new Date(turn.startedAtMs).toLocaleTimeString()

  return (
    <div className="rounded-lg border border-border-default bg-surface">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v) }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        style={{ cursor: 'pointer' }}
      >
        <span className={`text-xs text-text-secondary transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className="font-mono text-xs font-semibold text-text-primary">{cli}</span>
        {model && <span className="rounded bg-bg px-1.5 py-0.5 text-xs text-text-secondary">{model}</span>}
        {mcpConfig && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-xs text-accent">mcp</span>}
        {resume && <span className="rounded bg-bg px-1.5 py-0.5 text-xs text-text-secondary">resume</span>}
        <span className="ml-auto text-xs text-text-secondary/60">{events.length} events · {time}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border-default px-3 py-3">
          {/* SENT */}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">↑ Sent</div>
            <Field label="command">
              <span className="break-words font-mono text-xs text-text-primary">
                {turn.command} {turn.args.filter((a) => a !== systemPrompt).join(' ')}
              </span>
            </Field>
            {allowedTools && (
              <Field label="allowed tools">
                <span className="break-words font-mono text-xs text-accent">{allowedTools}</span>
              </Field>
            )}
            {systemPrompt && (
              <Field label={`system prompt (${String(systemPrompt.length)} chars)`}>
                <button type="button" onClick={() => { setShowSys((v) => !v) }} className="self-start text-xs text-accent" style={{ cursor: 'pointer' }}>
                  {showSys ? 'hide' : 'show'}
                </button>
                {showSys && <Mono>{systemPrompt}</Mono>}
              </Field>
            )}
            <Field label={turn.stdin ? `prompt / stdin (${String(turn.stdin.length)} chars)` : 'prompt / stdin'}>
              <Mono>{turn.stdin ?? '(none — message on argv)'}</Mono>
            </Field>
          </div>

          {/* RECEIVED */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">↓ Received</div>
              <button type="button" onClick={() => { setShowRaw((v) => !v) }} className="text-xs text-text-secondary/70 hover:text-text-primary" style={{ cursor: 'pointer' }}>
                {showRaw ? 'parsed' : 'raw'}
              </button>
              {turn.outputTruncated && <span className="text-xs text-warning">(truncated)</span>}
            </div>
            {turn.output.length === 0 ? (
              <div className="text-xs text-text-secondary/60">(no output captured)</div>
            ) : showRaw ? (
              <Mono>{turn.output.join('\n')}</Mono>
            ) : (
              <div className="space-y-1">
                {events.map((ev, i) => <EventRow key={i} ev={ev} />)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function DebugTab() {
  const [turns, setTurns] = useState<ChatDebugTurn[]>([])
  const [auto, setAuto] = useState(true)

  const refresh = useCallback(() => {
    void getChatDebug().then(setTurns).catch(() => { /* ignore */ })
  }, [])

  useEffect(() => {
    refresh()
    if (!auto) return
    const t = setInterval(refresh, 2000)
    return () => { clearInterval(t) }
  }, [auto, refresh])

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">CLI Chat Inspector</h2>
        <p className="mt-0.5 text-xs text-text-secondary">
          The last {20} CLI turns (chef + managed agents) — exactly what we sent (command, args,
          system prompt, stdin) and the raw stream-json we got back, with tool calls parsed out.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={refresh}
          className="rounded-md border border-border-default bg-surface px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          style={{ cursor: 'pointer' }}
        >
          Refresh
        </button>
        <label className="flex items-center gap-1.5 text-xs text-text-secondary" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked) }} />
          Auto-refresh
        </label>
        <button
          type="button"
          onClick={() => { void clearChatDebug().then(refresh) }}
          className="ml-auto rounded-md border border-border-default bg-surface px-2.5 py-1 text-xs text-text-secondary hover:border-error/40 hover:text-error"
          style={{ cursor: 'pointer' }}
        >
          Clear
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {turns.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-text-secondary/60">
            No CLI turns yet — send a message in the chef or an agent chat.
          </div>
        ) : (
          turns.map((t) => <TurnCard key={t.id} turn={t} />)
        )}
      </div>
    </div>
  )
}
