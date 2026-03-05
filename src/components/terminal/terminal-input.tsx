import { useState, useRef, useCallback, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import { ModeSelector } from './mode-selector'
import { ModelSelector } from './model-selector'
import { ThinkingSelector } from './thinking-selector'
import { useSettingsStore } from '@/stores/settings-store'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { Tooltip } from '@/components/shared/tooltip'

interface Attachment {
  id: string
  name: string
  type: 'image' | 'text'
  mimeType: string
  data: string // base64 for images, text content for text files
  size: number
}

interface TerminalInputProps {
  taskId: string
  agentStatus: 'idle' | 'running' | 'stopped' | 'failed'
  onStop?: () => void
  onForceStop?: () => void
  autoFocus?: boolean
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']
const TEXT_EXTENSIONS = ['.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', '.css', '.html', '.py', '.rs', '.go', '.yaml', '.yml', '.toml', '.xml', '.csv']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

function isImageFile(name: string): boolean {
  const lower = name.toLowerCase()
  return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext))
}

function isTextFile(name: string): boolean {
  const lower = name.toLowerCase()
  return TEXT_EXTENSIONS.some(ext => lower.endsWith(ext))
}

function getMimeType(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.md')) return 'text/markdown'
  return 'text/plain'
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function generateId(): string {
  return `attachment-${String(Date.now())}-${Math.random().toString(36).slice(2, 9)}`
}

export function TerminalInput({
  taskId,
  agentStatus,
  onStop,
  onForceStop,
  autoFocus = false,
}: TerminalInputProps) {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [stopping, setStopping] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const terminalSettings = useSettingsStore((s) => s.global.terminal)
  const { maxInputRows, lineHeight } = terminalSettings

  // Voice input - append transcript to current message
  const handleTranscript = useCallback((text: string) => {
    setInput((prev) => {
      const separator = prev.trim() ? ' ' : ''
      return prev + separator + text
    })
    textareaRef.current?.focus()
  }, [])

  const voice = useVoiceInput(handleTranscript)

  // Auto-focus when requested
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [autoFocus])

  // Reset stopping state when agent status changes
  useEffect(() => {
    if (agentStatus !== 'running') {
      setStopping(false)
    }
  }, [agentStatus])

  const addAttachment = useCallback(async (filePath: string) => {
    try {
      const name = filePath.split('/').pop() || filePath
      const isImage = isImageFile(name)
      const isText = isTextFile(name)

      if (!isImage && !isText) {
        console.warn('Unsupported file type:', name)
        return
      }

      const fileData = await readFile(filePath)

      if (fileData.length > MAX_FILE_SIZE) {
        console.warn('File too large:', name)
        return
      }

      let data: string
      if (isImage) {
        // Convert to base64
        const base64 = btoa(
          new Uint8Array(fileData).reduce((d, byte) => d + String.fromCharCode(byte), '')
        )
        data = base64
      } else {
        // Decode as text
        data = new TextDecoder().decode(fileData)
      }

      const attachment: Attachment = {
        id: generateId(),
        name,
        type: isImage ? 'image' : 'text',
        mimeType: getMimeType(name),
        data,
        size: fileData.length,
      }

      setAttachments(prev => [...prev, attachment])
    } catch (err) {
      console.error('Failed to read file:', err)
    }
  }, [])

  const handleAttachClick = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
          { name: 'Text Files', extensions: ['txt', 'md', 'json', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'py', 'rs', 'go', 'yaml', 'yml', 'toml', 'xml', 'csv'] },
        ],
      })

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected]
        for (const path of paths) {
          await addAttachment(path)
        }
      }
    } catch (err) {
      console.error('Failed to open file dialog:', err)
    }
  }, [addAttachment])

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id))
  }, [])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (!blob) continue

        const reader = new FileReader()
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1] ?? ''
          const attachment: Attachment = {
            id: generateId(),
            name: `pasted-image-${String(Date.now())}.png`,
            type: 'image',
            mimeType: item.type,
            data: base64,
            size: blob.size,
          }
          setAttachments(prev => [...prev, attachment])
        }
        reader.readAsDataURL(blob)
        break
      }
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const files = e.dataTransfer.files
    for (const file of files) {
      const isImage = file.type.startsWith('image/')
      const isText = file.type.startsWith('text/') || isTextFile(file.name)

      if (!isImage && !isText) continue
      if (file.size > MAX_FILE_SIZE) continue

      const reader = new FileReader()
      reader.onload = () => {
        let data: string
        if (isImage) {
          data = (reader.result as string).split(',')[1] ?? ''
        } else {
          data = reader.result as string
        }

        const attachment: Attachment = {
          id: generateId(),
          name: file.name,
          type: isImage ? 'image' : 'text',
          mimeType: file.type || getMimeType(file.name),
          data,
          size: file.size,
        }
        setAttachments(prev => [...prev, attachment])
      }

      if (isImage) {
        reader.readAsDataURL(file)
      } else {
        reader.readAsText(file)
      }
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const send = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed && attachments.length === 0) return

    // Build message with attachments
    let message = trimmed

    // For now, include attachment info in the message
    // In a real implementation, this would be handled by the agent API
    if (attachments.length > 0) {
      const attachmentInfo = attachments.map(a => {
        if (a.type === 'image') {
          return `[Image: ${a.name} (${formatFileSize(a.size)})]`
        } else {
          return `[File: ${a.name}]\n\`\`\`\n${a.data.slice(0, 5000)}${a.data.length > 5000 ? '\n... (truncated)' : ''}\n\`\`\``
        }
      }).join('\n\n')

      message = message ? `${message}\n\n${attachmentInfo}` : attachmentInfo
    }

    await invoke('write_to_pty', {
      taskId,
      data: message + '\n',
    })

    setInput('')
    setAttachments([])

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = `${String(lineHeight)}px`
    }
  }, [input, attachments, taskId, lineHeight])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void send()
      }
    },
    [send],
  )

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)

    // Auto-grow textarea
    const el = e.target
    el.style.height = `${String(lineHeight)}px`
    const maxHeight = lineHeight * maxInputRows
    el.style.height = `${String(Math.min(el.scrollHeight, maxHeight))}px`
  }, [lineHeight, maxInputRows])

  const handleStop = useCallback(() => {
    if (stopping) {
      onForceStop?.()
      setStopping(false)
    } else {
      onStop?.()
      setStopping(true)
    }
  }, [stopping, onStop, onForceStop])

  const isRunning = agentStatus === 'running'
  const canSend = input.trim().length > 0 || attachments.length > 0

  return (
    <div
      className="border-t border-border-default bg-bg-secondary px-3 py-2"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Attachment preview */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="group relative flex items-center gap-2 rounded-lg border border-border-default bg-bg-tertiary px-2 py-1"
            >
              {a.type === 'image' ? (
                <img
                  src={`data:${a.mimeType};base64,${a.data}`}
                  alt={a.name}
                  className="h-8 w-8 rounded object-cover"
                />
              ) : (
                <svg className="h-5 w-5 text-text-muted" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                </svg>
              )}
              <div className="flex flex-col">
                <span className="text-xs text-text-primary truncate max-w-[100px]">{a.name}</span>
                <span className="text-[10px] text-text-muted">{formatFileSize(a.size)}</span>
              </div>
              <button
                type="button"
                onClick={() => { removeAttachment(a.id) }}
                className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-error text-white group-hover:flex"
              >
                <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 2l6 6M8 2L2 8" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Selector row */}
      <div className="mb-2 flex items-center gap-1">
        <ModeSelector />
        <ModelSelector />
        <ThinkingSelector />

        <div className="flex-1" />

        {/* Voice input button */}
        <Tooltip
          content={
            voice.state === 'recording'
              ? `Recording (${String(voice.duration)}s) - click to stop`
              : voice.state === 'error'
                ? `Error: ${voice.error || 'Unknown error'}`
                : !voice.isEnabled
                  ? 'Enable voice in Settings → Voice'
                  : !voice.isApiAvailable
                    ? 'Download a model in Settings → Voice'
                    : 'Click to record voice'
          }
          side="top"
          delay={100}
        >
          <button
            type="button"
            onClick={() => {
              if (voice.state === 'recording') {
                void voice.stopRecording()
              } else if (voice.state === 'idle' && voice.isAvailable) {
                void voice.startRecording()
              } else if (voice.state === 'error') {
                void voice.startRecording()
              }
            }}
            disabled={voice.state === 'processing'}
            className={`rounded p-1 transition-colors ${
              voice.state === 'recording'
                ? 'text-accent animate-pulse'
                : voice.state === 'processing'
                  ? 'text-accent'
                  : voice.state === 'error'
                    ? 'text-yellow-500'
                    : !voice.isAvailable
                      ? 'text-text-muted opacity-30'
                      : 'text-text-muted hover:text-text-primary'
            } disabled:cursor-not-allowed`}
          >
            {voice.state === 'processing' ? (
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                <rect x="5" y="1" width="4" height="7" rx="2" />
                <path d="M3 6.5a4 4 0 008 0M7 10.5V13" />
              </svg>
            )}
          </button>
        </Tooltip>

        {/* Attach button */}
        <Tooltip content="Attach files (images or text)" side="top" delay={100}>
          <button
            type="button"
            onClick={() => { void handleAttachClick() }}
            className="rounded p-1 text-text-muted transition-colors hover:text-text-primary"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M7.5 3.5L4 7a2.12 2.12 0 003 3l4.5-4.5a3 3 0 00-4.24-4.24L2.75 5.75a4.24 4.24 0 006 6L12.25 8" />
            </svg>
          </button>
        </Tooltip>
      </div>

      {/* Input row */}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={voice.state === 'recording' ? voice.liveText : input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={voice.state === 'recording' ? 'Listening...' : voice.state === 'processing' ? 'Transcribing...' : 'Message agent... (Cmd+Enter to send)'}
          rows={1}
          readOnly={voice.state === 'recording'}
          disabled={voice.state === 'processing'}
          className={`flex-1 resize-none rounded border border-border-default bg-bg-primary px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-50 ${voice.state === 'recording' ? 'italic text-text-muted' : ''}`}
          style={{ height: `${String(lineHeight)}px`, lineHeight: `${String(lineHeight)}px` }}
        />

        {isRunning && (
          <button
            type="button"
            onClick={handleStop}
            className={`rounded px-3 py-2 text-xs font-medium ${
              stopping
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-bg-tertiary text-text-secondary hover:bg-red-900/30 hover:text-red-400'
            }`}
          >
            {stopping ? 'Force Stop' : 'Stop'}
          </button>
        )}

        <button
          type="button"
          onClick={() => { void send() }}
          disabled={!canSend}
          className="rounded bg-accent px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-30"
        >
          Send
        </button>
      </div>
    </div>
  )
}
