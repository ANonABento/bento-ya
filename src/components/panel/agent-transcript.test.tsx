import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { AgentTranscriptEvent, AgentTranscriptEventType } from '@/types/events'
import { AgentTranscript } from './agent-transcript'

function event(
  eventType: AgentTranscriptEventType,
  overrides: Partial<AgentTranscriptEvent> = {},
): AgentTranscriptEvent {
  return {
    id: `${eventType}-${String(overrides.sequence ?? 1)}`,
    taskId: 'task-1',
    sessionId: 'session-1',
    eventType,
    content: null,
    metadataJson: null,
    sequence: 1,
    createdAt: '2026-05-07T06:00:00Z',
    ...overrides,
  }
}

describe('AgentTranscript', () => {
  it('renders user prompts and assistant markdown from semantic events', () => {
    render(
      <AgentTranscript
        events={[
          event('user_input', { id: 'u1', sequence: 1, content: 'write a **haiku**' }),
          event('agent_text_delta', { id: 'a1', sequence: 2, content: '### Result\n\nquiet ' }),
          event('agent_text_delta', { id: 'a2', sequence: 3, content: 'build ships' }),
        ]}
      />,
    )

    expect(screen.getByText('> user')).toBeInTheDocument()
    expect(screen.getByTestId('agent-transcript').firstElementChild).toHaveClass('w-full', 'max-w-none')
    expect(screen.getByText('agent')).toBeInTheDocument()
    expect(screen.getByText('haiku')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Result' })).toBeInTheDocument()
    expect(screen.getByText(/quiet/)).toHaveTextContent('quiet build ships')
  })

  it('shows queued user input delivery from semantic metadata', () => {
    render(
      <AgentTranscript
        events={[
          event('user_input', {
            id: 'u1',
            sequence: 1,
            content: 'please adjust this',
            metadataJson: '{"delivery":"queued","source":"user_chat"}',
          }),
        ]}
      />,
    )

    expect(screen.getByText(/queued for next turn/)).toBeInTheDocument()
    expect(screen.getByText('please adjust this')).toBeInTheDocument()
  })

  it('renders start, tool, command, completion, and failure metadata', () => {
    render(
      <AgentTranscript
        events={[
          event('session_started', { id: 's1', sequence: 1, metadataJson: '{"cli":"claude","workdir":"/tmp"}' }),
          event('agent_started', { id: 'a1', sequence: 2, metadataJson: '{"model":"sonnet","cli":"claude"}' }),
          event('tool_started', { id: 't1', sequence: 3, metadataJson: '{"toolName":"Read"}' }),
          event('tool_output', { id: 't2', sequence: 4, content: 'file contents', metadataJson: '{"toolName":"Read"}' }),
          event('tool_completed', { id: 't3', sequence: 5, metadataJson: '{"toolName":"Read"}' }),
          event('command_started', { id: 'c1', sequence: 6, metadataJson: '{"cli":"codex"}' }),
          event('command_output', { id: 'c2', sequence: 7, content: 'raw command detail', metadataJson: '{"source":"tmux_log_tail"}' }),
          event('command_completed', { id: 'c3', sequence: 8, metadataJson: '{"exitCode":0}' }),
          event('agent_completed', { id: 'done', sequence: 9, metadataJson: '{"exitCode":0}' }),
          event('agent_failed', { id: 'fail', sequence: 10, content: 'boom' }),
        ]}
      />,
    )

    const run = screen.getByRole('button', { name: /run.*claude/ })
    expect(run).toHaveTextContent('claude')
    fireEvent.click(run)
    expect(screen.getByText(/agent started/)).toHaveTextContent('sonnet')
    expect(screen.getByRole('button', { name: /Read.*completed/ })).toBeInTheDocument()
    expect(screen.getByText('agent output')).toBeInTheDocument()
    expect(screen.queryByText('command')).not.toBeInTheDocument()
    expect(screen.queryByText(/completed · exit 0/)).not.toBeInTheDocument()
    expect(screen.getByText('agent failed')).toBeInTheDocument()
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('folds thinking and command output by default', () => {
    render(
      <AgentTranscript
        events={[
          event('agent_thinking_delta', { id: 'th1', sequence: 1, content: 'private plan' }),
          event('command_output', { id: 'out1', sequence: 2, content: 'verbose command output' }),
        ]}
      />,
    )

    expect(screen.getByText('thinking')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Command.*output/ })).toBeInTheDocument()
    expect(screen.queryByText('private plan')).not.toBeInTheDocument()
    expect(screen.queryByText('verbose command output')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /thinking/ }))
    expect(screen.getByText('private plan')).toBeInTheDocument()
  })

  it('filters tmux command tails into readable agent output', () => {
    render(
      <AgentTranscript
        events={[
          event('command_output', {
            id: 'tail',
            sequence: 1,
            content: "bash '/Users/kaiten/.kaitencode/trigger_logs/run_abc123.sh'\n\u001b[90mthinking...\u001b[0m\n\u001b[36m▶ Read\u001b[0m\nThe task is complete.\nkaiten@KaitenMac kaitencode-123 %",
            metadataJson: '{"source":"tmux_log_tail"}',
          }),
          event('command_completed', { id: 'done', sequence: 2, metadataJson: '{"exitCode":0}' }),
        ]}
      />,
    )

    expect(screen.getByText('agent output')).toBeInTheDocument()
    expect(screen.getByText(/thinking/)).toBeInTheDocument()
    expect(screen.getByText(/Read/)).toBeInTheDocument()
    expect(screen.queryByText(/task is complete/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Read/ }))
    expect(screen.getByText(/task is complete/)).toBeInTheDocument()
    expect(screen.queryByText(/trigger_logs/)).not.toBeInTheDocument()
    expect(screen.queryByText(/kaitencode-123 %/)).not.toBeInTheDocument()
    expect(screen.queryByText(/completed · exit 0/)).not.toBeInTheDocument()
  })

  it('filters orphaned trigger launcher filename fragments from tmux tails', () => {
    render(
      <AgentTranscript
        events={[
          event('command_output', {
            id: 'tail',
            sequence: 1,
            content: "851a1.sh'\n2\nthinking...\nThe task is complete.",
            metadataJson: '{"source":"tmux_log_tail"}',
          }),
        ]}
      />,
    )

    expect(screen.getByText(/thinking/)).toBeInTheDocument()
    expect(screen.queryByText(/^2$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/851a1\.sh/)).not.toBeInTheDocument()
  })

  it('coalesces Claude tool_result output into the original tool row', () => {
    render(
      <AgentTranscript
        events={[
          event('session_started', {
            id: 'run',
            sequence: 1,
            metadataJson: '{"cli":"claude"}',
          }),
          event('tool_started', {
            id: 'tool-start',
            sequence: 2,
            metadataJson: '{"toolId":"toolu_1","toolName":"Bash"}',
          }),
          event('tool_output', {
            id: 'tool-output',
            sequence: 3,
            content: 'git status output',
            metadataJson: '{"toolId":"toolu_1"}',
          }),
          event('tool_completed', {
            id: 'tool-complete',
            sequence: 4,
            metadataJson: '{"toolId":"toolu_1"}',
          }),
        ]}
      />,
    )

    const bash = screen.getByRole('button', { name: /Bash.*completed/ })
    expect(bash).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /tool result|tool_result/ })).not.toBeInTheDocument()
    fireEvent.click(bash)
    expect(screen.getByText(/git status output/)).toBeInTheDocument()
  })

  it('renders Claude text tool result JSON as readable transcript text', () => {
    render(
      <AgentTranscript
        events={[
          event('command_output', {
            id: 'tail',
            sequence: 1,
            content: '✓ [{"type":"text","text":"Found it!\\n\\n**File Path:** `poem.md`"}]',
            metadataJson: '{"source":"tmux_log_tail"}',
          }),
        ]}
      />,
    )

    expect(screen.getByText(/Found it!/)).toBeInTheDocument()
    expect(screen.getByText(/File Path:/)).toBeInTheDocument()
    expect(screen.queryByText(/\{"type":"text"/)).not.toBeInTheDocument()
  })

  it('coalesces repeated live tmux tails into one agent output block per run', () => {
    render(
      <AgentTranscript
        events={[
          event('session_started', { id: 's1', sequence: 1, metadataJson: '{"cli":"claude"}' }),
          event('command_output', {
            id: 'tail-1',
            sequence: 2,
            content: 'thinking...\n▶ Read',
            metadataJson: '{"source":"tmux_live_tail"}',
          }),
          event('command_output', {
            id: 'tail-2',
            sequence: 3,
            content: 'The task is creative writing.\n▶ Write',
            metadataJson: '{"source":"tmux_live_tail"}',
          }),
        ]}
      />,
    )

    expect(screen.getAllByText('agent output')).toHaveLength(1)
    expect(screen.getByText(/creative writing/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Read/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Write/ })).toBeInTheDocument()
  })

  it('uses session events as compact run boundaries and skips redundant agent starts', () => {
    render(
      <AgentTranscript
        events={[
          event('session_started', {
            id: 's1',
            sequence: 1,
            metadataJson: '{"cli":"claude","workdir":"/Users/kaiten/kaitencode/.worktrees/kaitencode-3d379760-4938-489a-8543-250f6d35f3e1"}',
          }),
          event('agent_started', {
            id: 'a1',
            sequence: 2,
            metadataJson: '{"cli":"claude","workdir":"/Users/kaiten/kaitencode/.worktrees/kaitencode-3d379760-4938-489a-8543-250f6d35f3e1"}',
          }),
        ]}
      />,
    )

    const runButton = screen.getByRole('button', { name: /run.*claude/ })
    expect(runButton).toHaveTextContent('claude')
    expect(runButton).toHaveTextContent(/kaitencode-3d37976.*6d35f3e1/)
    expect(screen.queryByText(/agent started/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Users\/kaiten\/kaitencode/)).not.toBeInTheDocument()
  })

  it('does not split one run when provider emits a nested session_started event', () => {
    render(
      <AgentTranscript
        events={[
          event('session_started', { id: 'manual-start', sequence: 1, metadataJson: '{"cli":"claude","workdir":"/tmp"}' }),
          event('command_started', { id: 'cmd', sequence: 2, metadataJson: '{"cli":"claude"}' }),
          event('session_started', { id: 'provider-start', sequence: 3, metadataJson: '{"adapter":"claude_cli","providerSessionId":"provider-1"}' }),
          event('agent_text_delta', { id: 'text', sequence: 4, content: 'hello from provider' }),
          event('agent_completed', { id: 'done', sequence: 5, metadataJson: '{"exitCode":0}' }),
        ]}
      />,
    )

    expect(screen.getAllByRole('button', { name: /run/ })).toHaveLength(1)
    expect(screen.getByText(/hello from provider/)).toBeInTheDocument()
    expect(screen.queryByText(/provider-1/)).not.toBeInTheDocument()
  })

  it('renders exit code 130 as cancelled rather than failed', () => {
    render(
      <AgentTranscript
        events={[
          event('command_completed', { id: 'c1', sequence: 1, metadataJson: '{"exitCode":130}' }),
          event('agent_failed', { id: 'f1', sequence: 2, metadataJson: '{"exitCode":130}' }),
        ]}
      />,
    )

    expect(screen.getByText('agent cancelled')).toBeInTheDocument()
    expect(screen.queryByText('agent failed')).not.toBeInTheDocument()
  })

  it('renders explicit agent_cancelled events as cancelled', () => {
    render(
      <AgentTranscript
        events={[
          event('session_started', { id: 's1', sequence: 1, metadataJson: '{"cli":"claude"}' }),
          event('agent_cancelled', { id: 'cancel', sequence: 2, content: 'stopped' }),
        ]}
      />,
    )

    expect(screen.getByRole('button', { name: /agent cancelled.*stopped/ })).toBeInTheDocument()
  })

  it('does not show raw terminal fallback for corrupted scrollback-like content', () => {
    render(
      <AgentTranscript
        events={[
          event('command_output', {
            id: 'polluted-tail',
            sequence: 1,
            content: "BENTOYA_CLAUDE_FILTER='if .type then empty end'\nquote>\nbentomac %",
            metadataJson: '{"source":"tmux_log_tail"}',
          }),
        ]}
      />,
    )

    expect(screen.getByText('No semantic transcript yet')).toBeInTheDocument()
    expect(screen.queryByText(/BENTOYA_CLAUDE_FILTER/)).not.toBeInTheDocument()
    expect(screen.queryByText(/quote>/)).not.toBeInTheDocument()
    expect(screen.queryByText(/bentomac %/)).not.toBeInTheDocument()
  })

  it('shows queued and running states without terminal output', () => {
    render(
      <AgentTranscript
        events={[]}
        processingStartTime={Date.now()}
        queuedMessages={[{ id: 'q1', content: 'next note' }]}
      />,
    )

    expect(screen.getByText(/starting/)).toBeInTheDocument()
    expect(screen.getByText('waiting for transcript events...')).toBeInTheDocument()
    expect(screen.getByText('queued')).toBeInTheDocument()
    expect(screen.getByText('next note')).toBeInTheDocument()
  })

  it('does not duplicate the running placeholder when a semantic run is active', () => {
    render(
      <AgentTranscript
        events={[
          event('session_started', { id: 's1', sequence: 1, metadataJson: '{"cli":"claude"}' }),
          event('agent_started', { id: 'a1', sequence: 2, metadataJson: '{"cli":"claude"}' }),
        ]}
        processingStartTime={Date.now()}
      />,
    )

    expect(screen.getByRole('button', { name: /run.*running/ })).toBeInTheDocument()
    expect(screen.queryByText('waiting for transcript events...')).not.toBeInTheDocument()
  })

  it('labels lifecycle-only active runs as waiting for transcript events', () => {
    render(
      <AgentTranscript
        events={[
          event('session_started', { id: 's1', sequence: 1, metadataJson: '{"cli":"claude"}' }),
          event('agent_started', { id: 'a1', sequence: 2, metadataJson: '{"cli":"claude"}' }),
        ]}
      />,
    )

    expect(screen.getByRole('button', { name: /run.*running/ })).toBeInTheDocument()
    expect(screen.getByText('Waiting for transcript events...')).toBeInTheDocument()
    expect(screen.queryByText(/Only lifecycle events captured/)).not.toBeInTheDocument()
  })
})
