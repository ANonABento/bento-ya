import type { CliType, SpawnCliAction } from '@/types'
import { CLI_TYPES, COMMON_COMMANDS } from './column-config-constants'

type SpawnCliActionEditorProps = {
  action: SpawnCliAction
  setAction: (value: SpawnCliAction) => void
}

export function SpawnCliActionEditor({
  action,
  setAction,
}: SpawnCliActionEditorProps) {
  return (
    <div className="space-y-3 rounded-lg border border-border-default bg-bg/50 p-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            CLI
          </label>
          <select
            value={action.cli || 'claude'}
            onChange={(e) => { setAction({ ...action, cli: e.target.value as CliType }) }}
            className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            {CLI_TYPES.map((cli) => (
              <option key={cli.value} value={cli.value}>
                {cli.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            Command
          </label>
          <div className="relative">
            <input
              type="text"
              value={action.command || ''}
              onChange={(e) => { setAction({ ...action, command: e.target.value }) }}
              placeholder="/start-task"
              className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
              list="common-commands"
            />
            <datalist id="common-commands">
              {COMMON_COMMANDS.map((command) => (
                <option key={command} value={command} />
              ))}
            </datalist>
          </div>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">
          Prompt Template
        </label>
        <textarea
          value={action.prompt_template || ''}
          onChange={(e) => { setAction({ ...action, prompt_template: e.target.value }) }}
          placeholder="{task.title}&#10;&#10;{task.description}&#10;&#10;{task.trigger_prompt}"
          rows={4}
          className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
        />
        <p className="mt-1 text-xs text-text-secondary">
          Variables: {'{task.title}'}, {'{task.description}'}, {'{task.trigger_prompt}'}, {'{column.name}'}, {'{workspace.path}'}
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={action.use_queue !== false}
          onChange={(e) => { setAction({ ...action, use_queue: e.target.checked }) }}
          className="h-4 w-4 rounded border-border-default accent-accent"
        />
        Use agent queue (max 5 concurrent)
      </label>
    </div>
  )
}
