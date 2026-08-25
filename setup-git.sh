#!/usr/bin/env bash
# =============================================================================
# setup-git.sh — one-time setup for github.com/mudassirishfaq94/expensetracker
# Initialises the repo, creates a clean per-feature commit history, and pushes.
# Run from anywhere:  bash setup-git.sh   (or ./setup-git.sh after chmod +x)
# =============================================================================
set -e
REMOTE="https://github.com/mudassirishfaq94/expensetracker.git"

# work from the folder this script lives in
cd "$(dirname "$0")"

command -v git >/dev/null 2>&1 || { echo "!! git is not installed or not on PATH."; exit 1; }

# 1. init (safe to re-run)
[ -d .git ] || git init
git branch -M main

# 2. make sure a commit identity exists (local to this repo, non-destructive)
if [ -z "$(git config user.email)" ]; then
  git config user.email "you@example.com"
  git config user.name  "Your Name"
  echo ">> A placeholder git identity was set for this repo."
  echo "   Update it with:"
  echo "     git config user.email \"you@real.com\" && git config user.name \"Your Name\""
fi

# 3. point origin at the GitHub repo
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE"
else
  git remote add origin "$REMOTE"
fi

# 4. staged, logical commits (each is skipped cleanly if nothing changed)
stage_commit () { git add -- $1 && git commit -m "$2" >/dev/null 2>&1 || true; }

stage_commit ".gitignore README.md"       "chore: add README and gitignore"
stage_commit "index.html css/style.css"   "feat: HTML shell and warm-fintech design system"
stage_commit "js/storage.js"              "feat: localStorage persistence layer and sample data"
stage_commit "js/expenses.js"             "feat: expense CRUD, filtering, and dashboard statistics"
stage_commit "js/ui.js"                   "feat: dashboard, list, drawer, modal and toast rendering"
stage_commit "js/app.js"                  "feat: bootstrap, routing, validation and interactions"
git add -A && git commit -m "chore: remaining project files" >/dev/null 2>&1 || true

# 5. push
echo ">> Pushing to $REMOTE ..."
if ! git push -u origin main; then
  echo ""
  echo "!! Push was rejected. The most common cause is that the GitHub repo"
  echo "   already has commits (e.g. an initial README created on GitHub)."
  echo "   To reconcile:  git pull --rebase origin main   then   git push -u origin main"
  echo "   (Or, if you are certain you want your local version to win:"
  echo "    git push -u origin main --force )"
  exit 1
fi
echo ">> Done. History pushed to main."
