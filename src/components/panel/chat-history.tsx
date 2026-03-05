// Re-export shared components
export {
  CliChatHistory as ChatHistory,
  CliChatBubble,
  StreamingBubble,
  QueuedBubble,
  MarkdownContent,
  type ChatMessageData,
  type ActionParser,
  type ParsedAction,
  type ToolCallData,
} from '@/components/shared/cli-chat'

// Orchestrator-specific action parser for task management actions
type OrchestratorAction = {
  action: string
  label: string
  title?: string
  column?: string
  task_id?: string
}

// Parse action blocks from message content and extract display text + actions
function parseOrchestratorActions(content: string): OrchestratorAction[] {
  const actions: OrchestratorAction[] = []

  // Find and extract all ```action blocks
  const actionBlockRegex = /```action\s*\n?([\s\S]*?)```/g
  let match

  while ((match = actionBlockRegex.exec(content)) !== null) {
    try {
      const captured = match[1]
      if (!captured) continue
      const parsed = JSON.parse(captured.trim())
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          actions.push({
            ...item,
            label: formatOrchestratorAction(item),
          })
        }
      }
    } catch {
      // Invalid JSON, ignore
    }
  }

  return actions
}

// Format action for display
function formatOrchestratorAction(action: { action: string; title?: string; column?: string; task_id?: string }): string {
  switch (action.action) {
    case 'create_task':
      return `Created "${action.title}"${action.column ? ` in ${action.column}` : ''}`
    case 'update_task':
      return `Updated task${action.title ? `: "${action.title}"` : ''}`
    case 'move_task':
      return `Moved task to ${action.column ?? 'column'}`
    case 'delete_task':
      return `Deleted task`
    default:
      return action.action
  }
}

// Action parser for orchestrator panel - parses ```action blocks
export const orchestratorActionParser = (content: string) => {
  const actionBlockRegex = /```action\s*\n?([\s\S]*?)```/g
  const displayText = content.replace(actionBlockRegex, '').trim()
  const actions = parseOrchestratorActions(content)

  return { displayText, actions }
}
