use crate::db::{self, AppState};
use crate::error::AppError;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

/// File entry returned to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub category: String,
    pub modified_at: i64,
}

/// A single entry in a workspace directory listing (for the file browser).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    /// Path relative to the workspace root, forward-slashed.
    pub path: String,
    pub name: String,
    pub is_dir: bool,
}

/// Directories never worth surfacing in the file browser (huge / noisy / VCS).
const IGNORED_DIRS: &[&str] = &[
    ".git",
    ".worktrees",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    ".cache",
    "coverage",
    ".svelte-kit",
    "__pycache__",
];

/// Dialog-selected attachment data returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentFile {
    pub path: String,
    pub name: String,
    pub bytes: Vec<u8>,
}

/// File categories for grouping
const CATEGORY_CONTEXT: &str = "context";
const CATEGORY_TICKETS: &str = "tickets";
const CATEGORY_NOTES: &str = "notes";
const MAX_ATTACHMENT_BYTES: u64 = 500 * 1024 * 1024;
const SUPPORTED_ATTACHMENT_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "md", "csv", "html", "css", "js", "jsx",
    "ts", "tsx", "json", "xml", "yaml", "yml", "toml", "env", "sh", "bash", "py", "rb", "go", "rs",
    "c", "cpp", "h", "hpp", "java", "swift", "kt", "scala", "sql", "graphql", "prisma",
];

fn canonical_workspace_root(repo_path: &str) -> Result<PathBuf, AppError> {
    let root = PathBuf::from(repo_path);
    if !root.exists() {
        return Err(AppError::InvalidInput(format!(
            "Repository path does not exist: {}",
            repo_path
        )));
    }
    if !root.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Repository path is not a directory: {}",
            repo_path
        )));
    }

    root.canonicalize()
        .map_err(|e| AppError::InvalidInput(format!("Failed to resolve repository path: {}", e)))
}

fn canonical_registered_workspace_root(
    conn: &Connection,
    workspace_id: &str,
) -> Result<PathBuf, AppError> {
    let workspace = db::get_workspace(conn, workspace_id)?;
    canonical_workspace_root(&workspace.repo_path)
}

fn state_workspace_root(state: State<AppState>, workspace_id: &str) -> Result<PathBuf, AppError> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    canonical_registered_workspace_root(&conn, workspace_id)
}

fn ensure_relative_workspace_path(file_path: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(file_path);
    if path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
    {
        return Err(AppError::InvalidInput(
            "File path must be relative to the selected workspace".to_string(),
        ));
    }
    Ok(path)
}

fn ensure_path_in_workspace(root: &Path, path: &Path) -> Result<PathBuf, AppError> {
    let canonical_path = path
        .canonicalize()
        .map_err(|e| AppError::InvalidInput(format!("Failed to resolve file path: {}", e)))?;

    if !canonical_path.starts_with(root) {
        return Err(AppError::InvalidInput(
            "File is outside the selected workspace".to_string(),
        ));
    }

    Ok(canonical_path)
}

fn read_file_content_in_root(root: &Path, file_path: &str) -> Result<String, AppError> {
    let relative = ensure_relative_workspace_path(file_path)?;
    let path = root.join(relative);
    if !path.exists() {
        return Err(AppError::InvalidInput(format!(
            "File does not exist: {}",
            file_path
        )));
    }
    if !path.is_file() {
        return Err(AppError::InvalidInput(format!(
            "Path is not a file: {}",
            file_path
        )));
    }

    let path = ensure_path_in_workspace(root, &path)?;

    fs::read_to_string(&path)
        .map_err(|e| AppError::InvalidInput(format!("Failed to read file: {}", e)))
}

fn create_note_file_in_root(
    root: &Path,
    filename: &str,
    content: &str,
) -> Result<FileEntry, AppError> {
    let filename = validate_note_filename(filename)?;
    let file_path = root.join(&filename);

    // Don't overwrite existing files
    if file_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "File already exists: {}",
            filename
        )));
    }

    fs::write(&file_path, content)
        .map_err(|e| AppError::InvalidInput(format!("Failed to create file: {}", e)))?;

    let modified_at = file_path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    Ok(FileEntry {
        path: filename.clone(),
        name: filename,
        category: CATEGORY_NOTES.to_string(),
        modified_at,
    })
}

fn file_entry(root: &Path, path: &Path, category: &str) -> Option<FileEntry> {
    let modified_at = path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let relative = path.strip_prefix(root).ok()?.to_string_lossy().to_string();

    Some(FileEntry {
        path: relative,
        name,
        category: category.to_string(),
        modified_at,
    })
}

