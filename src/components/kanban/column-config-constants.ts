import type { ActionType, CliType, ExitCriteriaType } from '@/types'

// ─── Constants ──────────────────────────────────────────────────────────────

export const COLORS = [
  '#E8A87C', // accent
  '#4ADE80', // success
  '#60A5FA', // running/blue
  '#F59E0B', // attention/amber
  '#F87171', // error/red
  '#A78BFA', // purple
  '#EC4899', // pink
  '#6EE7B7', // teal
]

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
  { value: 'spawn_cli', label: 'Spawn CLI', description: 'Run AI agent with command' },
  { value: 'move_column', label: 'Move Column', description: 'Move task to another column' },
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

export const COMMON_COMMANDS = [
  '/start-task',
  '/loop-review',
  '/code-check',
  '/quality-check',
  '/fix-pr-comments',
  '/create-pr',
]
