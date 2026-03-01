# T033: LLM Integration (Core Agent Backend)

## Summary

Wire up actual LLM API calls so the orchestrator/chat can process messages. Currently the chat stores messages but never sends them to an LLM. This is the foundation for all AI features.

## Current State

- Chat UI exists (`src/components/chat/chat-input.tsx`)
- Messages stored in database (`chat_messages` table)
- Backend command `send_orchestrator_message` sets status to "processing" but never processes
- Comment in code: `// In a real implementation, this would trigger the LLM call`
- **No OpenAI/Anthropic/OpenRouter integration** (only Whisper for voice)

## Acceptance Criteria

- [ ] LLM provider configuration in settings (API key, model selection)
- [ ] Support multiple providers: OpenAI, Anthropic, OpenRouter
- [ ] `process_orchestrator_message` actually calls LLM API
- [ ] Streaming response support (SSE or chunked)
- [ ] Response stored in `chat_messages` with `role: assistant`
- [ ] Error handling: API failures, rate limits, invalid keys
- [ ] Token counting and cost estimation per message
- [ ] Usage record created for each LLM call (feeds T030 metrics)
- [ ] System prompt configurable per workspace
- [ ] Context window management (truncate/summarize old messages)

## Technical Notes

```rust
// src-tauri/src/commands/orchestrator.rs
// Current: stores message, sets "processing", never processes
// Need: async task that calls LLM API and streams response back

// Options:
// 1. reqwest + async-openai crate for OpenAI
// 2. reqwest direct for OpenRouter (more flexible)
// 3. anthropic-rs for Claude
```

## Dependencies

- None (foundational)

## Enables

- T017 Orchestrator becomes functional
- T030 Metrics Dashboard gets data
- T016 Pipeline agent_complete exit criteria
- Future: task generation from chat

## Complexity

**XL** — Core infrastructure, streaming, multiple providers
