use std::collections::HashSet;

use git2::{BranchType, Diff, DiffFormat, DiffOptions, Patch, Repository};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSummary {
    pub files: Vec<FileChange>,
    pub total_additions: usize,
    pub total_deletions: usize,
    pub total_files: usize,
}

/// Detect the default base branch: try "main", then "master", then current HEAD.
fn find_base_branch(repo: &Repository) -> Result<String, git2::Error> {
    for name in &["main", "master"] {
        if repo.find_branch(name, BranchType::Local).is_ok() {
            return Ok(name.to_string());
        }
    }
    let head = repo.head()?;
    Ok(head.shorthand().unwrap_or("HEAD").to_string())
}

fn resolve_base_branch(repo: &Repository, base_branch: Option<&str>) -> Result<String, String> {
    match base_branch.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => Ok(value.to_string()),
        None => find_base_branch(repo).map_err(|e| e.to_string()),
    }
}

fn get_branch_tree<'a>(repo: &'a Repository, branch: &str) -> Result<git2::Tree<'a>, String> {
    let task_branch = repo
        .find_branch(branch, BranchType::Local)
        .map_err(|e| format!("Branch '{}' not found: {}", branch, e))?;

    task_branch
        .get()
        .peel_to_commit()
        .map_err(|e| e.to_string())?
        .tree()
        .map_err(|e| e.to_string())
}

fn get_commit<'a>(repo: &'a Repository, commit_hash: &str) -> Result<git2::Commit<'a>, String> {
    repo.revparse_single(commit_hash)
        .map_err(|e| format!("Commit '{}' not found: {}", commit_hash, e))?
        .peel_to_commit()
        .map_err(|e| format!("Reference '{}' is not a commit: {}", commit_hash, e))
}

fn get_commit_diff<'a>(
    repo: &'a Repository,
    commit_hash: &str,
    file_path: Option<&str>,
) -> Result<Diff<'a>, String> {
    let commit = get_commit(repo, commit_hash)?;
    let new_tree = commit.tree().map_err(|e| e.to_string())?;
    let old_tree = if commit.parent_count() > 0 {
        Some(
            commit
                .parent(0)
                .map_err(|e| e.to_string())?
                .tree()
                .map_err(|e| e.to_string())?,
        )
    } else {
        None
    };

    let mut opts = DiffOptions::new();
    if let Some(path) = file_path {
        opts.pathspec(path);
    }

    repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), Some(&mut opts))
        .map_err(|e| e.to_string())
}

fn head_matches_branch(repo: &Repository, branch: &str) -> bool {
    repo.head()
        .ok()
        .and_then(|head| head.shorthand().map(|value| value == branch))
        .unwrap_or(false)
}

/// Compute a tree-to-tree diff between the base branch and a task branch,
/// optionally filtered to a single file path.
fn get_branch_diff<'a>(
    repo: &'a Repository,
    branch: &str,
    base_branch: Option<&str>,
    file_path: Option<&str>,
) -> Result<Diff<'a>, String> {
    let base_name = resolve_base_branch(repo, base_branch)?;

    let base_branch = repo
        .find_branch(&base_name, BranchType::Local)
        .map_err(|e| format!("Base branch '{}' not found: {}", base_name, e))?;
    let base_tree = base_branch
        .get()
        .peel_to_commit()
        .map_err(|e| e.to_string())?
        .tree()
        .map_err(|e| e.to_string())?;

    let task_tree = get_branch_tree(repo, branch)?;

    let mut opts = DiffOptions::new();
    if let Some(path) = file_path {
        opts.pathspec(path);
    }

    repo.diff_tree_to_tree(Some(&base_tree), Some(&task_tree), Some(&mut opts))
        .map_err(|e| e.to_string())
}

fn get_workdir_diff<'a>(
    repo: &'a Repository,
    branch: &str,
    file_path: Option<&str>,
) -> Result<Option<Diff<'a>>, String> {
    if !head_matches_branch(repo, branch) {
        return Ok(None);
    }

    let task_tree = get_branch_tree(repo, branch)?;
    let mut opts = DiffOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_typechange(true);
    if let Some(path) = file_path {
        opts.pathspec(path);
    }

    repo.diff_tree_to_workdir_with_index(Some(&task_tree), Some(&mut opts))
        .map(Some)
        .map_err(|e| e.to_string())
}

fn status_label(status: git2::Delta) -> String {
    match status {
        git2::Delta::Added => "added",
        git2::Delta::Untracked => "added",
        git2::Delta::Deleted => "deleted",
        git2::Delta::Modified => "modified",
        git2::Delta::Renamed => "renamed",
        git2::Delta::Copied => "copied",
        _ => "unknown",
    }
    .to_string()
}

