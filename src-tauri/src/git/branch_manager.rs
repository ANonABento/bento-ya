use crate::config::{normalize_branch_prefix, DEFAULT_BRANCH_PREFIX};
use git2::{BranchType, Repository, Signature, StashFlags, WorktreeAddOptions};
use serde::Serialize;
use std::path::PathBuf;

const AUTO_STASH_PREFIX: &str = "bentoya-auto-stash-";

#[derive(Debug, Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub upstream: Option<String>,
}

/// Slugify a task title: lowercase, replace non-alphanumeric with hyphens,
/// collapse multiple hyphens, strip leading/trailing hyphens, truncate to 50 chars.
pub fn slugify(input: &str) -> String {
    let slug: String = input
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let collapsed: String = slug
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    collapsed.chars().take(50).collect()
}

/// Detect the default base branch: try "main", then "master", then current HEAD.
fn detect_base_branch(repo: &Repository) -> Result<String, git2::Error> {
    for name in &["main", "master"] {
        if repo.find_branch(name, BranchType::Local).is_ok() {
            return Ok(name.to_string());
        }
    }
    let head = repo.head()?;
    Ok(head.shorthand().unwrap_or("HEAD").to_string())
}

/// Fetch `origin/<base_branch>` and fast-forward the local `<base_branch>`
/// reference to match. Best-effort: any failure (no remote, network down,
/// non-fast-forward divergence) is logged at warn level and swallowed so the
/// caller can proceed with whatever local has.
///
/// Why: tasks that create worktrees from a stale local base silently lose
/// commits when other agents push to remote main between the user's last
/// `git fetch` and the trigger fire.
pub fn fetch_and_fastforward_base(repo_path: &str, base_branch: &str) {
    use std::process::Command;

    let fetch = Command::new("git")
        .args(["fetch", "origin", base_branch])
        .current_dir(repo_path)
        .output();

    match fetch {
        Ok(o) if o.status.success() => {}
        Ok(o) => {
            log::warn!(
                "[branch_manager] git fetch origin {} failed: {}",
                base_branch,
                String::from_utf8_lossy(&o.stderr).trim()
            );
            return;
        }
        Err(e) => {
            log::warn!("[branch_manager] could not run git fetch: {}", e);
            return;
        }
    }

    // `git fetch origin <base>:<base>` performs a fast-forward refspec update.
    // Refuses non-FF (diverged) and refuses to overwrite a checked-out branch.
    let ff = Command::new("git")
        .args([
            "fetch",
            "origin",
            &format!("{}:{}", base_branch, base_branch),
        ])
        .current_dir(repo_path)
        .output();

    match ff {
        Ok(o) if o.status.success() => {
            log::info!(
                "[branch_manager] fast-forwarded local {} to origin/{}",
                base_branch,
                base_branch
            );
        }
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr).trim().to_string();
            // If <base> is currently checked out, the refspec fetch refuses;
            // try `merge --ff-only` in-place instead. (Git's exact wording
            // varies — "refusing to fetch into branch ... checked out".)
            let stderr_lc = stderr.to_lowercase();
            if stderr_lc.contains("refusing to fetch into")
                || stderr_lc.contains("checked out at")
            {
                let merge = Command::new("git")
                    .args(["merge", "--ff-only", &format!("origin/{}", base_branch)])
                    .current_dir(repo_path)
                    .output();
                match merge {
                    Ok(m) if m.status.success() => {
                        log::info!(
                            "[branch_manager] fast-forwarded checked-out {} to origin/{}",
                            base_branch,
                            base_branch
                        );
                    }
                    Ok(m) => {
                        log::warn!(
                            "[branch_manager] could not fast-forward checked-out {} (likely diverged): {}",
                            base_branch,
                            String::from_utf8_lossy(&m.stderr).trim()
                        );
                    }
                    Err(e) => {
                        log::warn!("[branch_manager] git merge --ff-only failed: {}", e);
                    }
                }
            } else {
                log::warn!(
                    "[branch_manager] could not fast-forward local {} (likely diverged): {}",
                    base_branch,
                    stderr
                );
            }
        }
        Err(e) => log::warn!("[branch_manager] could not run git fetch FF: {}", e),
    }
}

/// Create a task branch `bentoya/<slug>` from the base branch.
pub fn create_task_branch(
    repo_path: &str,
    task_slug: &str,
    base_branch: Option<&str>,
) -> Result<String, String> {
    create_task_branch_with_prefix(repo_path, task_slug, base_branch, DEFAULT_BRANCH_PREFIX)
}

