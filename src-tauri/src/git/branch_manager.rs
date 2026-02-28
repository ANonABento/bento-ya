use git2::{BranchType, Repository, Signature, StashFlags};
use serde::Serialize;

const BRANCH_PREFIX: &str = "bentoya/";
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
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
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

/// Create a task branch `bentoya/<slug>` from the base branch.
pub fn create_task_branch(
    repo_path: &str,
    task_slug: &str,
    base_branch: Option<&str>,
) -> Result<String, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

    let base = match base_branch {
        Some(b) => b.to_string(),
        None => detect_base_branch(&repo).map_err(|e| e.to_string())?,
    };

    let slug = slugify(task_slug);
    let branch_name = format!("{}{}", BRANCH_PREFIX, slug);

    let base_ref = repo
        .find_branch(&base, BranchType::Local)
        .map_err(|e| format!("Base branch '{}' not found: {}", base, e))?;

    let commit = base_ref
        .get()
        .peel_to_commit()
        .map_err(|e| e.to_string())?;

    repo.branch(&branch_name, &commit, false)
        .map_err(|e| format!("Failed to create branch '{}': {}", branch_name, e))?;

    Ok(branch_name)
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
    let head_name = head
        .as_ref()
        .and_then(|h| h.shorthand().map(String::from));

    let mut result = Vec::new();

    for branch_result in branches {
        let (branch, _) = branch_result.map_err(|e| e.to_string())?;
        let name = branch
            .name()
            .map_err(|e| e.to_string())?
            .unwrap_or("")
            .to_string();

        if name.starts_with(BRANCH_PREFIX) {
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
}