fn collect_file_changes(
    diff: &Diff<'_>,
    files: &mut Vec<FileChange>,
    seen_paths: &mut HashSet<String>,
) {
    let num_deltas = diff.deltas().len();
    let mut file_infos: Vec<(usize, String, String)> = Vec::with_capacity(num_deltas);

    for (i, delta) in diff.deltas().enumerate() {
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        if path.is_empty() || !seen_paths.insert(path.clone()) {
            continue;
        }
        file_infos.push((i, path, status_label(delta.status())));
    }

    for (i, path, status) in file_infos {
        let (additions, deletions) = Patch::from_diff(diff, i)
            .ok()
            .flatten()
            .and_then(|patch| {
                let (_, adds, dels) = patch.line_stats().ok()?;
                Some((adds, dels))
            })
            .unwrap_or((0, 0));

        files.push(FileChange {
            path,
            status,
            additions,
            deletions,
        });
    }
}

fn print_diff(diff: &Diff<'_>, output: &mut String) -> Result<(), String> {
    diff.print(DiffFormat::Patch, |_delta, _hunk, line| {
        match line.origin() {
            '+' | '-' | ' ' => {
                output.push(line.origin());
                output.push_str(&String::from_utf8_lossy(line.content()));
            }
            _ => {
                // File headers, hunk headers, binary markers
                output.push_str(&String::from_utf8_lossy(line.content()));
            }
        }
        true
    })
    .map_err(|e| e.to_string())
}

/// Return a summary of all changed files on a branch vs its base,
/// including dirty worktree and untracked files when the task branch is checked out.
pub fn get_changes(
    repo_path: &str,
    branch: &str,
    base_branch: Option<&str>,
) -> Result<ChangeSummary, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let branch_diff = get_branch_diff(&repo, branch, base_branch, None)?;
    let workdir_diff = get_workdir_diff(&repo, branch, None)?;

    let mut files = Vec::new();
    let mut seen_paths = HashSet::new();
    collect_file_changes(&branch_diff, &mut files, &mut seen_paths);

    if let Some(workdir_diff) = workdir_diff {
        collect_file_changes(&workdir_diff, &mut files, &mut seen_paths);
    }

    // Derive totals from the per-file list rather than summing branch+workdir
    // diff stats independently: when a file is touched in BOTH the branch
    // diff and the dirty worktree, the file entry is deduped via seen_paths,
    // so summing both stats would double-count it and produce a header that
    // disagreed with the listed file rows.
    let total_additions: usize = files.iter().map(|f| f.additions).sum();
    let total_deletions: usize = files.iter().map(|f| f.deletions).sum();

    Ok(ChangeSummary {
        total_additions,
        total_deletions,
        total_files: files.len(),
        files,
    })
}

/// Return a unified diff string for a branch vs its base.
/// If `file_path` is provided, only that file's diff is returned. Dirty
/// worktree changes are appended when the task branch is checked out.
pub fn get_diff(
    repo_path: &str,
    branch: &str,
    base_branch: Option<&str>,
    file_path: Option<&str>,
) -> Result<String, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let branch_diff = get_branch_diff(&repo, branch, base_branch, file_path)?;
    let workdir_diff = get_workdir_diff(&repo, branch, file_path)?;

    let mut output = String::new();
    print_diff(&branch_diff, &mut output)?;
    if let Some(workdir_diff) = workdir_diff {
        if !output.is_empty() && workdir_diff.deltas().len() > 0 {
            output.push('\n');
        }
        print_diff(&workdir_diff, &mut output)?;
    }

    Ok(output)
}

pub fn get_commit_changes(repo_path: &str, commit_hash: &str) -> Result<ChangeSummary, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let diff = get_commit_diff(&repo, commit_hash, None)?;
    let stats = diff.stats().map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    let mut seen_paths = HashSet::new();
    collect_file_changes(&diff, &mut files, &mut seen_paths);

    Ok(ChangeSummary {
        total_additions: stats.insertions(),
        total_deletions: stats.deletions(),
        total_files: files.len(),
        files,
    })
}

pub fn get_commit_diff_text(
    repo_path: &str,
    commit_hash: &str,
    file_path: Option<&str>,
) -> Result<String, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let diff = get_commit_diff(&repo, commit_hash, file_path)?;
    let mut output = String::new();
    print_diff(&diff, &mut output)?;
    Ok(output)
}