/// Create a task branch using a caller-provided prefix.
pub fn create_task_branch_with_prefix(
    repo_path: &str,
    task_slug: &str,
    base_branch: Option<&str>,
    branch_prefix: &str,
) -> Result<String, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

    let base = match base_branch {
        Some(b) => b.to_string(),
        None => detect_base_branch(&repo).map_err(|e| e.to_string())?,
    };

    // Fetch + fast-forward the base branch before slicing the task branch off
    // it, so the task starts from fresh remote state instead of a stale local
    // ref. Best-effort: failures are logged and ignored.
    fetch_and_fastforward_base(repo_path, &base);

    let slug = slugify(task_slug);
    let prefix = normalize_branch_prefix(branch_prefix);
    let branch_name = format!("{}{}", prefix, slug);

    let base_ref = repo
        .find_branch(&base, BranchType::Local)
        .map_err(|e| format!("Base branch '{}' not found: {}", base, e))?;

    let commit = base_ref.get().peel_to_commit().map_err(|e| e.to_string())?;

    repo.branch(&branch_name, &commit, false)
        .map_err(|e| format!("Failed to create branch '{}': {}", branch_name, e))?;

    Ok(branch_name)
}

/// Return whether a local branch exists in the repository.
pub fn branch_exists(repo_path: &str, branch_name: &str) -> Result<bool, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let exists = repo.find_branch(branch_name, BranchType::Local).is_ok();
    Ok(exists)
}

fn is_working_tree_dirty(repo: &Repository) -> Result<bool, git2::Error> {
    let statuses = repo.statuses(None)?;
    Ok(!statuses.is_empty())
}

/// Checkout a branch with automatic stash/restore of uncommitted changes.
///
/// Flow:
/// 1. If working tree is dirty → stash with a tagged message
/// 2. Checkout target branch
/// 3. If a matching auto-stash exists for the target → pop it
pub fn switch_branch(repo_path: &str, branch: &str) -> Result<(), String> {
    let mut repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

    let current = get_current_branch_inner(&repo).unwrap_or_default();

    // Auto-stash if working tree is dirty
    if is_working_tree_dirty(&repo).map_err(|e| e.to_string())? {
        let sig = repo
            .signature()
            .or_else(|_| Signature::now("Bento-ya", "bentoya@local"))
            .map_err(|e| e.to_string())?;

        let message = format!("{}{}", AUTO_STASH_PREFIX, current);
        repo.stash_save(&sig, &message, Some(StashFlags::INCLUDE_UNTRACKED))
            .map_err(|e| format!("Failed to stash changes: {}", e))?;
    }

    // Checkout target branch — scope the borrow so `obj` is dropped before stash ops
    let ref_name = format!("refs/heads/{}", branch);
    {
        let obj = repo
            .revparse_single(&ref_name)
            .map_err(|e| format!("Branch '{}' not found: {}", branch, e))?;

        repo.checkout_tree(&obj, None)
            .map_err(|e| format!("Failed to checkout '{}': {}", branch, e))?;
    }

    repo.set_head(&ref_name)
        .map_err(|e| format!("Failed to set HEAD to '{}': {}", branch, e))?;

    // Auto-restore stash for target branch
    let stash_message = format!("{}{}", AUTO_STASH_PREFIX, branch);
    let mut stash_index: Option<usize> = None;

    repo.stash_foreach(|index, msg, _oid| {
        if msg == stash_message {
            stash_index = Some(index);
            return false; // stop iteration
        }
        true
    })
    .ok(); // no stashes is fine

    if let Some(idx) = stash_index {
        repo.stash_pop(idx, None)
            .map_err(|e| format!("Failed to restore stash: {}", e))?;
    }

    Ok(())
}

fn get_current_branch_inner(repo: &Repository) -> Result<String, String> {
    let head = repo.head().map_err(|e| e.to_string())?;
    Ok(head.shorthand().unwrap_or("HEAD").to_string())
}

/// Return the current branch name.
pub fn get_current_branch(repo_path: &str) -> Result<String, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    get_current_branch_inner(&repo)
}

