import { invoke } from './invoke'

// ─── Files commands ──────────────────────────────────────────────────────────

export type FileEntry = {
  path: string
  name: string
  category: 'context' | 'tickets' | 'notes'
  modifiedAt: number
}

export async function scanWorkspaceFiles(repoPath: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('scan_workspace_files', { repoPath })
}

export async function readFileContent(filePath: string): Promise<string> {
  return invoke<string>('read_file_content', { filePath })
}

export async function createNoteFile(
  repoPath: string,
  filename: string,
  content: string,
): Promise<FileEntry> {
  return invoke<FileEntry>('create_note_file', { repoPath, filename, content })
}
