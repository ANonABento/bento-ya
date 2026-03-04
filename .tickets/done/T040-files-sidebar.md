# T040: Files Sidebar (Chef Panel)

## Summary

The Chef panel has a "Files" tab that currently shows "Coming soon". Implement file browsing to show markdown files, plans, and notes from the workspace.

## Current State

From `src/components/panel/panel-sidebar.tsx`:
```tsx
function FilesContent() {
  return (
    <div className="p-4 text-center text-muted-foreground">
      <p>Coming soon</p>
      <p className="text-xs mt-2">Browse workspace files, plans, and notes</p>
    </div>
  );
}
```

## Acceptance Criteria

- [ ] Scan workspace directory for relevant files:
  - [ ] `*.md` files (markdown docs, plans, notes)
  - [ ] `.context/**/*.md` (context files)
  - [ ] `.tickets/**/*.md` (ticket specs)
  - [ ] `README.md`, `CLAUDE.md` (root docs)
- [ ] Display as collapsible tree:
  ```
  📁 Plans
    📄 ARCHITECTURE.md
    📄 roadmap.md
  📁 Tickets
    📄 T042-agent-trigger.md
  📁 Notes
    📄 meeting-notes.md
  📄 README.md
  ```
- [ ] Click file → show preview in Chef panel main area
- [ ] Preview supports markdown rendering (use existing markdown renderer)
- [ ] "New Note" button → create `.context/notes/YYYY-MM-DD-HH-MM.md`
- [ ] Search/filter files by name
- [ ] Show file modified time

## Technical Implementation

### Backend (Rust)

```rust
// src-tauri/src/commands/files.rs

#[derive(Serialize)]
pub struct FileInfo {
    path: String,
    name: String,
    category: String,  // "plans", "tickets", "notes", "docs"
    modified_at: String,
}

#[tauri::command]
pub async fn list_workspace_files(workspace_id: i64) -> Result<Vec<FileInfo>, String> {
    let workspace = get_workspace(workspace_id)?;
    let root = PathBuf::from(&workspace.path);

    let mut files = Vec::new();

    // Scan patterns
    let patterns = [
        ("docs", "*.md"),
        ("context", ".context/**/*.md"),
        ("tickets", ".tickets/**/*.md"),
        ("plans", "plans/**/*.md"),
    ];

    for (category, pattern) in patterns {
        for entry in glob(&root.join(pattern))? {
            files.push(FileInfo {
                path: entry.strip_prefix(&root).to_string(),
                name: entry.file_name(),
                category: category.to_string(),
                modified_at: entry.metadata()?.modified()?,
            });
        }
    }

    Ok(files)
}

#[tauri::command]
pub async fn read_workspace_file(workspace_id: i64, path: String) -> Result<String, String> {
    let workspace = get_workspace(workspace_id)?;
    let full_path = PathBuf::from(&workspace.path).join(&path);

    // Security: ensure path is within workspace
    if !full_path.starts_with(&workspace.path) {
        return Err("Invalid path".to_string());
    }

    std::fs::read_to_string(full_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_workspace_file(workspace_id: i64, path: String, content: String) -> Result<(), String> {
    // Similar security check, then write
}
```

### Frontend

```tsx
// src/components/panel/files-content.tsx

export function FilesContent() {
  const { activeWorkspaceId } = useWorkspaceStore();
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (activeWorkspaceId) {
      ipc.listWorkspaceFiles(activeWorkspaceId).then(setFiles);
    }
  }, [activeWorkspaceId]);

  const grouped = useMemo(() =>
    groupBy(files.filter(f => f.name.includes(filter)), 'category'),
    [files, filter]
  );

  const handleSelect = async (path: string) => {
    setSelectedFile(path);
    const content = await ipc.readWorkspaceFile(activeWorkspaceId!, path);
    setContent(content);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b">
        <Input placeholder="Filter files..." value={filter} onChange={...} />
      </div>
      <div className="flex-1 overflow-auto">
        {Object.entries(grouped).map(([category, files]) => (
          <FileCategory key={category} name={category} files={files} onSelect={handleSelect} />
        ))}
      </div>
      <Button onClick={handleNewNote}>+ New Note</Button>
    </div>
  );
}
```

## Files to Create/Modify

| File | Changes |
|------|---------|
| `src-tauri/src/commands/files.rs` | NEW - File listing/reading commands |
| `src-tauri/src/commands/mod.rs` | Export files module |
| `src-tauri/src/main.rs` | Register commands |
| `src/lib/ipc.ts` | Add file IPC wrappers |
| `src/components/panel/files-content.tsx` | NEW - Files UI component |
| `src/components/panel/panel-sidebar.tsx` | Import FilesContent |

## Complexity

**M** - File system scanning, tree UI, markdown preview

## Test Plan

1. Open Chef panel, click "Files" tab
2. Verify: Shows tree of markdown files from workspace
3. Click a file → verify preview appears
4. Click "New Note" → verify file created
5. Type in filter → verify list filters
