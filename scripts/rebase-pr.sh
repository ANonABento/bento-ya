#!/usr/bin/env bash
# Rebase a PR branch onto its base branch with guarded conflict handling.
# Usage: ./scripts/rebase-pr.sh <PR_NUMBER> [REPO_PATH]

set -Eeuo pipefail

PR=${1:-}
REPO=${2:-$(pwd)}

if [ -z "$PR" ]; then
  echo "Usage: $0 <PR_NUMBER> [REPO_PATH]" >&2
  exit 64
fi

cd "$REPO"

sql_quote() {
  printf "%s" "$1" | sed "s/'/''/g"
}

safe_branch_name() {
  printf "%s" "$1" | tr '/[:space:]' '__'
}

unmerged_files() {
  git diff --name-only --diff-filter=U
}

has_unmerged_files() {
  [ -n "$(unmerged_files)" ]
}

typecheck_command() {
  if [ -n "${BENTOYA_TYPECHECK_CMD:-}" ]; then
    printf "%s" "$BENTOYA_TYPECHECK_CMD"
  elif [ -f package.json ]; then
    printf "%s" "npx tsc --noEmit"
  elif [ -f Cargo.toml ]; then
    printf "%s" "cargo check"
  fi
}

run_typecheck() {
  local cmd
  cmd=$(typecheck_command)
  if [ -z "$cmd" ]; then
    echo "No type-check command found; refusing to treat conflicts as formatting-only."
    return 1
  fi

  echo "Running type-check: $cmd"
  bash -lc "$cmd"
}

mark_needs_manual_review() {
  local reason=$1
  local git_dir status_dir marker safe_branch now db_path branch_sql reason_sql task_sql updated

  git_dir=$(git rev-parse --git-common-dir)
  status_dir="$git_dir/bentoya"
  safe_branch=$(safe_branch_name "$BRANCH")
  marker="$status_dir/needs-manual-review-$safe_branch.txt"
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  mkdir -p "$status_dir"
  {
    printf "state=needs-manual-review\n"
    printf "pr=%s\n" "$PR"
    printf "branch=%s\n" "$BRANCH"
    printf "base=%s\n" "$BASE_BRANCH"
    printf "worktree=%s\n" "$(pwd)"
    printf "time=%s\n" "$now"
    printf "reason=%s\n" "$reason"
    printf "conflicts=\n"
    unmerged_files
  } > "$marker"

  db_path=${BENTOYA_DB_PATH:-"$HOME/.bentoya/data.db"}
  if command -v sqlite3 >/dev/null 2>&1 && [ -f "$db_path" ]; then
    branch_sql=$(sql_quote "$BRANCH")
    reason_sql=$(sql_quote "needs-manual-review: $reason")
    task_sql=$(sql_quote "${BENTOYA_TASK_ID:-}")

    if [ -n "${BENTOYA_TASK_ID:-}" ]; then
      updated=$(
        sqlite3 "$db_path" \
          "PRAGMA busy_timeout=5000;
           UPDATE tasks
           SET review_status = 'needs-manual-review',
               agent_status = 'needs_attention',
               pipeline_state = 'idle',
               pipeline_triggered_at = NULL,
               pipeline_error = '$reason_sql',
               updated_at = '$now'
           WHERE id = '$task_sql' OR branch_name = '$branch_sql';
           SELECT changes();" | tail -n 1
      )
    else
      updated=$(
        sqlite3 "$db_path" \
          "PRAGMA busy_timeout=5000;
           UPDATE tasks
           SET review_status = 'needs-manual-review',
               agent_status = 'needs_attention',
               pipeline_state = 'idle',
               pipeline_triggered_at = NULL,
               pipeline_error = '$reason_sql',
               updated_at = '$now'
           WHERE branch_name = '$branch_sql';
           SELECT changes();" | tail -n 1
      )
    fi

    echo "Marked $updated task(s) as needs-manual-review in $db_path"
  else
    echo "Wrote needs-manual-review marker: $marker"
  fi
}

