//! CLI detection commands for finding installed AI coding assistants

use serde::{Deserialize, Serialize};
use std::io::Read;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

const CLI_PROBE_TIMEOUT: Duration = Duration::from_secs(3);

fn command_output_with_timeout(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> std::io::Result<Option<Output>> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    // Drain stdout/stderr in dedicated threads so a child that writes more
    // than the OS pipe buffer (~64 KiB) cannot block on write while we are
    // polling try_wait(). Threads exit when the pipes close (on child exit
    // or after we kill the child below).
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_handle = stdout.map(|mut s| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = s.read_to_end(&mut buf);
            buf
        })
    });
    let stderr_handle = stderr.map(|mut s| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = s.read_to_end(&mut buf);
            buf
        })
    });

    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            let stdout = stdout_handle
                .and_then(|h| h.join().ok())
                .unwrap_or_default();
            let stderr = stderr_handle
                .and_then(|h| h.join().ok())
                .unwrap_or_default();
            return Ok(Some(Output {
                status,
                stdout,
                stderr,
            }));
        }

        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_handle.and_then(|h| h.join().ok());
            let _ = stderr_handle.and_then(|h| h.join().ok());
            return Ok(None);
        }

        std::thread::sleep(Duration::from_millis(25));
    }
}

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

    // Order matters: this is a first-match search. User-owned install dirs come
    // BEFORE the system `/usr/local/bin`, because the native Claude/Codex
    // installers and Homebrew put the newest binary in the user's dirs while a
    // stale `npm -g` copy often lingers in `/usr/local/bin`. Preferring the user
    // dirs makes "which binary does the app run" deterministic and matches what
    // the user's own login shell resolves (avoids the two-installs footgun).
    vec![
        // Claude Code's official installer location (highest priority).
        PathBuf::from(format!("{}/.claude/local/bin", home)),
        // User-specific locations.
        PathBuf::from(format!("{}/.local/bin", home)),
        PathBuf::from(format!("{}/bin", home)),
        // Homebrew (Apple Silicon default, then Intel/Linuxbrew).
        PathBuf::from("/opt/homebrew/bin"),
        // Cargo binaries (for rust-based tools).
        PathBuf::from(format!("{}/.cargo/bin", home)),
        // System locations (a stale npm-global copy often lives here).
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
        PathBuf::from("/snap/bin"),
        PathBuf::from("/var/lib/flatpak/exports/bin"),
        PathBuf::from(format!("{}/.local/share/flatpak/exports/bin", home)),
        // Conductor/Codex location.
        PathBuf::from(format!(
            "{}/Library/Application Support/com.conductor.app/bin",
            home
        )),
        // npm global binaries.
        PathBuf::from(format!("{}/.npm-global/bin", home)),
        PathBuf::from("/usr/local/lib/node_modules/.bin"),
        // pip/pipx binaries (for aider).
        PathBuf::from(format!("{}/.local/pipx/venvs/aider-chat/bin", home)),
        PathBuf::from(format!("{}/Library/Python/3.11/bin", home)),
        PathBuf::from(format!("{}/Library/Python/3.12/bin", home)),
    ]
}

/// Try to find a CLI tool by name. Returns its absolute path if found.
///
/// `pub(crate)` so the trigger spawn path can resolve a bare `claude`/`codex`
/// token to an absolute path before injecting it into a tmux pane (whose PATH,
/// under a macOS GUI launch, omits the dirs these CLIs install into).
pub(crate) fn find_cli(name: &str) -> Option<String> {
    // First try `which` command
    if let Ok(Some(output)) = command_output_with_timeout("which", &[name], CLI_PROBE_TIMEOUT) {
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
    let output = command_output_with_timeout(path, args, CLI_PROBE_TIMEOUT)
        .ok()
        .flatten()?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Take first line of output (version usually there)
        let version_line = stdout.lines().next().or_else(|| stderr.lines().next())?;
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
        },
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
        },
    }
}

