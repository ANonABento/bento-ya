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

/// Per-model capability info returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapability {
    pub id: String,
    pub name: String,
    pub description: String,
    pub supports_extended_context: bool,
    pub context_window: String,
    pub max_effort: String, // "low" | "medium" | "high"
    pub available: bool,
}

/// Full capabilities result for a CLI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCapabilities {
    pub cli_id: String,
    pub cli_version: Option<String>,
    pub models: Vec<ModelCapability>,
    pub detected: bool,
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

/// Build model capabilities for the Claude CLI from the dynamic model registry.
fn build_claude_capabilities(_version: &Option<String>) -> Vec<ModelCapability> {
    use crate::models::{cache, metadata};
    use crate::models::types::ModelTier;

    // Try cached models first, fall back to metadata-only
    let cached = cache::load_cache();
    let anthropic_models: Vec<_> = cached
        .models
        .iter()
        .filter(|m| m.provider == "anthropic")
        .collect();

    if !anthropic_models.is_empty() {
        return anthropic_models
            .iter()
            .map(|m| {
                let effort = match m.tier {
                    ModelTier::Flagship => "high",
                    ModelTier::Standard => "high",
                    ModelTier::Fast => "low",
                };
                let description = match m.tier {
                    ModelTier::Flagship => "Most powerful",
                    ModelTier::Standard => "Fast & capable",
                    ModelTier::Fast => "Quick & light",
                };
                ModelCapability {
                    id: m.alias.clone().unwrap_or_else(|| m.id.clone()),
                    name: m.display_name.clone(),
                    description: description.to_string(),
                    supports_extended_context: m.supports_extended_context,
                    context_window: format!("{}k", m.context_window / 1000),
                    max_effort: effort.to_string(),
                    available: true,
                }
            })
            .collect();
    }

    // No cache — build from known metadata
    let known = [
        ("claude-opus-4-6-20260217", "opus", "Opus"),
        ("claude-sonnet-4-6-20260217", "sonnet", "Sonnet"),
        ("claude-haiku-4-5-20251001", "haiku", "Haiku"),
    ];

    known
        .iter()
        .filter_map(|(id, alias, short_name)| {
            let meta = metadata::get_known_metadata(id)?;
            let effort = match meta.tier {
                ModelTier::Flagship => "high",
                ModelTier::Standard => "high",
                ModelTier::Fast => "low",
            };
            let description = match meta.tier {
                ModelTier::Flagship => "Most powerful",
                ModelTier::Standard => "Fast & capable",
                ModelTier::Fast => "Quick & light",
            };
            Some(ModelCapability {
                id: alias.to_string(),
                name: short_name.to_string(),
                description: description.to_string(),
                supports_extended_context: meta.supports_extended_context,
                context_window: format!("{}k", meta.context_window / 1000),
                max_effort: effort.to_string(),
                available: true,
            })
        })
        .collect()
}

