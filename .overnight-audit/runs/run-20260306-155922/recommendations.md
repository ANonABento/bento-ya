# Recommended remediations

1) Resolve check failures first (P0).
2) Address P1 findings next.
3) Keep fixes scoped and rerun this script on changed paths.

## Suggested actions
- [P0] CHECK_FAIL_lint in CHECK:lint:0 => Check command failed in 4.00 seconds
- [P0] CHECK_FAIL_type-check in CHECK:type-check:0 => Check command failed in 2.00 seconds
- [P2] CONSOLE_STATEMENT in src/components/panel/agent-panel.tsx:      console.error('[AgentPanel]', err) =>       console.error('[AgentPanel]', err)
- [P2] CONSOLE_STATEMENT in src/lib/ipc.ts:      console.error(`[queueAgentBatch] Failed to start agent for ${taskId} => `, err)