fn validate_note_filename(filename: &str) -> Result<String, AppError> {
    let trimmed = filename.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput("Filename is required".to_string()));
    }

    let normalized = if trimmed.ends_with(".md") {
        trimmed.to_string()
    } else {
        format!("{}.md", trimmed)
    };

    let path = Path::new(&normalized);
    if path.is_absolute()
        || path.components().count() != 1
        || normalized == ".md"
        || normalized.contains(std::path::MAIN_SEPARATOR)
        || normalized.contains('/')
        || normalized.contains('\\')
    {
        return Err(AppError::InvalidInput(
            "Filename must be a markdown file name, not a path".to_string(),
        ));
    }

    Ok(normalized)
}

fn validate_attachment_path(path: &Path) -> Result<(), AppError> {
    if !path.exists() {
        return Err(AppError::InvalidInput(format!(
            "File does not exist: {}",
            path.display()
        )));
    }
    if !path.is_file() {
        return Err(AppError::InvalidInput(format!(
            "Path is not a file: {}",
            path.display()
        )));
    }

    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| AppError::InvalidInput("Unsupported file type".to_string()))?;

    if !SUPPORTED_ATTACHMENT_EXTENSIONS.contains(&extension.as_str()) {
        return Err(AppError::InvalidInput(format!(
            "Unsupported file type: .{}",
            extension
        )));
    }

    let size = path
        .metadata()
        .map_err(|e| AppError::InvalidInput(format!("Failed to inspect file: {}", e)))?
        .len();
    if size > MAX_ATTACHMENT_BYTES {
        return Err(AppError::InvalidInput(format!(
            "File is too large: {} bytes",
            size
        )));
    }

    Ok(())
}

fn read_attachment_path(path: &Path) -> Result<AttachmentFile, AppError> {
    validate_attachment_path(path)?;
    let bytes = fs::read(path)
        .map_err(|e| AppError::InvalidInput(format!("Failed to read file: {}", e)))?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());

    Ok(AttachmentFile {
        path: path.to_string_lossy().into_owned(),
        name,
        bytes,
    })
}

/// Recursively scan a directory for markdown files
fn scan_dir_for_md(root: &Path, dir: &Path, files: &mut Vec<FileEntry>, category: &str) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                scan_dir_for_md(root, &path, files, category);
            } else if let Some(ext) = path.extension() {
                if ext == "md" {
                    if let Some(entry) = file_entry(root, &path, category) {
                        files.push(entry);
                    }
                }
            }
        }
    }
}

/// Scan workspace for relevant markdown files
/// Scans: *.md in root, .context/**/*.md, .tickets/**/*.md
#[tauri::command]
pub fn scan_workspace_files(
    state: State<AppState>,
    workspace_id: String,
) -> Result<Vec<FileEntry>, AppError> {
    let root = state_workspace_root(state, &workspace_id)?;

    let mut files: Vec<FileEntry> = Vec::new();

    // Scan root for *.md files (notes category)
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext == "md" {
                        if let Some(entry) = file_entry(&root, &path, CATEGORY_NOTES) {
                            files.push(entry);
                        }
                    }
                }
            }
        }
    }

    // Scan .context directory
    let context_dir = root.join(".context");
    if context_dir.exists() && context_dir.is_dir() {
        scan_dir_for_md(&root, &context_dir, &mut files, CATEGORY_CONTEXT);
    }

    // Scan .tickets directory
    let tickets_dir = root.join(".tickets");
    if tickets_dir.exists() && tickets_dir.is_dir() {
        scan_dir_for_md(&root, &tickets_dir, &mut files, CATEGORY_TICKETS);
    }

    // Sort by modified_at descending (most recent first)
    files.sort_by_key(|f| std::cmp::Reverse(f.modified_at));

    Ok(files)
}

/// Read content of a file
#[tauri::command]
pub fn read_file_content(
    state: State<AppState>,
    workspace_id: String,
    file_path: String,
) -> Result<String, AppError> {
    let root = state_workspace_root(state, &workspace_id)?;
    read_file_content_in_root(&root, &file_path)
}

/// List the immediate children of a directory inside the workspace, for the
/// file browser's lazy tree. `rel_path` empty / None = the repo root. Hidden
/// directories in [`IGNORED_DIRS`] are skipped; everything else (including
/// dotfiles) is returned, dirs first then alphabetical.
fn list_dir_in_root(root: &Path, rel_path: &str) -> Result<Vec<DirEntry>, AppError> {
    let dir = if rel_path.is_empty() {
        root.to_path_buf()
    } else {
        let relative = ensure_relative_workspace_path(rel_path)?;
        ensure_path_in_workspace(root, &root.join(relative))?
    };
    if !dir.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Not a directory: {}",
            rel_path
        )));
    }

    let mut entries: Vec<DirEntry> = Vec::new();
    let read = fs::read_dir(&dir)
        .map_err(|e| AppError::InvalidInput(format!("Failed to read directory: {}", e)))?;
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir && IGNORED_DIRS.contains(&name.as_str()) {
            continue;
        }
        let path = if rel_path.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel_path.trim_end_matches('/'), name)
        };
        entries.push(DirEntry { path, name, is_dir });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_workspace_dir(
    state: State<AppState>,
    workspace_id: String,
    rel_path: Option<String>,
) -> Result<Vec<DirEntry>, AppError> {
    let root = state_workspace_root(state, &workspace_id)?;
    list_dir_in_root(&root, rel_path.as_deref().unwrap_or(""))
}

