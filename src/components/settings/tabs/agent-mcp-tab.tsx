import { useState } from 'react'
import { AgentTab } from './agent-tab'

export function AgentMcpTab() {
  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493a1.23 1.23 0 0 0 .41 1.412A9.957 9.957 0 0 0 10 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 0 0-13.074.003Z" />
          </svg>
          Agent Configuration
        </h3>
        <AgentTab />
      </section>

      <div className="border-t border-border-default" />

      <section>
        <h3 className="text-sm font-medium text-text-primary mb-4 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M12.232 4.232a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224a4 4 0 0 0-5.656-5.656l-3 3a4 4 0 0 0 .225 5.865.75.75 0 0 0 .977-1.138 2.5 2.5 0 0 1-.142-3.667l3-3Z" />
            <path d="M11.603 7.963a.75.75 0 0 0-.977 1.138 2.5 2.5 0 0 1 .142 3.667l-3 3a2.5 2.5 0 0 1-3.536-3.536l1.225-1.224a.75.75 0 0 0-1.061-1.06l-1.224 1.224a4 4 0 1 0 5.656 5.656l3-3a4 4 0 0 0-.225-5.865Z" />
          </svg>
          Connect Agents (MCP)
        </h3>
        <McpSection />
      </section>
    </div>
  )
}

function McpSection() {
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
          <li>Add the MCP config above to your agent's settings</li>
          <li>Your agent can now create tasks, move cards, approve reviews, and more</li>
        </ol>
      </div>

      {/* Available tools */}
      <div className="rounded-lg border border-border-default p-4">
        <h4 className="text-sm font-medium text-text-primary mb-2">12 Available Tools</h4>
        <div className="grid grid-cols-2 gap-1 text-xs text-text-secondary">
          <span>get_workspaces</span>
          <span>get_board</span>
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
        </div>
      </div>
    </div>
  )
}
