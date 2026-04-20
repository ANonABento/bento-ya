import { useEffect, useState } from 'react'
import type { RunScriptAction, Script } from '@/types'
import { parseSteps } from '@/types'
import * as ipc from '@/lib/ipc'
import { STEP_TYPE_COLORS } from './column-config-constants'

type RunScriptActionEditorProps = {
  action: RunScriptAction
  setAction: (value: RunScriptAction) => void
}

export function RunScriptActionEditor({
  action,
  setAction,
}: RunScriptActionEditorProps) {
  const [scripts, setScripts] = useState<Script[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void ipc.listScripts().then((loadedScripts) => {
      setScripts(loadedScripts)
      setLoading(false)
      if (!action.script_id && loadedScripts.length > 0) {
        const first = loadedScripts[0]
        if (first) {
          setAction({ ...action, script_id: first.id })
        }
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedScript = scripts.find((script) => script.id === action.script_id)
  const steps = selectedScript ? parseSteps(selectedScript.steps) : []

  if (loading) {
    return (
      <div className="rounded-lg border border-border-default bg-bg/50 p-3 text-sm text-text-secondary">
        Loading scripts...
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-border-default bg-bg/50 p-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">
          Script
        </label>
        <select
          value={action.script_id}
          onChange={(e) => { setAction({ ...action, script_id: e.target.value }) }}
          className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
        >
          <option value="">Select a script...</option>
          {scripts.filter((script) => script.isBuiltIn).length > 0 && (
            <optgroup label="Built-in">
              {scripts.filter((script) => script.isBuiltIn).map((script) => (
                <option key={script.id} value={script.id}>{script.name}</option>
              ))}
            </optgroup>
          )}
          {scripts.filter((script) => !script.isBuiltIn).length > 0 && (
            <optgroup label="Custom">
              {scripts.filter((script) => !script.isBuiltIn).map((script) => (
                <option key={script.id} value={script.id}>{script.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {selectedScript && (
        <div>
          <p className="mb-2 text-xs text-text-secondary">{selectedScript.description}</p>
          <div className="space-y-1">
            {steps.map((step, index) => (
              <div key={index} className="flex items-center gap-2 text-xs">
                <span className={`rounded px-1.5 py-0.5 font-mono ${
                  STEP_TYPE_COLORS[step.type] || 'bg-surface text-text-secondary'
                }`}>
                  {step.type}
                </span>
                <span className="text-text-secondary">{step.name || (step.type === 'agent' ? 'Agent' : step.command)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
