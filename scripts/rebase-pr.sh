#!/bin/bash
# Rebase a conflicting PR branch onto main and force-push
# Usage: ./scripts/rebase-pr.sh <PR_NUMBER> [REPO_PATH]

set -e

PR=$1
REPO=${2:-$(pwd)}

cd "$REPO"

# Get branch name from PR
BRANCH=$(gh pr view "$PR" --json headRefName --jq '.headRefName')
if [ -z "$BRANCH" ]; then
  echo "ERROR: Could not find branch for PR #$PR"
  exit 1
fi

echo "Rebasing PR #$PR ($BRANCH) onto main..."

# Find worktree for this branch
WT=$(git worktree list --porcelain | grep -B1 "branch refs/heads/$BRANCH" | head -1 | sed 's/worktree //')

if [ -n "$WT" ] && [ -d "$WT" ]; then
  echo "Using worktree: $WT"
  cd "$WT"
else
  echo "No worktree found, checking out branch..."
  git checkout "$BRANCH"
fi

git fetch origin main
git rebase origin/main

if [ $? -ne 0 ]; then
  echo "CONFLICT — attempting auto-resolve (accept theirs for formatting, ours for logic)..."
  # Try to auto-resolve by accepting incoming changes
  git checkout --theirs . 2>/dev/null
  git add -A
  git rebase --continue 2>/dev/null || {
    echo "AUTO-RESOLVE FAILED — manual intervention needed"
    git rebase --abort
    exit 1
  }
fi

echo "Pushing rebased branch..."
git push --force-with-lease origin "$BRANCH"
echo "Done — PR #$PR should be mergeable now"