/// Get model capabilities for a CLI provider.
#[tauri::command]
pub fn get_cli_capabilities(cli_id: String) -> CliCapabilities {
    match cli_id.as_str() {
        "claude" => {
            let detected = detect_cli("claude", "Claude Code", "claude", &["--version"]);
            let models = build_claude_capabilities(&detected.version);
            CliCapabilities {
                cli_id: "claude".to_string(),
                cli_version: detected.version,
                models,
                detected: detected.is_available,
            }
        }
        _ => CliCapabilities {
            cli_id,
            cli_version: None,
            models: vec![],
            detected: false,
        },
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

/// Update check result for a CLI tool
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliUpdateInfo {
    pub cli_id: String,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub has_update: bool,
    pub update_command: Option<String>,
}

/// Check if a CLI tool has an available update.
/// Runs the CLI's update check command and parses the output.
#[tauri::command]
pub async fn check_cli_update(cli_id: String) -> Result<CliUpdateInfo, String> {
    let binary = match cli_id.as_str() {
        "claude" | "codex" => cli_id.as_str(),
        _ => return Err(format!("Unknown CLI: {}", cli_id)),
    };

    // Find the CLI
    let path = find_cli(binary).ok_or_else(|| format!("{} CLI not found", binary))?;

    // Get current version — run async to handle paths with spaces
    let version_output = tokio::process::Command::new(&path)
        .arg("--version")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .await
        .ok();

    let current_version = version_output
        .and_then(|o| {
            let out = if o.status.success() {
                String::from_utf8_lossy(&o.stdout).to_string()
            } else {
                String::from_utf8_lossy(&o.stderr).to_string()
            };
            let line = out.lines().next()?.trim().to_string();
            // Extract just the version number (e.g. "codex-cli 0.107.0" → "0.107.0")
            line.split_whitespace()
                .find(|part| part.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false))
                .map(|s| s.to_string())
                .or(Some(line))
        })
        .unwrap_or_else(|| "unknown".to_string());

    // Check for updates — different strategy per CLI
    let (latest_version, update_command) = match cli_id.as_str() {
        "claude" => {
            // Claude: `claude update` works non-interactively
            let output = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                tokio::process::Command::new(&path)
                    .args(["update"])
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .output()
            )
            .await
            .map_err(|_| "Update check timed out".to_string())?
            .map_err(|e| format!("Failed to run update check: {}", e))?;

            let combined = format!(
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            parse_update_output(&cli_id, &combined)
        }
        "codex" => {
            // Codex: `upgrade` requires TTY, so check GitHub releases API instead
            check_github_latest("openai", "codex").await
        }
        _ => (None, None),
    };

    let has_update = latest_version.as_ref()
        .map(|latest| latest != &current_version)
        .unwrap_or(false);

    Ok(CliUpdateInfo {
        cli_id,
        current_version,
        latest_version,
        has_update,
        update_command,
    })
}

/// Check GitHub releases API for latest version of a repo.
async fn check_github_latest(owner: &str, repo: &str) -> (Option<String>, Option<String>) {
    let url = format!("https://api.github.com/repos/{}/{}/releases/latest", owner, repo);

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(_) => return (None, None),
    };

    let resp = match client
        .get(&url)
        .header("User-Agent", "bento-ya")
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        _ => return (None, None),
    };

    let body: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => return (None, None),
    };

    // Prefer "name" (clean version like "0.121.0") over "tag_name" (may have prefix like "rust-v0.121.0")
    let version_str = body["name"].as_str()
        .filter(|s| s.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false))
        .or_else(|| body["tag_name"].as_str())
        .unwrap_or("");
    let version = version_str
        .trim_start_matches("rust-")
        .trim_start_matches('v')
        .to_string();

    if version.is_empty() {
        return (None, None);
    }

    let update_cmd = format!("{} upgrade", repo);
    (Some(version), Some(update_cmd))
}

/// Parse update command output for version and update instructions.
fn parse_update_output(cli_id: &str, output: &str) -> (Option<String>, Option<String>) {
    let mut latest_version = None;
    let mut update_command = None;

    for line in output.lines() {
        let trimmed = line.trim();

        match cli_id {
            "claude" => {
                // "Update available: 2.1.92 → 2.1.97"
                if trimmed.contains("Update available:") || trimmed.contains("→") || trimmed.contains("->") {
                    let parts: Vec<&str> = trimmed.split(|c| c == '→' || c == '>').collect();
                    if let Some(last) = parts.last() {
                        let ver = last.trim().trim_start_matches('-').trim();
                        if !ver.is_empty() && ver.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
                            latest_version = Some(ver.to_string());
                        }
                    }
                }
                // "To update, run:\n  brew upgrade claude-code"
                if trimmed.starts_with("brew ") || trimmed.starts_with("npm ") || trimmed.starts_with("pip") {
                    update_command = Some(trimmed.to_string());
                }
                // "already up to date" / "is up to date"
                if trimmed.contains("up to date") || trimmed.contains("up-to-date") {
                    latest_version = None; // signal no update
                }
            }
            "codex" => {
                // "Update available! 0.107.0 -> 0.118.0"
                if trimmed.contains("->") || trimmed.contains("→") {
                    let parts: Vec<&str> = trimmed.split(|c| c == '→' || c == '>').collect();
                    if let Some(last) = parts.last() {
                        let ver = last.trim().trim_start_matches('-').trim();
                        if !ver.is_empty() && ver.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
                            latest_version = Some(ver.to_string());
                        }
                    }
                }
                // "See https://github.com/openai/codex for installation options."
                if trimmed.contains("github.com/openai/codex") {
                    update_command = Some("codex upgrade".to_string());
                }
            }
            _ => {}
        }
    }

    (latest_version, update_command)
}
