import { invoke } from './invoke'

// ─── Files commands ──────────────────────────────────────────────────────────

export type FileEntry = {
  path: string
  name: string
  category: 'context' | 'tickets' | 'notes'
  modifiedAt: number
}

export type AttachmentFile = {
  path: string
  name: string
  bytes: Uint8Array
}

type RawAttachmentFile = Omit<AttachmentFile, 'bytes'> & {
  bytes: number[]
}

export async function scanWorkspaceFiles(workspaceId: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('scan_workspace_files', { workspaceId })
}

export async function readFileContent(workspaceId: string, filePath: string): Promise<string> {
  return invoke<string>('read_file_content', { workspaceId, filePath })
}

export async function createNoteFile(
  workspaceId: string,
  filename: string,
  content: string,
): Promise<FileEntry> {
  return invoke<FileEntry>('create_note_file', { workspaceId, filename, content })
}

export async function pickAttachmentFiles(): Promise<AttachmentFile[]> {
  const files = await invoke<RawAttachmentFile[]>('pick_attachment_files')
  return files.map(file => ({
    ...file,
    bytes: new Uint8Array(file.bytes),
  }))
}