/// List all branches matching the `bentoya/*` prefix.
pub fn list_task_branches(repo_path: &str) -> Result<Vec<BranchInfo>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let branches = repo
        .branches(Some(BranchType::Local))
        .map_err(|e| e.to_string())?;

    let head = repo.head().ok();
    let head_name = head.as_ref().and_then(|h| h.shorthand().map(String::from));

    let mut result = Vec::new();

    for branch_result in branches {
        let (branch, _) = branch_result.map_err(|e| e.to_string())?;
        let name = branch
            .name()
            .map_err(|e| e.to_string())?
            .unwrap_or("")
            .to_string();

        if name.starts_with(DEFAULT_BRANCH_PREFIX) {
            let upstream = branch
                .upstream()
                .ok()
                .and_then(|u| u.name().ok().flatten().map(String::from));

            result.push(BranchInfo {
                is_head: head_name.as_deref() == Some(name.as_str()),
                name,
                upstream,
            });
        }
    }

    Ok(result)
}

/// Delete a task branch. Returns `true` if the branch was unmerged (deleted anyway).
pub fn delete_task_branch(repo_path: &str, branch: &str) -> Result<bool, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

    let mut branch_ref = repo
        .find_branch(branch, BranchType::Local)
        .map_err(|e| format!("Branch '{}' not found: {}", branch, e))?;

    if branch_ref.is_head() {
        return Err("Cannot delete the currently checked out branch".to_string());
    }

    // Check if merged into the default base branch
    let base = detect_base_branch(&repo).unwrap_or_default();
    let is_unmerged = repo
        .find_branch(&base, BranchType::Local)
        .ok()
        .and_then(|base_branch| {
            let base_commit = base_branch.get().peel_to_commit().ok()?;
            let branch_commit = branch_ref.get().peel_to_commit().ok()?;
            let merge_base = repo.merge_base(base_commit.id(), branch_commit.id()).ok()?;
            Some(merge_base != branch_commit.id())
        })
        .unwrap_or(true);

    branch_ref.delete().map_err(|e| e.to_string())?;

    Ok(is_unmerged)
}

// ─── Worktree Operations ──────────────────────────────────────────────────

/// Git-internal worktree name (no slashes — git stores metadata at `.git/worktrees/<name>/`).
fn worktree_name(task_id: &str) -> String {
    format!("bentoya-{}", task_id)
}

/// On-disk worktree path: `<repo>/.worktrees/bentoya-<task_id>/`.
fn worktree_path(repo_path: &str, task_id: &str) -> PathBuf {
    PathBuf::from(repo_path)
        .join(".worktrees")
        .join(worktree_name(task_id))
}

/// Create a git worktree for a task, checked out to the given branch.
/// Returns the absolute path to the worktree directory.
///
/// Worktrees live at `<repo>/.worktrees/bentoya-<task_id>/` to keep
/// them out of the way while staying inside the repo root.
pub fn create_task_worktree(
    repo_path: &str,
    branch_name: &str,
    task_id: &str,
) -> Result<String, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

    let wt_name = worktree_name(task_id);
    let wt_path = worktree_path(repo_path, task_id);

    // Already exists — return the path
    if wt_path.exists() {
        return Ok(wt_path.to_string_lossy().to_string());
    }

    // Ensure parent dir exists
    if let Some(parent) = wt_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create worktree parent dir: {}", e))?;
    }

    // Refresh the local base branch from origin before resolving the task
    // branch. Best-effort — diverging local commits or missing remote just
    // log a warning and proceed with whatever local has.
    if let Ok(base) = detect_base_branch(&repo) {
        fetch_and_fastforward_base(repo_path, &base);
    }

    // Resolve the branch reference
    let branch = repo
        .find_branch(branch_name, BranchType::Local)
        .map_err(|e| format!("Branch '{}' not found: {}", branch_name, e))?;
    let reference = branch.into_reference();

    let mut opts = WorktreeAddOptions::new();
    opts.reference(Some(&reference));

    repo.worktree(&wt_name, &wt_path, Some(&opts))
        .map_err(|e| format!("Failed to create worktree: {}", e))?;

    // Ensure .worktrees/ is in .gitignore so worktrees don't show as untracked
    ensure_worktrees_gitignored(repo_path);

    Ok(wt_path.to_string_lossy().to_string())
}

