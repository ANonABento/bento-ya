import type { ActionType, CliType, ExitCriteriaType } from '@/types'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Semantic column colors — used in picker, auto-suggestion, and Rust defaults */
export const COLUMN_COLORS = {
  accent: '#E8A87C',
  gray: '#6B7280',
  blue: '#3B82F6',
  amber: '#F59E0B',
  green: '#4ADE80',
  red: '#F87171',
  purple: '#8B5CF6',
  pink: '#EC4899',
  teal: '#06B6D4',
  slate: '#9CA3AF',
} as const

export const COLORS = Object.values(COLUMN_COLORS)

export const ICONS = [
  { value: 'list', label: 'List' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'play', label: 'Play' },
  { value: 'code', label: 'Code' },
  { value: 'check', label: 'Check' },
  { value: 'eye', label: 'Review' },
  { value: 'rocket', label: 'Deploy' },
  { value: 'archive', label: 'Archive' },
]

export const ACTION_TYPES: { value: ActionType; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'No action' },
  { value: 'run_script', label: 'Run Script', description: 'Run automation recipe' },
  { value: 'spawn_cli', label: 'Spawn CLI', description: 'Run AI agent with command' },
  { value: 'move_column', label: 'Move Column', description: 'Move task to another column' },
  { value: 'create_pr', label: 'Create PR', description: 'Open a GitHub pull request' },
]

export const CLI_TYPES: { value: CliType; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'aider', label: 'Aider' },
]

export const EXIT_CRITERIA_TYPES: { value: ExitCriteriaType; label: string; description: string }[] = [
  { value: 'manual', label: 'Manual', description: 'User moves task manually' },
  { value: 'agent_complete', label: 'Agent Complete', description: 'Agent finishes work' },
  { value: 'script_success', label: 'Script Success', description: 'Script exits with code 0' },
  { value: 'checklist_done', label: 'Checklist Done', description: 'All checklist items checked' },
  { value: 'time_elapsed', label: 'Time Elapsed', description: 'After timeout duration' },
  { value: 'pr_approved', label: 'PR Approved', description: 'Pull request is approved' },
  { value: 'manual_approval', label: 'Manual Approval', description: 'Reviewer approves task' },
  { value: 'notification_sent', label: 'Notification Sent', description: 'User marks as notified' },
]

export const STEP_TYPE_COLORS: Record<string, string> = {
  bash: 'bg-blue-500/10 text-blue-400',
  agent: 'bg-purple-500/10 text-purple-400',
  check: 'bg-amber-500/10 text-amber-400',
}

export const COMMON_COMMANDS = [
  '/start-task',
  '/loop-review',
  '/code-check',
  '/quality-check',
  '/fix-pr-comments',
  '/create-pr',
]
