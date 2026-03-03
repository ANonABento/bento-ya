//! CLI detection commands for finding installed AI coding assistants

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedCli {
    pub id: String,
    pub name: String,
    pub path: String,
    pub version: Option<String>,
    pub is_available: bool,
}

/// Common locations to check for CLI tools
fn get_search_paths() -> Vec<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_default();

    vec![
        // Standard PATH locations
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        // User-specific locations
        PathBuf::from(format!("{}/.local/bin", home)),
        PathBuf::from(format!("{}/bin", home)),
        // Claude Code specific
        PathBuf::from(format!("{}/.claude/local/bin", home)),
        // Conductor/Codex location
        PathBuf::from(format!("{}/Library/Application Support/com.conductor.app/bin", home)),
        // Cargo binaries (for rust-based tools)
        PathBuf::from(format!("{}/.cargo/bin", home)),
        // npm global binaries
        PathBuf::from(format!("{}/.npm-global/bin", home)),
        PathBuf::from("/usr/local/lib/node_modules/.bin"),
        // pip/pipx binaries (for aider)
        PathBuf::from(format!("{}/.local/pipx/venvs/aider-chat/bin", home)),
        PathBuf::from(format!("{}/Library/Python/3.11/bin", home)),
        PathBuf::from(format!("{}/Library/Python/3.12/bin", home)),
    ]
}

/// Try to find a CLI tool by name
fn find_cli(name: &str) -> Option<String> {
    // First try `which` command
    if let Ok(output) = Command::new("which").arg(name).output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                return Some(path);
            }
        }
    }

    // Search in common locations
    for search_path in get_search_paths() {
        let full_path = search_path.join(name);
        if full_path.exists() && full_path.is_file() {
            return Some(full_path.to_string_lossy().to_string());
        }
    }

    None
}

/// Get version string from a CLI tool
fn get_cli_version(path: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(path)
        .args(args)
        .output()
        .ok()?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Take first line of output (version usually there)
        let version_line = stdout.lines().next()
            .or_else(|| stderr.lines().next())?;
        Some(version_line.trim().to_string())
    } else {
        None
    }
}

/// Detect a specific CLI tool
fn detect_cli(id: &str, name: &str, binary_name: &str, version_args: &[&str]) -> DetectedCli {
    match find_cli(binary_name) {
        Some(path) => {
            let version = get_cli_version(&path, version_args);
            DetectedCli {
                id: id.to_string(),
                name: name.to_string(),
                path,
                version,
                is_available: true,
            }
        }
        None => DetectedCli {
            id: id.to_string(),
            name: name.to_string(),
            path: String::new(),
            version: None,
            is_available: false,
        }
    }
}

/// Detect all known CLI tools
#[tauri::command]
pub fn detect_clis() -> Vec<DetectedCli> {
    vec![
        detect_cli("claude", "Claude Code", "claude", &["--version"]),
        detect_cli("codex", "Codex CLI", "codex", &["--version"]),
    ]
}

/// Detect a single CLI by its ID
#[tauri::command]
pub fn detect_single_cli(cli_id: String) -> DetectedCli {
    match cli_id.as_str() {
        "claude" => detect_cli("claude", "Claude Code", "claude", &["--version"]),
        "codex" => detect_cli("codex", "Codex CLI", "codex", &["--version"]),
        _ => DetectedCli {
            id: cli_id,
            name: "Unknown".to_string(),
            path: String::new(),
            version: None,
            is_available: false,
        }
    }
}

/// Verify a specific CLI path is valid
#[tauri::command]
pub fn verify_cli_path(path: String) -> DetectedCli {
    let path_obj = std::path::Path::new(&path);

    if !path_obj.exists() {
        return DetectedCli {
            id: "custom".to_string(),
            name: "Custom CLI".to_string(),
            path,
            version: None,
            is_available: false,
        };
    }

    // Try to get version
    let version = get_cli_version(&path, &["--version"]);

    // Try to determine which CLI it is based on the binary name
    let binary_name = path_obj.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");

    let (id, name) = match binary_name {
        "claude" => ("claude", "Claude Code"),
        "codex" => ("codex", "Codex CLI"),
        _ => ("custom", "Custom CLI"),
    };

    DetectedCli {
        id: id.to_string(),
        name: name.to_string(),
        path,
        version,
        is_available: true,
    }
}
