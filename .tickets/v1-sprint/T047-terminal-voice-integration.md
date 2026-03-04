# T047: Terminal Voice Integration

## Summary

Voice input button in terminal-input.tsx is disabled with "coming in v0.3" but voice is already implemented in the Chef panel. Wire terminal to use existing voice infrastructure.

## Current State

- `src/components/terminal/terminal-input.tsx` line 105-116: disabled mic button
- Voice works in `src/components/panel/panel-input.tsx`
- `src/hooks/use-voice-input.ts` exists and is functional

## Acceptance Criteria

- [ ] Enable mic button in terminal input
- [ ] Use existing `useVoiceInput` hook
- [ ] Show recording state (pulsing indicator)
- [ ] Transcribed text appends to input
- [ ] Remove "coming in v0.3" tooltip

## Complexity

**S** — Mostly wiring existing code
