# T019: Whisper Voice Input

## Summary

Embed whisper.cpp as a Tauri sidecar for local speech-to-text. Available in the chat input bar (orchestrator) and terminal input bar (agent). Press-and-hold hotkey to speak, release to transcribe.

## Acceptance Criteria

- [ ] whisper.cpp binary bundled as Tauri sidecar
- [ ] Audio capture from system microphone via Tauri
- [ ] Voice Activity Detection (VAD) for auto-start/stop
- [ ] Transcription happens locally (no cloud)
- [ ] Transcribed text inserted into active input field
- [ ] Visual waveform indicator when recording
- [ ] Mic button in chat input bar and terminal input bar
- [ ] Configurable hotkey (default: Cmd+Shift+V)
- [ ] Push-to-talk and toggle modes
- [ ] Whisper model downloaded on first use (default: tiny, 39MB)

## Dependencies

- v0.2 complete

## Complexity

**L**
