import { useState } from 'react'

export function McpTab() {
  const [copied, setCopied] = useState(false)

  const mcpConfig = JSON.stringify({
    "mcpServers": {
      "bento-ya": {
        "command": "bento-mcp",
        "args": []
      }
    }
  }, null, 2)

  const handleCopy = () => {
    void navigator.clipboard.writeText(mcpConfig).then(() => {
      setCopied(true)
      setTimeout(() => { setCopied(false) }, 2000)
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        Connect any MCP-compatible agent (Claude Code, Cursor, Choomfie, etc.) to manage your board externally.
      </p>

      {/* MCP Config */}
      <div className="rounded-lg border border-border-default bg-bg p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">MCP Configuration</span>
          <button
            onClick={handleCopy}
            className="rounded px-2 py-1 text-xs font-medium text-accent bg-accent/10 hover:bg-accent/20 transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <pre className="text-xs text-text-primary font-mono whitespace-pre overflow-x-auto">
          {mcpConfig}
        </pre>
      </div>

      {/* Install instructions */}
      <div className="rounded-lg border border-border-default p-4 space-y-2">
        <h4 className="text-sm font-medium text-text-primary">Setup</h4>
        <ol className="text-sm text-text-secondary space-y-1.5 list-decimal list-inside">
          <li>Install: <code className="rounded bg-surface-hover px-1.5 py-0.5 text-xs font-mono">cargo install --path mcp-server</code></li>
          <li>Add the MCP config above to your agent&apos;s settings</li>
          <li>Your agent can now create tasks, move cards, approve reviews, and more</li>
        </ol>
      </div>

      {/* Available tools */}
      <div className="rounded-lg border border-border-default p-4">
        <h4 className="text-sm font-medium text-text-primary mb-2">19 Available Tools</h4>
        <div className="grid grid-cols-2 gap-1 text-xs text-text-secondary font-mono">
          <span>get_workspaces</span>
          <span>get_board</span>
          <span>get_task</span>
          <span>create_task</span>
          <span>update_task</span>
          <span>move_task</span>
          <span>delete_task</span>
          <span>approve_task</span>
          <span>reject_task</span>
          <span>add_dependency</span>
          <span>remove_dependency</span>
          <span>mark_complete</span>
          <span>retry_task</span>
          <span>create_workspace</span>
          <span>create_column</span>
          <span>configure_triggers</span>
          <span>list_scripts</span>
          <span>create_script</span>
          <span>run_script</span>
        </div>
      </div>
    </div>
  )
}
