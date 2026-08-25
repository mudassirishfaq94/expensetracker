@echo off
REM ===========================================================================
REM setup-git.bat - one-time setup for github.com/mudassirishfaq94/expensetracker
REM Initialises the repo, creates a per-feature commit history, and pushes.
REM Double-click this file, or run it from a terminal in this folder.
REM ===========================================================================
setlocal
set "REMOTE=https://github.com/mudassirishfaq94/expensetracker.git"
cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
  echo !! git is not installed or not on PATH.
  pause
  exit /b 1
)

REM 1. init (safe to re-run)
if not exist ".git" git init
git branch -M main

REM 2. ensure a commit identity exists (local to this repo)
set "EMAIL="
for /f "delims=" %%i in ('git config user.email 2^>nul') do set "EMAIL=%%i"
if "%EMAIL%"=="" (
  git config user.email "you@example.com"
  git config user.name  "Your Name"
  echo.
  echo ^>^> A placeholder git identity was set for this repo.
  echo    Update it with:
  echo      git config user.email "you@real.com"
  echo      git config user.name  "Your Name"
  echo.
)

REM 3. point origin at the GitHub repo
git remote get-url origin >nul 2>&1
if errorlevel 1 (
  git remote add origin %REMOTE%
) else (
  git remote set-url origin %REMOTE%
)

REM 4. staged, logical commits (a failed commit = nothing to commit, harmless)
git add .gitignore README.md
git commit -m "chore: add README and gitignore" >nul 2>&1
git add index.html css\style.css
git commit -m "feat: HTML shell and warm-fintech design system" >nul 2>&1
git add js\storage.js
git commit -m "feat: localStorage persistence layer and sample data" >nul 2>&1
git add js\expenses.js
git commit -m "feat: expense CRUD, filtering, and dashboard statistics" >nul 2>&1
git add js\ui.js
git commit -m "feat: dashboard, list, drawer, modal and toast rendering" >nul 2>&1
git add js\app.js
git commit -m "feat: bootstrap, routing, validation and interactions" >nul 2>&1
git add -A
git commit -m "chore: remaining project files" >nul 2>&1

REM 5. push
echo ^>^> Pushing to %REMOTE% ...
git push -u origin main
if errorlevel 1 (
  echo.
  echo !! Push was rejected. Most likely the GitHub repo already has commits.
  echo    To reconcile:  git pull --rebase origin main   then   git push -u origin main
  echo    Or to overwrite remote with your local version:  git push -u origin main --force
  pause
  exit /b 1
)
echo ^>^> Done. History pushed to main.
pause
