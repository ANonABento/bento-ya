import type { ActionType, ExitCriteria, ExitCriteriaType, TriggerAction } from '@/types'
import { DEFAULT_SPAWN_CLI } from '@/types/column'

/**
 * One-click presets for the column automation sentence. Each builds a complete,
 * runnable rule (an on_entry action + an exit criterion) so the common cases
 * never start from a blank form. See .tickets/_docs/TRIGGER_UX_REDESIGN.md.
 */
export type ColumnRecipe = {
  id: string
  icon: string
  label: string
  hint: string
  build: () => { onEntry: TriggerAction; exitCriteria: ExitCriteria }
}

export const COLUMN_RECIPES: ColumnRecipe[] = [
  {
    id: 'code',
    icon: '⚡',
    label: 'Code it',
    hint: 'Run Claude, advance when it finishes',
    build: () => ({
      onEntry: { ...DEFAULT_SPAWN_CLI },
      exitCriteria: { type: 'agent_complete', auto_advance: true },
    }),
  },
  {
    id: 'review',
    icon: '👀',
    label: 'Review + approve',
    hint: 'Hold here until you approve',
    build: () => ({
      onEntry: { type: 'none' },
      exitCriteria: { type: 'manual_approval', auto_advance: true },
    }),
  },
  {
    id: 'test',
    icon: '🧪',
    label: 'Run tests',
    hint: 'Run a script, advance if it passes',
    build: () => ({
      onEntry: { type: 'run_script', script_id: '' },
      exitCriteria: { type: 'script_success', auto_advance: true },
    }),
  },
  {
    id: 'pr',
    icon: '🔀',
    label: 'Open a PR',
    hint: 'Create a pull request',
    build: () => ({
      onEntry: { type: 'create_pr', base_branch: 'main' },
      exitCriteria: { type: 'agent_complete', auto_advance: true },
    }),
  },
  {
    id: 'manual',
    icon: '▫',
    label: 'Manual column',
    hint: 'No automation — just a board column',
    build: () => ({
      onEntry: { type: 'none' },
      exitCriteria: { type: 'manual', auto_advance: false },
    }),
  },
]

/** Plain-language action verbs for the sentence's "do" clause. */
export const ACTION_CLAUSES: { value: ActionType; label: string }[] = [
  { value: 'spawn_cli', label: 'run an agent' },
  { value: 'run_script', label: 'run a script' },
  { value: 'create_pr', label: 'open a PR' },
  { value: 'auto_setup', label: 'set up a branch + worktree' },
  { value: 'none', label: 'do nothing' },
]

/** Plain-language exit criteria for the sentence's "advance when" clause. */
export const EXIT_CLAUSES: { value: ExitCriteriaType; label: string }[] = [
  { value: 'agent_complete', label: 'the agent finishes' },
  { value: 'script_success', label: 'a script passes' },
  { value: 'manual_approval', label: 'I approve it' },
  { value: 'checklist_done', label: 'the checklist is done' },
  { value: 'time_elapsed', label: 'a timeout passes' },
  { value: 'pr_approved', label: 'the PR is approved' },
  { value: 'notification_sent', label: 'I mark it notified' },
  { value: 'manual', label: 'I move it manually' },
]

/**
 * Model choices for the sentence (plain labels). Values match the spawn-cli
 * editor so the sentence and the advanced editor write identical config.
 * (Unifying the vocabulary to bare opus/sonnet/haiku is a Phase-2 cleanup.)
 */
export const SENTENCE_MODELS: { value: string; label: string }[] = [
  { value: '', label: 'auto' },
  { value: 'claude-opus-4-5', label: 'opus' },
  { value: 'claude-sonnet-4-5', label: 'sonnet' },
  { value: 'claude-haiku-4-5', label: 'haiku' },
]

/** One-line plain-language readout of a column's automation (for the summary chip). */
export function automationSummary(onEntry: TriggerAction | undefined, exit: ExitCriteria | undefined): string {
  if ((onEntry?.type ?? 'none') === 'none' && (exit?.type ?? 'manual') === 'manual') {
    return 'No automation'
  }
  const action = ACTION_CLAUSES.find((a) => a.value === onEntry?.type)?.label ?? 'do nothing'
  const when = EXIT_CLAUSES.find((e) => e.value === exit?.type)?.label ?? 'I move it manually'
  return `${action.charAt(0).toUpperCase()}${action.slice(1)} · advance when ${when}`
}

/** The on_entry action a freshly-picked action type should default to. Mirrors
 *  the dispatcher in column-trigger-action-editors so the sentence and the
 *  advanced editor agree on defaults. */
export function defaultActionForType(type: ActionType): TriggerAction {
  switch (type) {
    case 'spawn_cli':
      return { ...DEFAULT_SPAWN_CLI }
    case 'run_script':
      return { type: 'run_script', script_id: '' }
    case 'create_pr':
      return { type: 'create_pr', base_branch: 'main' }
    case 'auto_merge':
      return { type: 'auto_merge', base_branch: 'main' }
    case 'move_column':
      return { type: 'move_column', target: 'next' }
    case 'auto_setup':
      return { type: 'auto_setup' }
    default:
      return { type: 'none' }
  }
}
