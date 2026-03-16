/**
 * AttachmentPreview - Displays attached files with thumbnails and remove buttons.
 */

import type { Attachment } from '@/types'
import { formatFileSize } from '@/types'

type AttachmentPreviewProps = {
  attachments: Attachment[]
  onRemove: (id: string) => void
  disabled?: boolean
}

export function AttachmentPreview({
  attachments,
  onRemove,
  disabled = false,
}: AttachmentPreviewProps) {
  if (attachments.length === 0) return null

  return (
    <div className="flex gap-2 overflow-x-auto px-3 py-2 border-b border-border-default bg-bg/50">
      {attachments.map((attachment) => (
        <AttachmentItem
          key={attachment.id}
          attachment={attachment}
          onRemove={() => { onRemove(attachment.id) }}
          disabled={disabled}
        />
      ))}
    </div>
  )
}

type AttachmentItemProps = {
  attachment: Attachment
  onRemove: () => void
  disabled?: boolean
}

function AttachmentItem({ attachment, onRemove, disabled }: AttachmentItemProps) {
  const isImage = attachment.type === 'image'

  return (
    <div className="relative group shrink-0">
      <div className={`flex items-center gap-2 rounded-lg border border-border-default bg-surface px-2 py-1.5 ${
        isImage ? 'pr-2' : 'pr-6'
      }`}>
        {/* Thumbnail or icon */}
        {isImage && attachment.preview ? (
          <img
            src={attachment.preview}
            alt={attachment.name}
            className="h-10 w-10 rounded object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded bg-surface-hover">
            <FileIcon type={attachment.type} />
          </div>
        )}

        {/* File info */}
        <div className="flex flex-col min-w-0">
          <span className="text-xs text-text-primary truncate max-w-[100px]">
            {attachment.name}
          </span>
          <span className="text-[10px] text-text-muted">
            {formatFileSize(attachment.size)}
          </span>
        </div>
      </div>

      {/* Remove button */}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-surface-hover border border-border-default text-text-secondary hover:bg-red-500/20 hover:text-red-500 hover:border-red-500/30 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M1 1l6 6M7 1L1 7" />
        </svg>
      </button>
    </div>
  )
}

function FileIcon({ type }: { type: Attachment['type'] }) {
  if (type === 'document') {
    // PDF icon
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-red-400">
        <path d="M4 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.414A1 1 0 0 0 12.707 4L10 1.293A1 1 0 0 0 9.414 1H4zm5 2.414L11.586 6H9V3.414zM4.5 9a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2a.5.5 0 0 1 .5-.5zm2 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2a.5.5 0 0 1 .5-.5zm2 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2a.5.5 0 0 1 .5-.5z" />
      </svg>
    )
  }

  // Text/code file icon
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-text-secondary">
      <path d="M4 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.414A1 1 0 0 0 12.707 4L10 1.293A1 1 0 0 0 9.414 1H4zm5 2.414L11.586 6H9V3.414zM4.5 8a.5.5 0 0 0 0 1h7a.5.5 0 0 0 0-1h-7zm0 2a.5.5 0 0 0 0 1h7a.5.5 0 0 0 0-1h-7zm0 2a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1h-4z" />
    </svg>
  )
}
