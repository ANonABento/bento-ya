use serde::{Deserialize, Serialize};
use std::process::{Command, Output};
use std::time::{Duration, Instant};

const PREREQUISITE_PROBE_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePrerequisite {
    pub id: String,
    pub name: String,
    pub required: bool,
    pub available: bool,
    pub version: Option<String>,
    pub install_hint: String,
}

fn first_line(output: &[u8]) -> Option<String> {
    String::from_utf8_lossy(output)
        .lines()
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
}

fn command_output_with_timeout(
    binary: &str,
    version_args: &[&str],
    timeout: Duration,
) -> std::io::Result<Option<Output>> {
    let mut child = Command::new(binary).args(version_args).spawn()?;
    let started = Instant::now();

    loop {
        if child.try_wait()?.is_some() {
            return child.wait_with_output().map(Some);
        }

        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(None);
        }

        std::thread::sleep(Duration::from_millis(25));
    }
}

fn check_tool(
    id: &str,
    name: &str,
    required: bool,
    binary: &str,
    version_args: &[&str],
    install_hint: &str,
) -> RuntimePrerequisite {
    let output = command_output_with_timeout(binary, version_args, PREREQUISITE_PROBE_TIMEOUT);
    let (available, version) = match output {
        Ok(Some(output)) if output.status.success() => {
            let version = first_line(&output.stdout).or_else(|| first_line(&output.stderr));
            (true, version)
        }
        _ => (false, None),
    };

    RuntimePrerequisite {
        id: id.to_string(),
        name: name.to_string(),
        required,
        available,
        version,
        install_hint: install_hint.to_string(),
    }
}

#[tauri::command]
pub fn check_runtime_prerequisites() -> Vec<RuntimePrerequisite> {
    vec![
        check_tool(
            "git",
            "Git",
            true,
            "git",
            &["--version"],
            "Install Git from https://git-scm.com/downloads or your OS package manager.",
        ),
        check_tool(
            "tmux",
            "tmux",
            true,
            "tmux",
            &["-V"],
            "Install tmux with Homebrew on macOS (`brew install tmux`) or your Linux package manager.",
        ),
        check_tool(
            "gh",
            "GitHub CLI",
            false,
            "gh",
            &["--version"],
            "Install GitHub CLI from https://cli.github.com/ for PR automation.",
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_prerequisites_include_required_tools() {
        let checks = check_runtime_prerequisites();
        assert!(checks
            .iter()
            .any(|check| check.id == "git" && check.required));
        assert!(checks
            .iter()
            .any(|check| check.id == "tmux" && check.required));
        assert!(checks
            .iter()
            .any(|check| check.id == "gh" && !check.required));
    }
}
