use std::collections::{HashMap, HashSet};

use git2::{BranchType, Repository};
use serde::Serialize;

use super::change_tracker::get_files_touched;

const BRANCH_PREFIX: &str = "bentoya/";

#[derive(Debug, Serialize)]
pub struct ConflictEntry {
    pub file: String,
    pub branches: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ConflictMatrix {
    pub conflicts: Vec<ConflictEntry>,
    pub has_conflicts: bool,
}

/// Compare all active `bentoya/*` branches and return files that are modified
/// by more than one branch (potential merge conflicts).
pub fn get_conflict_matrix(repo_path: &str) -> Result<ConflictMatrix, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    let branches = repo
        .branches(Some(BranchType::Local))
        .map_err(|e| e.to_string())?;

    // Collect all bentoya/* branch names
    let mut task_branches = Vec::new();
    for branch_result in branches {
        let (branch, _) = branch_result.map_err(|e| e.to_string())?;
        let name = branch
            .name()
            .map_err(|e| e.to_string())?
            .unwrap_or("")
            .to_string();
        if name.starts_with(BRANCH_PREFIX) {
            task_branches.push(name);
        }
    }

    // Build file → set of branches map
    let mut file_map: HashMap<String, HashSet<String>> = HashMap::new();

    for branch_name in &task_branches {
        match get_files_touched(repo_path, branch_name) {
            Ok(files) => {
                for file in files {
                    file_map
                        .entry(file)
                        .or_default()
                        .insert(branch_name.clone());
                }
            }
            Err(_) => continue,
        }
    }

    // Filter to files touched by 2+ branches
    let mut conflicts: Vec<ConflictEntry> = file_map
        .into_iter()
        .filter(|(_, branches)| branches.len() > 1)
        .map(|(file, branches)| {
            let mut branch_list: Vec<String> = branches.into_iter().collect();
            branch_list.sort();
            ConflictEntry {
                file,
                branches: branch_list,
            }
        })
        .collect();

    conflicts.sort_by(|a, b| a.file.cmp(&b.file));
    let has_conflicts = !conflicts.is_empty();

    Ok(ConflictMatrix {
        conflicts,
        has_conflicts,
    })
}