/// Build model capabilities for the Claude CLI from the dynamic model registry.
fn build_claude_capabilities(_version: &Option<String>) -> Vec<ModelCapability> {
    use crate::models::types::ModelTier;
    use crate::models::{cache, metadata};

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
    let binary_name = path_obj
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");
    let (id, name) = match binary_name {
        "claude" => ("claude", "Claude Code"),
        "codex" => ("codex", "Codex CLI"),
        _ => ("custom", "Custom CLI"),
    };

    if !path_obj.exists() || !path_obj.is_file() {
        return DetectedCli {
            id: id.to_string(),
            name: name.to_string(),
            path,
            version: None,
            is_available: false,
        };
    }

    if !matches!(binary_name, "claude" | "codex") {
        return DetectedCli {
            id: "custom".to_string(),
            name: "Custom CLI".to_string(),
            path,
            version: None,
            is_available: false,
        };
    }

    #[cfg(unix)]
    {
        let executable = path_obj
            .metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false);
        if !executable {
            return DetectedCli {
                id: id.to_string(),
                name: name.to_string(),
                path,
                version: None,
                is_available: false,
            };
        }
    }

    // Try to get version
    let version = get_cli_version(&path, &["--version"]);
    if version.is_none() {
        return DetectedCli {
            id: id.to_string(),
            name: name.to_string(),
            path,
            version: None,
            is_available: false,
        };
    }

    DetectedCli {
        id: id.to_string(),
        name: name.to_string(),
        path,
        version,
        is_available: true,
    }
}

// ─── CLI compatibility health check (Phase 5) ────────────────────────────────
//
// Interactive/headless modes shell straight into `claude`/`codex`, so a CLI
// update that renames or drops a flag silently breaks the product. This layer
// probes each CLI's `--help` and asserts the flags `chat::bridge` depends on
// still exist, and compares `--version` against an optional known-good floor.
// It only ever *warns* — never hard-blocks.

/// A help probe: print help for some (sub)command, then assert `flags` appear.
struct FlagProbe {
    /// Args that print the relevant help (e.g. `["--help"]`, `["exec", "--help"]`).
    help_args: &'static [&'static str],
    /// Flags expected to appear in that help output.
    flags: &'static [&'static str],
}

struct CliHealthSpec {
    id: &'static str,
    name: &'static str,
    binary: &'static str,
    version_args: &'static [&'static str],
    probes: &'static [FlagProbe],
}

/// The flags `chat::bridge` actually passes. Keep in sync with the argv builders
/// there (`build_*_streaming_command`, `build_interactive_*_argv`).
const CLI_HEALTH_SPECS: &[CliHealthSpec] = &[
    CliHealthSpec {
        id: "claude",
        name: "Claude Code",
        binary: "claude",
        version_args: &["--version"],
        probes: &[FlagProbe {
            help_args: &["--help"],
            flags: &[
                "--dangerously-skip-permissions",
                "--output-format",
                "--include-partial-messages",
                "--append-system-prompt",
                "--resume",
                "--model",
            ],
        }],
    },
    CliHealthSpec {
        id: "codex",
        name: "Codex CLI",
        binary: "codex",
        version_args: &["--version"],
        probes: &[
            FlagProbe { help_args: &["--help"], flags: &["exec"] },
            FlagProbe {
                help_args: &["exec", "--help"],
                flags: &["--json", "--skip-git-repo-check", "sandbox"],
            },
        ],
    },
];

/// Per-CLI compatibility report surfaced to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliHealthReport {
    pub id: String,
    pub name: String,
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub min_version: Option<String>,
    pub version_ok: bool,
    pub missing_flags: Vec<String>,
    /// "ok" | "missing" | "outdated" | "drift"
    pub status: String,
}

/// Pure: flags from `expected` that don't appear in `help_text`.
fn missing_flags(help_text: &str, expected: &[&str]) -> Vec<String> {
    expected
        .iter()
        .filter(|flag| !help_text.contains(**flag))
        .map(|flag| (*flag).to_string())
        .collect()
}

