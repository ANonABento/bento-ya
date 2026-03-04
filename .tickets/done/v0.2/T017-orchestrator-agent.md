# T017: Orchestrator Agent

## Summary

Add the orchestrator: a dedicated agent instance per workspace that interprets natural language input and creates/manages tasks on the board. "Fix the login bug and add tests" → creates 2 tasks automatically.

## Acceptance Criteria

- [ ] Chat input bar at bottom of board view sends to orchestrator
- [ ] Orchestrator runs as a persistent agent session (not per-task)
- [ ] Orchestrator creates tasks via structured output (title, description, suggested column)
- [ ] Orchestrator can update/split/merge existing tasks based on conversation
- [ ] Chat history persisted (ChatMessage table)
- [ ] Orchestrator context includes: current board state, column definitions, active tasks
- [ ] Manual task creation still available (bypass orchestrator)

## Dependencies

- T016 (pipeline engine — orchestrator creates tasks that enter the pipeline)

## Complexity

**L**
