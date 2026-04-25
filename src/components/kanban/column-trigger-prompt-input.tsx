type TriggerPromptInputProps = {
  prompt: string
  generating: boolean
  genError: string | null
  onPromptChange: (value: string) => void
  onGenerate: () => void
}

export function TriggerPromptInput({
  prompt,
  generating,
  genError,
  onPromptChange,
  onGenerate,
}: TriggerPromptInputProps) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-text-secondary">
        Describe your automation
      </label>
      <textarea
        value={prompt}
        onChange={(e) => { onPromptChange(e.target.value) }}
        placeholder={"e.g. Run claude with /start-task when tasks enter this column.\nAuto-advance to next column when the agent completes."}
        rows={3}
        className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={!prompt.trim() || generating}
          onClick={onGenerate}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-bg transition-opacity disabled:opacity-50"
        >
          {generating ? 'Generating...' : 'Generate Triggers'}
        </button>
        {genError && (
          <span className="text-xs text-error">{genError}</span>
        )}
      </div>
    </div>
  )
}
