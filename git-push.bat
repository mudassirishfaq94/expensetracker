@echo off
REM ===========================================================================
REM git-push.bat - commit every change and push (use on each future edit)
REM Usage:  git-push.bat "describe what changed"
REM ===========================================================================
setlocal
cd /d "%~dp0"
set "MSG=%~1"
if "%MSG%"=="" set "MSG=update: work in progress"
git add -A
git commit -m "%MSG%"
if errorlevel 1 (
  echo Nothing to commit.
  pause
  exit /b 0
)
git push
echo Pushed: %MSG%
pause