/// Return the list of file paths touched on a branch vs its base, plus dirty
/// worktree paths when the task branch is checked out.
pub fn get_files_touched(
    repo_path: &str,
    branch: &str,
    base_branch: Option<&str>,
) -> Result<Vec<String>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let branch_diff = get_branch_diff(&repo, branch, base_branch, None)?;
    let workdir_diff = get_workdir_diff(&repo, branch, None)?;

    let mut seen_paths = HashSet::new();
    let mut collect_paths = |diff: &Diff<'_>| {
        for delta in diff.deltas() {
            if let Some(path) = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().to_string())
            {
                seen_paths.insert(path);
            }
        }
    };

    collect_paths(&branch_diff);
    if let Some(workdir_diff) = &workdir_diff {
        collect_paths(workdir_diff);
    }

    Ok(seen_paths.into_iter().collect())
}

/// A single commit on a task branch.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: i64,
}

/// Return the list of commits on a task branch that are not on the base branch.
pub fn get_commits(
    repo_path: &str,
    branch: &str,
    base_branch: Option<&str>,
) -> Result<Vec<CommitInfo>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

    let base_name = resolve_base_branch(&repo, base_branch)?;

    let base_branch = repo
        .find_branch(&base_name, BranchType::Local)
        .map_err(|e| format!("Base branch '{}' not found: {}", base_name, e))?;
    let base_commit = base_branch
        .get()
        .peel_to_commit()
        .map_err(|e| e.to_string())?;

    let task_branch = repo
        .find_branch(branch, BranchType::Local)
        .map_err(|e| format!("Branch '{}' not found: {}", branch, e))?;
    let task_commit = task_branch
        .get()
        .peel_to_commit()
        .map_err(|e| e.to_string())?;

    let merge_base = repo
        .merge_base(base_commit.id(), task_commit.id())
        .map_err(|e| e.to_string())?;

    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push(task_commit.id()).map_err(|e| e.to_string())?;
    revwalk.hide(merge_base).map_err(|e| e.to_string())?;
    revwalk
        .set_sorting(git2::Sort::TIME)
        .map_err(|e| e.to_string())?;

    let mut commits = Vec::new();
    for oid in revwalk {
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let hash = oid.to_string();
        let short_hash = hash[..7.min(hash.len())].to_string();
        let message = commit.summary().unwrap_or("").to_string();
        let author = commit.author().name().unwrap_or("").to_string();
        let timestamp = commit.time().seconds();

        commits.push(CommitInfo {
            hash,
            short_hash,
            message,
            author,
            timestamp,
        });
    }

    Ok(commits)
}

pub fn get_commit_info(repo_path: &str, commit_hash: &str) -> Result<CommitInfo, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let commit = get_commit(&repo, commit_hash)?;
    let hash = commit.id().to_string();
    let short_hash = hash[..7.min(hash.len())].to_string();
    let message = commit.summary().unwrap_or("").to_string();
    let author = commit.author().name().unwrap_or("").to_string();
    let timestamp = commit.time().seconds();

    Ok(CommitInfo {
        hash,
        short_hash,
        message,
        author,
        timestamp,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::Path, process::Command};

    fn git(repo: &Path, args: &[&str]) {
        let output = Command::new("git")
            .current_dir(repo)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {:?} failed\nstdout:\n{}\nstderr:\n{}",
            args,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn commit_file(repo: &Path, path: &str, contents: &str, message: &str) {
        fs::write(repo.join(path), contents).expect("write test file");
        git(repo, &["add", path]);
        git(repo, &["commit", "-q", "-m", message]);
    }

    #[test]
    fn branch_views_honor_explicit_base_branch() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let repo = tmp.path();

        git(repo, &["init", "-q", "-b", "main"]);
        git(repo, &["config", "user.email", "test@example.com"]);
        git(repo, &["config", "user.name", "Test User"]);

        commit_file(repo, "base.txt", "base\n", "base");
        git(repo, &["checkout", "-q", "-b", "develop"]);
        commit_file(repo, "develop-only.txt", "develop\n", "develop only");
        git(repo, &["checkout", "-q", "-b", "feature/custom-base"]);
        commit_file(repo, "feature.txt", "feature\n", "feature");

        let repo_path = repo.to_str().expect("utf8 path");
        let changes = get_changes(repo_path, "feature/custom-base", Some("develop"))
            .expect("custom-base changes");
        let files: Vec<&str> = changes
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect();
        assert_eq!(files, vec!["feature.txt"]);

        let diff = get_diff(repo_path, "feature/custom-base", Some("develop"), None)
            .expect("custom-base diff");
        assert!(diff.contains("feature.txt"));
        assert!(!diff.contains("develop-only.txt"));

        let commits = get_commits(repo_path, "feature/custom-base", Some("develop"))
            .expect("custom-base commits");
        let messages: Vec<&str> = commits
            .iter()
            .map(|commit| commit.message.as_str())
            .collect();
        assert_eq!(messages, vec!["feature"]);
    }
}