/// Add `.worktrees/` to .gitignore if not already present.
fn ensure_worktrees_gitignored(repo_path: &str) {
    let gitignore_path = PathBuf::from(repo_path).join(".gitignore");
    let pattern = ".worktrees/";

    let contents = std::fs::read_to_string(&gitignore_path).unwrap_or_default();
    if contents.lines().any(|line| line.trim() == pattern) {
        return;
    }

    // Append to .gitignore
    let append = if contents.is_empty() || contents.ends_with('\n') {
        format!("{}\n", pattern)
    } else {
        format!("\n{}\n", pattern)
    };

    if let Err(e) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&gitignore_path)
        .and_then(|mut f| {
            use std::io::Write;
            f.write_all(append.as_bytes())
        })
    {
        log::warn!("Failed to add .worktrees/ to .gitignore: {}", e);
    }
}

/// Remove a task's worktree and clean up on disk.
pub fn remove_task_worktree(repo_path: &str, task_id: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

    let wt_name = worktree_name(task_id);
    let wt_path = worktree_path(repo_path, task_id);

    // Prune the worktree from git's tracking
    if let Ok(wt) = repo.find_worktree(&wt_name) {
        wt.prune(Some(
            git2::WorktreePruneOptions::new()
                .valid(true)
                .working_tree(true),
        ))
        .map_err(|e| format!("Failed to prune worktree: {}", e))?;
    }

    // Remove directory if it still exists
    if wt_path.exists() {
        std::fs::remove_dir_all(&wt_path)
            .map_err(|e| format!("Failed to remove worktree directory: {}", e))?;
    }

    Ok(())
}

/// Clean a worktree of uncommitted changes before a pipeline retry.
///
/// - `git checkout -- .` discards changes to tracked files
/// - `git clean -fd` removes untracked files and directories
/// - `.task.md` is deleted so the next trigger writes a fresh plan
///
/// Committed work on the branch is preserved. Returns a short summary of what
/// was cleaned for logging.
pub fn clean_worktree(worktree_path: &str) -> Result<String, String> {
    let path = std::path::Path::new(worktree_path);
    if !path.exists() {
        return Err(format!("Worktree path does not exist: {}", worktree_path));
    }

    let checkout = std::process::Command::new("git")
        .args(["checkout", "--", "."])
        .current_dir(path)
        .output()
        .map_err(|e| format!("Failed to run git checkout: {}", e))?;
    if !checkout.status.success() {
        let stderr = String::from_utf8_lossy(&checkout.stderr);
        // An empty worktree (no tracked changes to restore) can exit non-zero
        // with "did not match any file(s) known to git" — that's fine.
        if !stderr.contains("did not match any file") {
            return Err(format!("git checkout -- . failed: {}", stderr.trim()));
        }
    }

    let clean = std::process::Command::new("git")
        .args(["clean", "-fd"])
        .current_dir(path)
        .output()
        .map_err(|e| format!("Failed to run git clean: {}", e))?;
    if !clean.status.success() {
        let stderr = String::from_utf8_lossy(&clean.stderr);
        return Err(format!("git clean -fd failed: {}", stderr.trim()));
    }
    let removed = String::from_utf8_lossy(&clean.stdout).trim().to_string();

    let task_md = path.join(".task.md");
    let task_md_removed = if task_md.exists() {
        std::fs::remove_file(&task_md).map_err(|e| format!("Failed to remove .task.md: {}", e))?;
        true
    } else {
        false
    };

    let mut summary = Vec::new();
    if !removed.is_empty() {
        summary.push(format!("clean removed:\n{}", removed));
    }
    if task_md_removed {
        summary.push(".task.md deleted".to_string());
    }
    if summary.is_empty() {
        summary.push("no changes to clean".to_string());
    }
    Ok(summary.join("; "))
}