/// Pure: parse a leading dotted-number version (e.g. `1.2.3`, or
/// `claude 1.2.3 (build)`) into comparable components. `None` if no digits.
fn parse_version_triple(raw: &str) -> Option<(u64, u64, u64)> {
    let start = raw.find(|c: char| c.is_ascii_digit())?;
    let rest = &raw[start..];
    let end = rest
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(rest.len());
    let mut parts = rest[..end].split('.').filter(|s| !s.is_empty());
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let patch = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    Some((major, minor, patch))
}

/// Pure: does `current` satisfy `>= min`? Unparseable inputs are treated as
/// satisfied — we warn on confident drift, never on a parse we can't trust.
fn version_satisfies_min(current: &str, min: &str) -> bool {
    match (parse_version_triple(current), parse_version_triple(min)) {
        (Some(c), Some(m)) => c >= m,
        _ => true,
    }
}

fn min_version_for(settings: &crate::config::AppSettings, id: &str) -> Option<String> {
    let configured = match id {
        "claude" => settings.claude_min_version.as_ref(),
        "codex" => settings.codex_min_version.as_ref(),
        _ => None,
    };
    configured
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn check_one(spec: &CliHealthSpec, settings: &crate::config::AppSettings) -> CliHealthReport {
    let min_version = min_version_for(settings, spec.id);

    let Some(path) = find_cli(spec.binary) else {
        return CliHealthReport {
            id: spec.id.to_string(),
            name: spec.name.to_string(),
            available: false,
            path: None,
            version: None,
            min_version,
            version_ok: true,
            missing_flags: Vec::new(),
            status: "missing".to_string(),
        };
    };

    let version = get_cli_version(&path, spec.version_args);

    // Only count a flag as missing when its help probe actually succeeds — a
    // timeout or spawn error must not masquerade as drift.
    let mut missing = Vec::new();
    for probe in spec.probes {
        if let Ok(Some(out)) =
            command_output_with_timeout(&path, probe.help_args, CLI_PROBE_TIMEOUT)
        {
            let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
            text.push_str(&String::from_utf8_lossy(&out.stderr));
            missing.extend(missing_flags(&text, probe.flags));
        }
    }

    let version_ok = match (&version, &min_version) {
        (Some(v), Some(m)) => version_satisfies_min(v, m),
        _ => true,
    };

    let status = if !version_ok {
        "outdated"
    } else if !missing.is_empty() {
        "drift"
    } else {
        "ok"
    };

    CliHealthReport {
        id: spec.id.to_string(),
        name: spec.name.to_string(),
        available: true,
        path: Some(path),
        version,
        min_version,
        version_ok,
        missing_flags: missing,
        status: status.to_string(),
    }
}

/// Run the health check for every known CLI (spawns probe processes — call off
/// the UI thread).
pub fn cli_health_reports() -> Vec<CliHealthReport> {
    let settings = crate::config::AppSettings::load();
    CLI_HEALTH_SPECS
        .iter()
        .map(|spec| check_one(spec, &settings))
        .collect()
}

/// On-demand health check (Settings "re-check" button, etc.).
#[tauri::command]
pub fn check_cli_health() -> Vec<CliHealthReport> {
    cli_health_reports()
}

/// Run the health check and broadcast it so the UI can raise a drift banner.
pub fn emit_cli_health(app: &tauri::AppHandle) {
    use tauri::Emitter;
    let _ = app.emit("cli:health", cli_health_reports());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn missing_flags_detects_absent_and_present() {
        let help = "Usage: claude [opts]\n  --model <m>\n  --resume <id>\n";
        assert_eq!(missing_flags(help, &["--model", "--resume"]), Vec::<String>::new());
        assert_eq!(
            missing_flags(help, &["--model", "--append-system-prompt"]),
            vec!["--append-system-prompt".to_string()],
        );
    }

    #[test]
    fn version_triple_parses_messy_strings() {
        assert_eq!(parse_version_triple("1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version_triple("claude 2.0.14 (build 9)"), Some((2, 0, 14)));
        assert_eq!(parse_version_triple("v3"), Some((3, 0, 0)));
        assert_eq!(parse_version_triple("no digits"), None);
    }

    #[test]
    fn version_floor_compares_and_tolerates_garbage() {
        assert!(version_satisfies_min("2.1.0", "2.0.0"));
        assert!(version_satisfies_min("2.0.0", "2.0.0"));
        assert!(!version_satisfies_min("1.9.9", "2.0.0"));
        // Unparseable → treated as satisfied (never hard-block on a bad parse).
        assert!(version_satisfies_min("weird", "2.0.0"));
    }

    #[test]
    fn verify_cli_path_rejects_directories() {
        let temp = tempfile::tempdir().unwrap();
        let detected = verify_cli_path(temp.path().to_string_lossy().to_string());
        assert!(!detected.is_available);
    }

    #[test]
    fn verify_cli_path_rejects_non_executable_files() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("claude");
        fs::write(&path, "#!/bin/sh\necho claude").unwrap();
        #[cfg(unix)]
        {
            let mut permissions = fs::metadata(&path).unwrap().permissions();
            permissions.set_mode(0o644);
            fs::set_permissions(&path, permissions).unwrap();
        }

        let detected = verify_cli_path(path.to_string_lossy().to_string());
        assert!(!detected.is_available);
    }

    #[test]
    fn verify_cli_path_rejects_unknown_executable_without_running_it() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("not-an-agent");
        let marker = temp.path().join("marker");
        fs::write(
            &path,
            format!("#!/bin/sh\ntouch {}\necho nope\n", marker.display()),
        )
        .unwrap();
        #[cfg(unix)]
        {
            let mut permissions = fs::metadata(&path).unwrap().permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&path, permissions).unwrap();
        }

        let detected = verify_cli_path(path.to_string_lossy().to_string());
        assert!(!detected.is_available);
        assert!(!marker.exists());
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
    let version_output = tokio::time::timeout(
        CLI_PROBE_TIMEOUT,
        tokio::process::Command::new(&path)
            .arg("--version")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output(),
    )
    .await
    .ok()
    .and_then(Result::ok);

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
                .find(|part| {
                    part.chars()
                        .next()
                        .map(|c| c.is_ascii_digit())
                        .unwrap_or(false)
                })
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
                    .output(),
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

    let has_update = latest_version
        .as_ref()
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
    let url = format!(
        "https://api.github.com/repos/{}/{}/releases/latest",
        owner, repo
    );

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(_) => return (None, None),
    };

    let resp = match client
        .get(&url)
        .header("User-Agent", "kaitencode")
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
    let version_str = body["name"]
        .as_str()
        .filter(|s| {
            s.chars()
                .next()
                .map(|c| c.is_ascii_digit())
                .unwrap_or(false)
        })
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
                if trimmed.contains("→") || trimmed.contains("->") {
                    if let Some(ver) = extract_version_after_arrow(trimmed) {
                        latest_version = Some(ver);
                    }
                }
                // "To update, run:\n  brew upgrade claude-code"
                if trimmed.starts_with("brew ")
                    || trimmed.starts_with("npm ")
                    || trimmed.starts_with("pip")
                {
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
                    if let Some(ver) = extract_version_after_arrow(trimmed) {
                        latest_version = Some(ver);
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

/// Extract a version number after an arrow (→ or ->) in a string.
/// "2.1.92 → 2.1.97" → Some("2.1.97")
/// "Update available! 0.107.0 -> 0.118.0" → Some("0.118.0")
fn extract_version_after_arrow(s: &str) -> Option<String> {
    // Split on → or -> and take everything after the last arrow
    let after = s.split("→").last().or_else(|| s.split("->").last())?.trim();

    // Extract the first version-like token (digits and dots)
    let version: String = after
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();

    if version.is_empty() || !version.contains('.') {
        return None;
    }

    Some(version)
}
