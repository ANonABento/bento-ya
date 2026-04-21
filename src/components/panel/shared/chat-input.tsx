import { useMemo } from 'react'
import { Tooltip } from '@/components/shared/tooltip'
import { AttachmentButton } from './attachment-button'
import { AttachmentPreview } from './attachment-preview'
import { ChatInputSettingsRow } from './chat-input-settings-row'
import {
  DEFAULT_CHAT_INPUT_CONFIG,
  type ChatInputConfig,
  type ChatInputMessage,
  type ChatInputProps,
  type ModelId,
  type ModelSelection,
} from './chat-input-types'
import { useChatInputState } from './use-chat-input-state'

export type { ModelId, ModelSelection, ChatInputConfig, ChatInputMessage }

export function ChatInput({
  config: userConfig,
  onSend,
  onCancel,
  onInputChange,
  onAttachmentError,
  isProcessing = false,
  disabled = false,
  queueCount = 0,
  messageCount = 0,
}: ChatInputProps) {
  const config = useMemo(() => ({ ...DEFAULT_CHAT_INPUT_CONFIG, ...userConfig }), [userConfig])
  const state = useChatInputState({
    config,
    onSend,
    onInputChange,
    onAttachmentError,
    disabled,
    messageCount,
  })

  return (
    <div
      ref={state.containerRef}
      className={`border-t border-border-default bg-surface ${
        state.isDragOver ? 'ring-2 ring-accent ring-inset' : ''
      }`}
      onDragOver={state.handleDragOver}
      onDragLeave={state.handleDragLeave}
      onDrop={state.handleDrop}
    >
      {config.showAttachments && (
        <AttachmentPreview
          attachments={state.attachments.attachments}
          onRemove={state.attachments.removeAttachment}
          disabled={disabled}
        />
      )}

      <div className="p-3">
        {state.hasSelectors && state.settingsOpen && (
          <ChatInputSettingsRow
            config={config}
            model={state.model}
            models={state.models}
            extendedContext={state.extendedContext}
            supportsExtendedContext={state.supportsExtendedContext}
            thinkingLevel={state.thinkingLevel}
            maxEffort={state.maxEffort}
            permissionMode={state.permissionMode}
            onModelChange={state.handleModelChange}
            onContextToggle={state.handleContextToggle}
            onThinkingChange={state.setThinkingLevel}
            onPermissionChange={state.setPermissionMode}
          />
        )}

        <div className="flex items-end gap-2">
          {state.hasSelectors && (
            <Tooltip
              content={state.settingsOpen ? 'Hide settings' : 'Show settings'}
              side="top"
              delay={300}
            >
              <button
                type="button"
                onClick={state.handleSettingsToggle}
                className={`flex h-[38px] shrink-0 items-center gap-1 rounded-lg border px-2 text-xs transition-colors ${
                  state.settingsOpen
                    ? 'border-accent/30 bg-accent/5 text-accent'
                    : 'border-border-default bg-bg text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                }`}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  className={`transition-transform ${state.settingsOpen ? 'rotate-180' : ''}`}
                >
                  <path d="M2.5 6L5 3.5L7.5 6" stroke="currentColor" strokeWidth="1.2" />
                </svg>
                {!state.settingsOpen && (
                  <span className="text-[10px] font-medium">{state.currentModelName}</span>
                )}
              </button>
            </Tooltip>
          )}

          {config.showAttachments && (
            <AttachmentButton
              onClick={() => { void state.attachments.addFromDialog() }}
              disabled={disabled}
              isLoading={state.attachments.isLoading}
              count={state.attachments.attachments.length}
            />
          )}

          <textarea
            ref={state.inputRef}
            value={state.voice.state === 'recording' ? state.voice.liveText : state.message}
            onChange={state.handleChange}
            onKeyDown={state.handleKeyDown}
            onPaste={state.handlePaste}
            placeholder={
              state.isDragOver
                ? 'Drop files here...'
                : state.voice.state === 'recording'
                  ? 'Listening...'
                  : state.voice.state === 'processing'
                    ? 'Transcribing...'
                    : config.placeholder
            }
            rows={config.rows}
            readOnly={state.voice.state === 'recording'}
            disabled={disabled || state.voice.state === 'processing'}
            className={`flex-1 resize-none rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50 ${
              state.voice.state === 'recording' ? 'italic text-text-secondary' : ''
            } ${state.isDragOver ? 'border-accent' : ''}`}
            style={{ minHeight: '38px', maxHeight: '120px' }}
          />

          {state.showVoice && (
            <Tooltip
              content={
                state.voice.state === 'recording'
                  ? `Recording (${String(state.voice.duration)}s) - click to stop`
                  : state.voice.state === 'error'
                    ? `Error: ${state.voice.error || 'Unknown error'}`
                    : !state.voice.isEnabled
                      ? 'Enable voice in Settings'
                      : !state.voice.isApiAvailable
                        ? 'Download a model in Settings'
                        : 'Click to record voice'
              }
              side="top"
              delay={100}
            >
              <button
                type="button"
                onClick={() => {
                  if (state.voice.state === 'recording') {
                    void state.voice.stopRecording()
                  } else if (state.voice.state === 'idle' && state.voice.isAvailable) {
                    void state.voice.startRecording()
                  } else if (state.voice.state === 'error') {
                    void state.voice.startRecording()
                  }
                }}
                disabled={disabled || isProcessing || state.voice.state === 'processing'}
                className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border transition-colors ${
                  state.voice.state === 'recording'
                    ? 'border-accent bg-accent/10 text-accent animate-pulse'
                    : state.voice.state === 'processing'
                      ? 'border-accent bg-accent/10 text-accent'
                      : state.voice.state === 'error'
                        ? 'border-yellow-500 bg-yellow-500/10 text-yellow-500'
                        : !state.voice.isAvailable
                          ? 'border-border-default bg-bg text-text-secondary/40 cursor-help'
                          : 'border-border-default bg-bg text-text-primary hover:bg-bg-hover hover:border-border-hover'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {state.voice.state === 'processing' ? (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                    <path d="M8 1a2 2 0 0 0-2 2v4a2 2 0 1 0 4 0V3a2 2 0 0 0-2-2Z" />
                    <path d="M4.5 7A.75.75 0 0 0 3 7a5 5 0 0 0 4.25 4.944V13.5h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.556A5 5 0 0 0 13 7a.75.75 0 0 0-1.5 0 3.5 3.5 0 1 1-7 0Z" />
                  </svg>
                )}
              </button>
            </Tooltip>
          )}

          {isProcessing && onCancel && (
            <Tooltip content={queueCount > 0 ? `Cancel (${String(queueCount)} queued)` : 'Cancel'} side="top" delay={200}>
              <button
                type="button"
                onClick={onCancel}
                className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 text-red-500 transition-colors hover:bg-red-500/20"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm2.78-4.22a.75.75 0 0 1-1.06 0L8 9.06l-1.72 1.72a.75.75 0 1 1-1.06-1.06L6.94 8 5.22 6.28a.75.75 0 0 1 1.06-1.06L8 6.94l1.72-1.72a.75.75 0 1 1 1.06 1.06L9.06 8l1.72 1.72a.75.75 0 0 1 0 1.06Z" clipRule="evenodd" />
                </svg>
              </button>
            </Tooltip>
          )}

          <Tooltip content={isProcessing ? 'Queue message' : 'Send'} side="top" delay={200}>
            <button
              type="button"
              onClick={state.handleSubmit}
              disabled={!state.canSend || disabled}
              className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-accent text-bg transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.155.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
