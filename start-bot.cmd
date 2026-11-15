@echo off
setlocal
cd /d "%~dp0"
echo Building Cinebot...
call npm.cmd run build
if errorlevel 1 (
  echo Build failed. Install dependencies with npm.cmd install first.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:4317 in your browser.
call npm.cmd start
if errorlevel 1 pause