/// List all bentoya worktrees in a repo.
pub fn list_worktrees(repo_path: &str) -> Result<Vec<String>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

    let names = repo
        .worktrees()
        .map_err(|e| format!("Failed to list worktrees: {}", e))?;

    Ok(names
        .iter()
        .filter_map(|n| n.map(|s| s.to_string()))
        .filter(|name| name.starts_with("bentoya-"))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slugify_basic() {
        assert_eq!(slugify("Add User Auth"), "add-user-auth");
    }

    #[test]
    fn test_slugify_special_chars() {
        assert_eq!(slugify("fix: login bug!"), "fix-login-bug");
    }

    #[test]
    fn test_slugify_whitespace() {
        assert_eq!(slugify("  spaces  "), "spaces");
    }

    #[test]
    fn test_slugify_truncation() {
        let long_input = "a".repeat(60);
        assert_eq!(slugify(&long_input).len(), 50);
    }

    #[test]
    fn test_slugify_hyphens() {
        assert_eq!(slugify("foo---bar"), "foo-bar");
    }

    /// Initialize a minimal git repo at `path` with one committed file so
    /// `git checkout -- .` has a baseline to restore to.
    #[cfg(test)]
    fn init_test_repo(path: &std::path::Path) {
        use std::process::Command;
        Command::new("git")
            .args(["init", "-q", "-b", "main"])
            .current_dir(path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "init.defaultBranch", "main"])
            .current_dir(path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["init", "-q", "--initial-branch=main"])
            .current_dir(path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "commit.gpgsign", "false"])
            .current_dir(path)
            .output()
            .unwrap();
        std::fs::write(path.join("README.md"), "baseline\n").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-q", "-m", "init"])
            .current_dir(path)
            .output()
            .unwrap();
    }

    #[test]
    fn test_clean_worktree_removes_dirty_state() {
        let tmp = std::env::temp_dir().join(format!("bentoya-clean-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        init_test_repo(&tmp);

        // Dirty the tracked file, add an untracked file, and write .task.md
        std::fs::write(tmp.join("README.md"), "modified\n").unwrap();
        std::fs::write(tmp.join("scratch.txt"), "untracked\n").unwrap();
        std::fs::create_dir_all(tmp.join("build")).unwrap();
        std::fs::write(tmp.join("build/out.bin"), "junk\n").unwrap();
        std::fs::write(tmp.join(".task.md"), "old plan\n").unwrap();

        let summary = clean_worktree(tmp.to_str().unwrap()).expect("clean_worktree failed");

        // Tracked file restored
        assert_eq!(
            std::fs::read_to_string(tmp.join("README.md")).unwrap(),
            "baseline\n"
        );
        // Untracked file and directory removed
        assert!(!tmp.join("scratch.txt").exists());
        assert!(!tmp.join("build").exists());
        // .task.md removed
        assert!(!tmp.join(".task.md").exists());
        // Summary mentions what happened
        assert!(summary.contains(".task.md"));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_create_task_branch_with_custom_prefix() {
        let tmp =
            std::env::temp_dir().join(format!("bentoya-branch-prefix-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        init_test_repo(&tmp);

        let branch = create_task_branch_with_prefix(
            tmp.to_str().unwrap(),
            "Add Billing Flow",
            None,
            " feature ",
        )
        .expect("create_task_branch_with_prefix failed");

        assert_eq!(branch, "feature/add-billing-flow");

        let repo = Repository::open(&tmp).unwrap();
        assert!(repo.find_branch(&branch, BranchType::Local).is_ok());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_branch_exists_reports_local_branch_presence() {
        let tmp =
            std::env::temp_dir().join(format!("bentoya-branch-exists-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        init_test_repo(&tmp);

        let repo_path = tmp.to_str().unwrap();
        assert!(branch_exists(repo_path, "main").unwrap());
        assert!(!branch_exists(repo_path, "bentoya/missing-task").unwrap());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_clean_worktree_on_clean_repo_is_noop() {
        let tmp = std::env::temp_dir().join(format!("bentoya-clean-noop-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        init_test_repo(&tmp);

        let summary = clean_worktree(tmp.to_str().unwrap()).expect("clean_worktree failed");
        assert!(summary.contains("no changes"));
        assert_eq!(
            std::fs::read_to_string(tmp.join("README.md")).unwrap(),
            "baseline\n"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_clean_worktree_missing_path_errors() {
        let missing = std::env::temp_dir().join("bentoya-definitely-not-there-xyz");
        let _ = std::fs::remove_dir_all(&missing);
        let err = clean_worktree(missing.to_str().unwrap()).unwrap_err();
        assert!(err.contains("does not exist"));
    }

    /// Build a "stale local + fresh remote" scenario:
    /// 1. bare remote with one commit
    /// 2. consumer clone (stale) — has commit A
    /// 3. publisher clone pushes commit B to remote
    ///
    /// Returns `(consumer_path, fresh_remote_tip_sha)`.
    #[cfg(test)]
    fn setup_stale_local_fresh_remote(tag: &str) -> (std::path::PathBuf, String) {
        use std::process::Command;

        let root = std::env::temp_dir().join(format!(
            "bentoya-fetch-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let remote = root.join("remote.git");
        let publisher = root.join("publisher");
        let consumer = root.join("consumer");

        // Bare remote
        Command::new("git")
            .args(["init", "--bare", "-b", "main", remote.to_str().unwrap()])
            .output()
            .unwrap();

        // Publisher clone — seeds remote with commit A
        Command::new("git")
            .args([
                "clone",
                "-q",
                remote.to_str().unwrap(),
                publisher.to_str().unwrap(),
            ])
            .output()
            .unwrap();
        for (k, v) in [
            ("user.email", "test@example.com"),
            ("user.name", "Test"),
            ("commit.gpgsign", "false"),
            ("init.defaultBranch", "main"),
        ] {
            Command::new("git")
                .args(["config", k, v])
                .current_dir(&publisher)
                .output()
                .unwrap();
        }
        std::fs::write(publisher.join("README.md"), "A\n").unwrap();
        Command::new("git")
            .args(["checkout", "-q", "-b", "main"])
            .current_dir(&publisher)
            .output()
            .unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(&publisher)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-q", "-m", "A"])
            .current_dir(&publisher)
            .output()
            .unwrap();
        Command::new("git")
            .args(["push", "-q", "-u", "origin", "main"])
            .current_dir(&publisher)
            .output()
            .unwrap();

        // Consumer clone — captures the stale view
        Command::new("git")
            .args([
                "clone",
                "-q",
                remote.to_str().unwrap(),
                consumer.to_str().unwrap(),
            ])
            .output()
            .unwrap();
        for (k, v) in [
            ("user.email", "test@example.com"),
            ("user.name", "Test"),
            ("commit.gpgsign", "false"),
        ] {
            Command::new("git")
                .args(["config", k, v])
                .current_dir(&consumer)
                .output()
                .unwrap();
        }

        // Publisher pushes commit B — consumer is now stale
        std::fs::write(publisher.join("README.md"), "A\nB\n").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(&publisher)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-q", "-m", "B"])
            .current_dir(&publisher)
            .output()
            .unwrap();
        Command::new("git")
            .args(["push", "-q", "origin", "main"])
            .current_dir(&publisher)
            .output()
            .unwrap();

        let fresh_tip = String::from_utf8(
            Command::new("git")
                .args(["rev-parse", "HEAD"])
                .current_dir(&publisher)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();

        (consumer, fresh_tip)
    }

    #[test]
    fn test_fetch_and_fastforward_base_advances_stale_local() {
        let (consumer, fresh_tip) = setup_stale_local_fresh_remote("ff");

        // Sanity: consumer's local main is currently at the stale commit.
        let stale_tip = String::from_utf8(
            std::process::Command::new("git")
                .args(["rev-parse", "main"])
                .current_dir(&consumer)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();
        assert_ne!(
            stale_tip, fresh_tip,
            "consumer should start with stale local main"
        );

        fetch_and_fastforward_base(consumer.to_str().unwrap(), "main");

        let new_tip = String::from_utf8(
            std::process::Command::new("git")
                .args(["rev-parse", "main"])
                .current_dir(&consumer)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();

        assert_eq!(
            new_tip, fresh_tip,
            "local main should be fast-forwarded to fresh remote tip"
        );

        let _ = std::fs::remove_dir_all(consumer.parent().unwrap());
    }

    #[test]
    fn test_create_task_branch_starts_from_fresh_remote_main() {
        let (consumer, fresh_tip) = setup_stale_local_fresh_remote("branch");

        // Consumer's main starts stale; create_task_branch should fetch + FF
        // first so the new task branch is sliced off the fresh tip, not the
        // stale local view.
        let branch = create_task_branch(consumer.to_str().unwrap(), "Add Feature", None)
            .expect("create_task_branch failed");

        let branch_tip = String::from_utf8(
            std::process::Command::new("git")
                .args(["rev-parse", &branch])
                .current_dir(&consumer)
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();

        assert_eq!(
            branch_tip, fresh_tip,
            "task branch should be created from fresh remote main"
        );

        let _ = std::fs::remove_dir_all(consumer.parent().unwrap());
    }

    #[test]
    fn test_fetch_and_fastforward_base_no_remote_is_safe() {
        // Repo with no `origin` remote — fetch_and_fastforward_base must
        // log + return without panicking.
        let tmp = std::env::temp_dir().join(format!(
            "bentoya-fetch-noremote-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        init_test_repo(&tmp);

        fetch_and_fastforward_base(tmp.to_str().unwrap(), "main");

        // Repo still works
        assert!(branch_exists(tmp.to_str().unwrap(), "main").unwrap());

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
