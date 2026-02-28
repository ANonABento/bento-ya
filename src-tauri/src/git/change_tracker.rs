use git2::{BranchType, Diff, DiffFormat, DiffOptions, Patch, Repository};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct FileChange {
    pub path: String,
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Debug, Serialize)]
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

/// Compute a tree-to-tree diff between the base branch and a task branch,
/// optionally filtered to a single file path.
fn get_branch_diff<'a>(
    repo: &'a Repository,
    branch: &str,
    file_path: Option<&str>,
) -> Result<Diff<'a>, String> {
    let base_name = find_base_branch(repo).map_err(|e| e.to_string())?;

    let base_branch = repo
        .find_branch(&base_name, BranchType::Local)
        .map_err(|e| format!("Base branch '{}' not found: {}", base_name, e))?;
    let base_tree = base_branch
        .get()
        .peel_to_commit()
        .map_err(|e| e.to_string())?
        .tree()
        .map_err(|e| e.to_string())?;

    let task_branch = repo
        .find_branch(branch, BranchType::Local)
        .map_err(|e| format!("Branch '{}' not found: {}", branch, e))?;
    let task_tree = task_branch
        .get()
        .peel_to_commit()
        .map_err(|e| e.to_string())?
        .tree()
        .map_err(|e| e.to_string())?;

    let mut opts = DiffOptions::new();
    if let Some(path) = file_path {
        opts.pathspec(path);
    }

    repo.diff_tree_to_tree(Some(&base_tree), Some(&task_tree), Some(&mut opts))
        .map_err(|e| e.to_string())
}

fn status_label(status: git2::Delta) -> String {
    match status {
        git2::Delta::Added => "added",
        git2::Delta::Deleted => "deleted",
        git2::Delta::Modified => "modified",
        git2::Delta::Renamed => "renamed",
        git2::Delta::Copied => "copied",
        _ => "unknown",
    }
    .to_string()
}

/// Return a summary of all changed files on a branch vs its base,
/// including per-file addition/deletion counts.
pub fn get_changes(repo_path: &str, branch: &str) -> Result<ChangeSummary, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let diff = get_branch_diff(&repo, branch, None)?;

    let stats = diff.stats().map_err(|e| e.to_string())?;
    let num_deltas = diff.deltas().len();

    // First pass: collect owned file info from deltas
    let mut file_infos: Vec<(String, String)> = Vec::with_capacity(num_deltas);
    for delta in diff.deltas() {
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        file_infos.push((path, status_label(delta.status())));
    }

    // Second pass: get per-file line stats from patches
    let mut files = Vec::with_capacity(num_deltas);
    for (i, (path, status)) in file_infos.into_iter().enumerate() {
        let (additions, deletions) = Patch::from_diff(&diff, i)
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

    Ok(ChangeSummary {
        total_additions: stats.insertions(),
        total_deletions: stats.deletions(),
        total_files: stats.files_changed(),
        files,
    })
}

/// Return a unified diff string for a branch vs its base.
/// If `file_path` is provided, only that file's diff is returned.
pub fn get_diff(
    repo_path: &str,
    branch: &str,
    file_path: Option<&str>,
) -> Result<String, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let diff = get_branch_diff(&repo, branch, file_path)?;

    let mut output = String::new();
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
    .map_err(|e| e.to_string())?;

    Ok(output)
}

/// Return the list of file paths touched on a branch vs its base.
pub fn get_files_touched(repo_path: &str, branch: &str) -> Result<Vec<String>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let diff = get_branch_diff(&repo, branch, None)?;

    let files: Vec<String> = diff
        .deltas()
        .filter_map(|delta| {
            delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().to_string())
        })
        .collect();

    Ok(files)
}

/// A single commit on a task branch.
#[derive(Debug, Serialize)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: i64,
}

/// Return the list of commits on a task branch that are not on the base branch.
pub fn get_commits(repo_path: &str, branch: &str) -> Result<Vec<CommitInfo>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

    let base_name = find_base_branch(&repo).map_err(|e| e.to_string())?;

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
    revwalk
        .hide(merge_base)
        .map_err(|e| e.to_string())?;
    revwalk.set_sorting(git2::Sort::TIME).map_err(|e| e.to_string())?;

    let mut commits = Vec::new();
    for oid in revwalk {
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let hash = oid.to_string();
        let short_hash = hash[..7.min(hash.len())].to_string();
        let message = commit
            .summary()
            .unwrap_or("")
            .to_string();
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