/// Open a workspace file in an external editor — VS Code if available, else the
/// OS default opener. Path is validated to stay inside the workspace root.
#[tauri::command(rename_all = "camelCase")]
pub fn open_in_editor(
    state: State<AppState>,
    workspace_id: String,
    file_path: String,
) -> Result<(), AppError> {
    let root = state_workspace_root(state, &workspace_id)?;
    let relative = ensure_relative_workspace_path(&file_path)?;
    let abs = ensure_path_in_workspace(&root, &root.join(relative))?;
    let abs = abs.to_string_lossy().to_string();

    fn spawned(cmd: &str, args: &[&str]) -> bool {
        std::process::Command::new(cmd).args(args).spawn().is_ok()
    }

    // Prefer VS Code; fall back to the OS default handler for the file.
    if spawned("code", &["--reuse-window", &abs]) {
        return Ok(());
    }
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    };
    if spawned(opener, &[&abs]) {
        return Ok(());
    }
    Err(AppError::InvalidInput(
        "Couldn't open the file — install the `code` CLI or set a default editor.".to_string(),
    ))
}

/// Open the native file picker and read the selected attachment files.
#[tauri::command]
pub async fn pick_attachment_files(app: AppHandle) -> Result<Vec<AttachmentFile>, AppError> {
    let selected = app
        .dialog()
        .file()
        .add_filter("Supported Files", SUPPORTED_ATTACHMENT_EXTENSIONS)
        .blocking_pick_files();

    let Some(selected) = selected else {
        return Ok(Vec::new());
    };

    selected
        .into_iter()
        .map(|file_path| {
            let path = file_path.into_path().map_err(|e| {
                AppError::InvalidInput(format!("Failed to resolve selected file path: {}", e))
            })?;
            read_attachment_path(&path)
        })
        .collect()
}

/// Create a new markdown note file
#[tauri::command]
pub fn create_note_file(
    state: State<AppState>,
    workspace_id: String,
    filename: String,
    content: String,
) -> Result<FileEntry, AppError> {
    let root = state_workspace_root(state, &workspace_id)?;
    create_note_file_in_root(&root, &filename, &content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_file_content_rejects_paths_outside_workspace() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        fs::create_dir(&repo).unwrap();
        let outside = temp.path().join("outside.md");
        fs::write(&outside, "secret").unwrap();

        let err = read_file_content_in_root(&repo, outside.to_str().unwrap()).unwrap_err();

        assert!(err.to_string().contains("relative"));
    }

    #[test]
    fn create_note_file_rejects_path_traversal_filename() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        fs::create_dir(&repo).unwrap();

        let err = create_note_file_in_root(&repo, "../escape", "content").unwrap_err();

        assert!(err.to_string().contains("not a path"));
        assert!(!temp.path().join("escape.md").exists());
    }

    #[test]
    fn create_note_file_creates_markdown_in_workspace_root() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        fs::create_dir(&repo).unwrap();

        let created = create_note_file_in_root(&repo, "notes", "hello").unwrap();

        assert_eq!(created.name, "notes.md");
        assert_eq!(fs::read_to_string(repo.join("notes.md")).unwrap(), "hello");
    }

    #[test]
    fn list_dir_in_root_skips_ignored_dirs_and_sorts_dirs_first() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        fs::create_dir(&repo).unwrap();
        fs::write(repo.join("README.md"), "x").unwrap();
        fs::create_dir(repo.join("src")).unwrap();
        fs::write(repo.join("src").join("main.rs"), "fn main(){}").unwrap();
        fs::create_dir(repo.join("node_modules")).unwrap();

        let root = repo.canonicalize().unwrap();
        let entries = list_dir_in_root(&root, "").unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        // node_modules skipped; directory sorts before the file.
        assert_eq!(names, vec!["src", "README.md"]);
        assert!(entries[0].is_dir && !entries[1].is_dir);

        // Nested listing builds forward-slashed relative paths.
        let nested = list_dir_in_root(&root, "src").unwrap();
        assert_eq!(nested.len(), 1);
        assert_eq!(nested[0].path, "src/main.rs");
        assert!(!nested[0].is_dir);
    }

    #[test]
    fn list_dir_in_root_rejects_path_traversal() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("repo");
        fs::create_dir(&repo).unwrap();
        let root = repo.canonicalize().unwrap();
        assert!(list_dir_in_root(&root, "../").is_err());
    }

    #[test]
    fn read_attachment_path_rejects_unsupported_extensions() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("secret.key");
        fs::write(&path, "secret").unwrap();

        let err = read_attachment_path(&path).unwrap_err();

        assert!(err.to_string().contains("Unsupported file type"));
    }
}
