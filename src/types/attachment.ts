/**
 * Attachment types for chat file attachments.
 */

export type AttachmentType = 'image' | 'document' | 'text'

export type Attachment = {
  /** Unique identifier */
  id: string
  /** Display name */
  name: string
  /** File size in bytes */
  size: number
  /** Attachment category */
  type: AttachmentType
  /** Full MIME type */
  mimeType: string
  /** Data URL for image thumbnails */
  preview?: string
  /** File path for CLI mode */
  path?: string
  /** Base64 encoded content for API mode */
  base64?: string
}

export type AttachmentError = {
  file: string
  reason: 'size' | 'type' | 'read'
  message: string
}

// Supported file types
export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const SUPPORTED_DOCUMENT_TYPES = ['application/pdf']
export const SUPPORTED_TEXT_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/css',
  'text/javascript',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
]

export const SUPPORTED_EXTENSIONS = [
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  // Documents
  '.pdf',
  // Text/Code
  '.txt', '.md', '.csv', '.html', '.css', '.js', '.jsx', '.ts', '.tsx',
  '.json', '.xml', '.yaml', '.yml', '.toml', '.env', '.sh', '.bash',
  '.py', '.rb', '.go', '.rs', '.c', '.cpp', '.h', '.hpp', '.java',
  '.swift', '.kt', '.scala', '.sql', '.graphql', '.prisma',
]

// Size limits
export const MAX_IMAGE_SIZE = 30 * 1024 * 1024 // 30 MB
export const MAX_DOCUMENT_SIZE = 500 * 1024 * 1024 // 500 MB
export const MAX_ATTACHMENTS = 10

/**
 * Get attachment type from MIME type
 */
export function getAttachmentType(mimeType: string): AttachmentType | null {
  if (SUPPORTED_IMAGE_TYPES.includes(mimeType)) return 'image'
  if (SUPPORTED_DOCUMENT_TYPES.includes(mimeType)) return 'document'
  if (SUPPORTED_TEXT_TYPES.includes(mimeType) || mimeType.startsWith('text/')) return 'text'
  return null
}

/**
 * Check if file type is supported
 */
export function isFileSupported(mimeType: string, extension: string): boolean {
  const type = getAttachmentType(mimeType)
  if (type) return true
  // Fallback to extension check for code files
  return SUPPORTED_EXTENSIONS.includes(extension.toLowerCase())
}

/**
 * Get max file size for attachment type
 */
export function getMaxSize(type: AttachmentType): number {
  return type === 'image' ? MAX_IMAGE_SIZE : MAX_DOCUMENT_SIZE
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes.toString()} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Build CLI prompt with attachment references.
 * For CLI mode, attachments with paths are prepended as @path references.
 * Pasted images without paths are not supported in CLI mode.
 */
export function buildPromptWithAttachments(
  content: string,
  attachments?: Attachment[]
): string {
  if (!attachments || attachments.length === 0) {
    return content
  }

  // Get attachments with file paths (from file picker)
  const pathAttachments = attachments.filter((a) => a.path)

  if (pathAttachments.length === 0) {
    return content
  }

  // Build prompt with @path references
  const pathRefs = pathAttachments.map((a) => `@${a.path ?? ''}`).join(' ')
  return `${pathRefs} ${content}`
}
