import { useMemo } from 'react'
import { Tooltip } from '@/components/shared/tooltip'
import { ModelSelector } from '@/components/shared/model-selector'
import { ThinkingSelector } from '@/components/shared/thinking-selector'
import { PermissionSelector } from '@/components/shared/permission-selector'
import { AttachmentButton } from './attachment-button'
import { AttachmentPreview } from './attachment-preview'
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
  draftInsertion,
  deliveryHint,
  submitLabel,
  isProcessing = false,
  disabled = false,
  queueCount = 0,
}: ChatInputProps) {
  const config = useMemo(() => ({ ...DEFAULT_CHAT_INPUT_CONFIG, ...userConfig }), [userConfig])
  const state = useChatInputState({
    config,
    onSend,
    onInputChange,
    onAttachmentError,
    draftInsertion,
    disabled,
  })
  const hasSubmitContent = state.canSend
  const showInlineStop = Boolean(isProcessing && onCancel && !hasSubmitContent)

  return (
    <div
      ref={state.containerRef}
      className={`border-t border-border-default bg-bg ${
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

      <div className="px-3 py-2">
        {(deliveryHint || state.hasSelectors) && (
          <div className="mb-1.5 flex min-h-6 items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {config.showModelSelector && (
                <ModelSelector
                  value={state.model}
                  models={state.models}
                  onChange={state.handleModelChange}
                />
              )}
              {config.showModelSelector && (
                <span className="h-6 rounded border border-border-default/70 px-1.5 py-1 text-[10px] leading-none text-text-secondary/70">
                  {state.currentContextWindow}
                </span>
              )}
              {config.showThinkingSelector && (
                <ThinkingSelector
                  value={state.thinkingLevel}
                  maxLevel={state.maxEffort}
                  onChange={state.setThinkingLevel}
                />
              )}
              {config.showContextToggle && state.supportsExtendedContext && (
                <Tooltip
                  content={state.extendedContext ? 'Extended context enabled' : 'Use extended context for this message'}
                  side="top"
                  delay={300}
                >
                  <button
                    type="button"
                    onClick={state.handleContextToggle}
                    className={`h-6 rounded border px-2 text-[11px] transition-colors ${
                      state.extendedContext
                        ? 'border-accent/30 bg-accent/10 text-accent'
                        : 'border-border-default/70 text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                    }`}
                    style={{ cursor: 'pointer' }}
                  >
                    1M
                  </button>
                </Tooltip>
              )}
              {config.showPermissionSelector && (
                <PermissionSelector
                  value={state.permissionMode}
                  onChange={state.setPermissionMode}
                />
              )}
              {deliveryHint && (
                <span className="min-w-0 truncate text-[11px] text-text-secondary">
                  {deliveryHint}
                </span>
              )}
            </div>
            {queueCount > 0 && (
              <span className="shrink-0 rounded border border-accent/20 px-1.5 py-0.5 text-[10px] text-accent/75">
                {queueCount} queued
              </span>
            )}
          </div>
        )}

        <div className="flex items-end gap-1.5 rounded border border-border-default bg-surface p-1.5 transition-colors focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/20">
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
            className={`min-h-8 flex-1 resize-none border-0 bg-transparent px-1.5 py-1 font-mono text-sm leading-relaxed text-text-primary placeholder:text-text-secondary/45 focus:outline-none disabled:opacity-50 ${
              state.voice.state === 'recording' ? 'italic text-text-secondary' : ''
            }`}
            style={{ maxHeight: '120px' }}
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
                aria-label={
                  state.voice.state === 'recording'
                    ? 'Stop recording'
                    : state.voice.state === 'processing'
                      ? 'Transcribing voice'
                      : state.voice.state === 'error'
                        ? 'Voice input error — retry'
                        : 'Record voice message'
                }
                aria-pressed={state.voice.state === 'recording'}
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border transition-colors ${
                  state.voice.state === 'recording'
                    ? 'border-accent bg-accent/10 text-accent animate-pulse'
                    : state.voice.state === 'processing'
                      ? 'border-accent bg-accent/10 text-accent'
                      : state.voice.state === 'error'
                        ? 'border-yellow-500 bg-yellow-500/10 text-yellow-500'
                      : !state.voice.isAvailable
                          ? 'border-border-default bg-bg text-text-secondary/40'
                          : 'border-border-default bg-bg text-text-primary hover:bg-bg-hover hover:border-border-hover'
                } disabled:opacity-50`}
                style={{
                  cursor: disabled || isProcessing || state.voice.state === 'processing'
                    ? 'not-allowed'
                    : !state.voice.isAvailable
                      ? 'help'
                      : 'pointer',
                }}
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

          <Tooltip content={showInlineStop ? 'Stop agent' : submitLabel ?? (isProcessing ? 'Queue message' : 'Send')} side="top" delay={200}>
            <button
              type="button"
              onClick={showInlineStop ? onCancel : state.handleSubmit}
              disabled={showInlineStop ? disabled : !hasSubmitContent || disabled}
              aria-label={showInlineStop ? 'Stop agent' : (submitLabel ?? (isProcessing ? 'Queue message' : 'Send message'))}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded transition-colors disabled:opacity-50 ${
                showInlineStop
                  ? 'border border-error/40 bg-error/10 text-error shadow-[inset_0_0_0_1px_rgba(239,68,68,0.08)] hover:bg-error/20'
                  : 'bg-accent text-bg hover:bg-accent/90'
              }`}
              style={{ cursor: (!showInlineStop && !hasSubmitContent) || disabled ? 'not-allowed' : 'pointer' }}
            >
              {showInlineStop ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M6.5 5.5A1.5 1.5 0 0 0 5 7v6a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 15 13V7a1.5 1.5 0 0 0-1.5-1.5h-7Z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.155.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
                </svg>
              )}
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
