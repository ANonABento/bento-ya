import { useState } from 'react'

// Keep in sync with mcp-server/src/main.rs handle_tool_call dispatch.
const MCP_TOOLS = [
  'get_workspaces',
  'get_board',
  'get_task',
  'create_task',
  'update_task',
  'move_task',
  'delete_task',
  'approve_task',
  'reject_task',
  'add_dependency',
  'remove_dependency',
  'mark_complete',
  'retry_task',
  'retry_from_start',
  'create_workspace',
  'create_column',
  'configure_triggers',
  'list_scripts',
  'create_script',
  'run_script',
  'list_pipeline_templates',
  'get_pipeline_template',
  'save_pipeline_template',
  'apply_pipeline_template',
  'delete_pipeline_template',
] as const

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

      {/* Available tools — keep MCP_TOOLS in sync with mcp-server/src/main.rs handle_tool_call */}
      <div className="rounded-lg border border-border-default p-4">
        <h4 className="text-sm font-medium text-text-primary mb-2">{MCP_TOOLS.length} Available Tools</h4>
        <div className="grid grid-cols-2 gap-1 text-xs text-text-secondary font-mono">
          {MCP_TOOLS.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
