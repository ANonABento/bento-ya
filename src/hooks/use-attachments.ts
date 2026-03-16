/**
 * useAttachments - Hook for managing file attachments in chat.
 * Handles file selection, validation, preview generation, and removal.
 */

import { useState, useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import type { Attachment, AttachmentError } from '@/types'
import {
  getAttachmentType,
  isFileSupported,
  getMaxSize,
  MAX_ATTACHMENTS,
  SUPPORTED_EXTENSIONS,
} from '@/types'

type UseAttachmentsOptions = {
  maxAttachments?: number
  onError?: (error: AttachmentError) => void
}

type UseAttachmentsReturn = {
  attachments: Attachment[]
  isLoading: boolean
  addFromDialog: () => Promise<void>
  addFromPaste: (items: DataTransferItemList) => Promise<void>
  addFromDrop: (files: FileList) => Promise<void>
  removeAttachment: (id: string) => void
  clearAttachments: () => void
}

/**
 * Generate unique ID using crypto API
 */
function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Get file extension from path or name
 */
function getExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

/**
 * Infer MIME type from extension
 */
function inferMimeType(extension: string): string {
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.js': 'text/javascript',
    '.jsx': 'text/javascript',
    '.ts': 'application/typescript',
    '.tsx': 'application/typescript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.xml': 'application/xml',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.csv': 'text/csv',
    '.py': 'text/x-python',
    '.rb': 'text/x-ruby',
    '.go': 'text/x-go',
    '.rs': 'text/x-rust',
    '.sh': 'text/x-shellscript',
  }
  return mimeMap[extension] || 'text/plain'
}

/**
 * Create image thumbnail as data URL
 */
async function createImageThumbnail(data: Uint8Array, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Create a proper ArrayBuffer copy to avoid SharedArrayBuffer issues
    const buffer = new ArrayBuffer(data.length)
    const view = new Uint8Array(buffer)
    view.set(data)
    const blob = new Blob([buffer], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const img = new Image()

    img.onload = () => {
      // Create thumbnail (max 80x80)
      const maxSize = 80
      const ratio = Math.min(maxSize / img.width, maxSize / img.height)
      const width = Math.round(img.width * ratio)
      const height = Math.round(img.height * ratio)

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('Failed to get canvas context'))
        return
      }

      ctx.drawImage(img, 0, 0, width, height)
      const thumbnail = canvas.toDataURL(mimeType, 0.7)

      URL.revokeObjectURL(url)
      resolve(thumbnail)
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }

    img.src = url
  })
}

/**
 * Convert Uint8Array to base64
 */
function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i++) {
    const byte = data[i]
    if (byte !== undefined) {
      binary += String.fromCharCode(byte)
    }
  }
  return btoa(binary)
}

