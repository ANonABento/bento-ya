import { useState } from 'react'
import type { ExitCriteria, TriggerAction } from '@/types'
import { useColumnStore } from '@/stores/column-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useSettingsStore } from '@/stores/settings-store'
import { parseColumnTriggers } from '@/types/column'
import * as ipc from '@/lib/ipc'

type UseColumnTriggerGenerationArgs = {
  columnName: string
  setOnEntry: (value: TriggerAction) => void
  setOnExit: (value: TriggerAction) => void
  setExitCriteria: (value: ExitCriteria) => void
}

export function useColumnTriggerGeneration({
  columnName,
  setOnEntry,
  setOnExit,
  setExitCriteria,
}: UseColumnTriggerGenerationArgs) {
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const settings = useSettingsStore((s) => s.global)
  const anthropicProvider = settings.model.providers.find((p) => p.id === 'anthropic')
  const refreshColumns = useColumnStore((s) => s.load)

  const reloadTriggers = async (workspaceId: string) => {
    try {
      const columns = await ipc.getColumns(workspaceId)
      const updated = columns.find((c) => c.name === columnName)
      const parsed = updated ? parseColumnTriggers(updated.triggers) : null

      if (parsed) {
        if (parsed.on_entry) setOnEntry(parsed.on_entry)
        if (parsed.on_exit) setOnExit(parsed.on_exit)
        if (parsed.exit_criteria) setExitCriteria(parsed.exit_criteria)
      }

      void refreshColumns(workspaceId)
    } catch {
      // Non-critical — the manual editor still works even if refresh misses.
    }
  }

  const generate = async () => {
    if (!prompt.trim() || generating || !activeWorkspaceId) return

    setGenerating(true)
    setGenError(null)

    try {
      const session = await ipc.getActiveChatSession(activeWorkspaceId)
      const message = `Configure triggers for column "${columnName}": ${prompt.trim()}`
      const connectionMode = anthropicProvider?.connectionMode ?? 'cli'
      const apiKeyEnvVar = anthropicProvider?.apiKeyEnvVar || 'ANTHROPIC_API_KEY'
      const apiKey = connectionMode === 'api'
        ? (settings.agent.envVars[apiKeyEnvVar] || undefined)
        : undefined
      const cliPath = anthropicProvider?.cliPath || 'claude'

      await ipc.streamOrchestratorChat(
        activeWorkspaceId,
        session.id,
        message,
        connectionMode,
        apiKey,
        apiKeyEnvVar,
        'haiku',
        cliPath,
      )

      await reloadTriggers(activeWorkspaceId)
      setShowAdvanced(true)
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }

  return {
    prompt,
    generating,
    genError,
    showAdvanced,
    setPrompt,
    setShowAdvanced,
    generate,
  }
}
