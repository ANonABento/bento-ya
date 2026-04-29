use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// File entry returned to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub category: String,
    pub modified_at: i64,
}

/// File categories for grouping
const CATEGORY_CONTEXT: &str = "context";
const CATEGORY_TICKETS: &str = "tickets";
const CATEGORY_NOTES: &str = "notes";

/// Recursively scan a directory for markdown files
fn scan_dir_for_md(dir: &Path, files: &mut Vec<FileEntry>, category: &str) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                scan_dir_for_md(&path, files, category);
            } else if let Some(ext) = path.extension() {
                if ext == "md" {
                    let modified_at = entry
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

                    files.push(FileEntry {
                        path: path.to_string_lossy().to_string(),
                        name,
                        category: category.to_string(),
                        modified_at,
                    });
                }
            }
        }
    }
}

/// Scan workspace for relevant markdown files
/// Scans: *.md in root, .context/**/*.md, .tickets/**/*.md
#[tauri::command]
pub fn scan_workspace_files(repo_path: String) -> Result<Vec<FileEntry>, AppError> {
    let root = PathBuf::from(&repo_path);
    if !root.exists() {
        return Err(AppError::InvalidInput(format!(
            "Repository path does not exist: {}",
            repo_path
        )));
    }

    let mut files: Vec<FileEntry> = Vec::new();

    // Scan root for *.md files (notes category)
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext == "md" {
                        let modified_at = entry
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

                        files.push(FileEntry {
                            path: path.to_string_lossy().to_string(),
                            name,
                            category: CATEGORY_NOTES.to_string(),
                            modified_at,
                        });
                    }
                }
            }
        }
    }

    // Scan .context directory
    let context_dir = root.join(".context");
    if context_dir.exists() && context_dir.is_dir() {
        scan_dir_for_md(&context_dir, &mut files, CATEGORY_CONTEXT);
    }

    // Scan .tickets directory
    let tickets_dir = root.join(".tickets");
    if tickets_dir.exists() && tickets_dir.is_dir() {
        scan_dir_for_md(&tickets_dir, &mut files, CATEGORY_TICKETS);
    }

    // Sort by modified_at descending (most recent first)
    files.sort_by_key(|f| std::cmp::Reverse(f.modified_at));

    Ok(files)
}

/// Read content of a file
#[tauri::command]
pub fn read_file_content(file_path: String) -> Result<String, AppError> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err(AppError::InvalidInput(format!(
            "File does not exist: {}",
            file_path
        )));
    }

    fs::read_to_string(&path).map_err(|e| AppError::InvalidInput(format!("Failed to read file: {}", e)))
}

/// Create a new markdown note file
#[tauri::command]
pub fn create_note_file(
    repo_path: String,
    filename: String,
    content: String,
) -> Result<FileEntry, AppError> {
    let root = PathBuf::from(&repo_path);
    if !root.exists() {
        return Err(AppError::InvalidInput(format!(
            "Repository path does not exist: {}",
            repo_path
        )));
    }

    // Ensure filename ends with .md
    let filename = if filename.ends_with(".md") {
        filename
    } else {
        format!("{}.md", filename)
    };

    let file_path = root.join(&filename);

    // Don't overwrite existing files
    if file_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "File already exists: {}",
            filename
        )));
    }

    fs::write(&file_path, &content)
        .map_err(|e| AppError::InvalidInput(format!("Failed to create file: {}", e)))?;

    let modified_at = file_path
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    Ok(FileEntry {
        path: file_path.to_string_lossy().to_string(),
        name: filename,
        category: CATEGORY_NOTES.to_string(),
        modified_at,
    })
}