export function useAttachments(options: UseAttachmentsOptions = {}): UseAttachmentsReturn {
  const { maxAttachments = MAX_ATTACHMENTS, onError } = options

  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isLoading, setIsLoading] = useState(false)

  /**
   * Validate and process a file from Tauri (path-based)
   */
  const processFileFromPath = useCallback(async (path: string): Promise<Attachment | null> => {
    const name = path.split('/').pop() || path
    const extension = getExtension(name)
    const mimeType = inferMimeType(extension)

    // Check if supported
    if (!isFileSupported(mimeType, extension)) {
      onError?.({
        file: name,
        reason: 'type',
        message: `Unsupported file type: ${extension || 'unknown'}`,
      })
      return null
    }

    try {
      // Read file data
      const data = await readFile(path)
      const size = data.length

      // Determine type
      const type = getAttachmentType(mimeType) || 'text'

      // Check size limit
      const maxSize = getMaxSize(type)
      if (size > maxSize) {
        onError?.({
          file: name,
          reason: 'size',
          message: `File too large: ${String(Math.round(size / 1024 / 1024))}MB (max ${String(Math.round(maxSize / 1024 / 1024))}MB)`,
        })
        return null
      }

      // Generate preview for images
      let preview: string | undefined
      if (type === 'image') {
        try {
          preview = await createImageThumbnail(data, mimeType)
        } catch {
          // Preview generation failed, continue without it
        }
      }

      // Convert to base64 for API mode
      const base64 = uint8ArrayToBase64(data)

      return {
        id: generateId(),
        name,
        size,
        type,
        mimeType,
        preview,
        path,
        base64,
      }
    } catch (err) {
      onError?.({
        file: name,
        reason: 'read',
        message: `Failed to read file: ${err instanceof Error ? err.message : 'Unknown error'}`,
      })
      return null
    }
  }, [onError])

  /**
   * Process a File object (from paste/drop)
   */
  const processFileObject = useCallback(async (file: File): Promise<Attachment | null> => {
    const name = file.name
    const extension = getExtension(name)
    const mimeType = file.type || inferMimeType(extension)

    // Check if supported
    if (!isFileSupported(mimeType, extension)) {
      onError?.({
        file: name,
        reason: 'type',
        message: `Unsupported file type: ${extension || mimeType}`,
      })
      return null
    }

    // Determine type
    const type = getAttachmentType(mimeType) || 'text'

    // Check size limit
    const maxSize = getMaxSize(type)
    if (file.size > maxSize) {
      onError?.({
        file: name,
        reason: 'size',
        message: `File too large: ${String(Math.round(file.size / 1024 / 1024))}MB (max ${String(Math.round(maxSize / 1024 / 1024))}MB)`,
      })
      return null
    }

    try {
      // Read file as ArrayBuffer
      const buffer = await file.arrayBuffer()
      const data = new Uint8Array(buffer)

      // Generate preview for images
      let preview: string | undefined
      if (type === 'image') {
        try {
          preview = await createImageThumbnail(data, mimeType)
        } catch {
          // Preview generation failed, continue without it
        }
      }

      // Convert to base64 for API mode
      const base64 = uint8ArrayToBase64(data)

      return {
        id: generateId(),
        name,
        size: file.size,
        type,
        mimeType,
        preview,
        base64,
      }
    } catch (err) {
      onError?.({
        file: name,
        reason: 'read',
        message: `Failed to read file: ${err instanceof Error ? err.message : 'Unknown error'}`,
      })
      return null
    }
  }, [onError])

  /**
   * Open file dialog and add selected files
   */
  const addFromDialog = useCallback(async () => {
    if (attachments.length >= maxAttachments) {
      onError?.({
        file: '',
        reason: 'size',
        message: `Maximum ${String(maxAttachments)} attachments allowed`,
      })
      return
    }

    try {
      setIsLoading(true)

      const selected = await open({
        multiple: true,
        filters: [
          {
            name: 'Supported Files',
            extensions: SUPPORTED_EXTENSIONS.map(e => e.slice(1)), // Remove leading dot
          },
        ],
      })

      if (!selected) return

      const paths = Array.isArray(selected) ? selected : [selected]
      const remaining = maxAttachments - attachments.length
      const toProcess = paths.slice(0, remaining)

      const newAttachments: Attachment[] = []
      for (const path of toProcess) {
        const attachment = await processFileFromPath(path)
        if (attachment) {
          newAttachments.push(attachment)
        }
      }

      if (newAttachments.length > 0) {
        setAttachments(prev => [...prev, ...newAttachments])
      }
    } finally {
      setIsLoading(false)
    }
  }, [attachments.length, maxAttachments, onError, processFileFromPath])

  /**
   * Handle paste event (images only)
   */
  const addFromPaste = useCallback(async (items: DataTransferItemList) => {
    if (attachments.length >= maxAttachments) return

    const imageItems: DataTransferItem[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item && item.type.startsWith('image/')) {
        imageItems.push(item)
      }
    }

    if (imageItems.length === 0) return

    setIsLoading(true)
    try {
      const remaining = maxAttachments - attachments.length
      const toProcess = imageItems.slice(0, remaining)

      const newAttachments: Attachment[] = []
      for (const item of toProcess) {
        const file = item.getAsFile()
        if (file) {
          const attachment = await processFileObject(file)
          if (attachment) {
            newAttachments.push(attachment)
          }
        }
      }

      if (newAttachments.length > 0) {
        setAttachments(prev => [...prev, ...newAttachments])
      }
    } finally {
      setIsLoading(false)
    }
  }, [attachments.length, maxAttachments, processFileObject])

  /**
   * Handle file drop
   */
  const addFromDrop = useCallback(async (files: FileList) => {
    if (attachments.length >= maxAttachments) return

    setIsLoading(true)
    try {
      const remaining = maxAttachments - attachments.length
      const toProcess = Array.from(files).slice(0, remaining)

      const newAttachments: Attachment[] = []
      for (const file of toProcess) {
        const attachment = await processFileObject(file)
        if (attachment) {
          newAttachments.push(attachment)
        }
      }

      if (newAttachments.length > 0) {
        setAttachments(prev => [...prev, ...newAttachments])
      }
    } finally {
      setIsLoading(false)
    }
  }, [attachments.length, maxAttachments, processFileObject])

  /**
   * Remove an attachment by ID
   */
  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id))
  }, [])

  /**
   * Clear all attachments
   */
  const clearAttachments = useCallback(() => {
    setAttachments([])
  }, [])

  return {
    attachments,
    isLoading,
    addFromDialog,
    addFromPaste,
    addFromDrop,
    removeAttachment,
    clearAttachments,
  }
}