abort_rebase_if_active() {
  if [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]; then
    git rebase --abort >/dev/null 2>&1 || true
  fi
}

abort_merge_if_active() {
  if [ -f "$(git rev-parse --git-path MERGE_HEAD)" ]; then
    git merge --abort >/dev/null 2>&1 || true
  fi
}

fail_manual() {
  local reason=$1
  echo "NEEDS MANUAL REVIEW: $reason"
  mark_needs_manual_review "$reason"
  exit 2
}

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: Working tree has uncommitted changes. Commit or stash them before rebasing." >&2
  exit 1
fi

BRANCH=$(gh pr view "$PR" --json headRefName --jq '.headRefName')
BASE_BRANCH=${BENTOYA_BASE_BRANCH:-$(gh pr view "$PR" --json baseRefName --jq '.baseRefName')}

if [ -z "$BRANCH" ]; then
  echo "ERROR: Could not find branch for PR #$PR" >&2
  exit 1
fi

if [ -z "$BASE_BRANCH" ]; then
  BASE_BRANCH=main
fi

echo "Updating PR #$PR ($BRANCH) against $BASE_BRANCH..."

WT=$(git worktree list --porcelain | awk -v branch="refs/heads/$BRANCH" '
  /^worktree / { worktree = substr($0, 10) }
  $0 == "branch " branch { print worktree; exit }
')

if [ -n "$WT" ] && [ -d "$WT" ]; then
  echo "Using worktree: $WT"
  cd "$WT"
else
  echo "No worktree found, checking out branch..."
  git checkout "$BRANCH"
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: PR worktree has uncommitted changes. Commit or stash them before rebasing." >&2
  exit 1
fi

git fetch origin "$BASE_BRANCH"

echo "Trying clean rebase onto origin/$BASE_BRANCH..."
if git rebase "origin/$BASE_BRANCH"; then
  echo "Clean rebase succeeded; pushing with force-with-lease..."
  git push --force-with-lease origin "$BRANCH"
  echo "Done - PR #$PR should be mergeable now"
  exit 0
fi

if ! has_unmerged_files; then
  abort_rebase_if_active
  fail_manual "Clean rebase failed without merge conflicts; refusing automatic recovery."
fi

echo "Rebase hit conflicts; aborting rebase and trying an ort merge."
abort_rebase_if_active

if git merge --no-edit -s ort "origin/$BASE_BRANCH"; then
  echo "ort merge succeeded; validating before push..."
  if ! run_typecheck; then
    fail_manual "ort merge completed, but type-check failed."
  fi

  echo "Pushing merge commit..."
  git push origin "$BRANCH"
  echo "Done - PR #$PR should be mergeable now"
  exit 0
fi

if ! has_unmerged_files; then
  abort_merge_if_active
  fail_manual "ort merge failed without merge conflicts; refusing automatic recovery."
fi

echo "ort merge still has conflicts; trying --theirs only as a type-checked formatting fallback."
CONFLICT_FILES=()
while IFS= read -r file; do
  CONFLICT_FILES+=("$file")
done < <(unmerged_files)

if [ "${#CONFLICT_FILES[@]}" -eq 0 ]; then
  abort_merge_if_active
  fail_manual "No conflict files were available for guarded fallback."
fi

git checkout --theirs -- "${CONFLICT_FILES[@]}"
git add -A -- "${CONFLICT_FILES[@]}"

if ! run_typecheck; then
  reason="--theirs conflict resolution failed type-check; not pushing."
  mark_needs_manual_review "$reason"
  abort_merge_if_active
  echo "NEEDS MANUAL REVIEW: $reason"
  exit 2
fi

echo "Type-check passed after --theirs resolution; treating conflicts as formatting-only."
git commit --no-edit
git push origin "$BRANCH"
echo "Done - PR #$PR should be mergeable now"
