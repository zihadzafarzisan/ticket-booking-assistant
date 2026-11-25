@echo off
setlocal EnableExtensions
title Cinebot - Bot ^& Web Dashboard
cd /d "%~dp0"

set "PORT=%BOT_PORT%"
if "%PORT%"=="" set "PORT=4317"
set "REBUILD=0"
set "OPEN_BROWSER=1"
if "%CINEBOT_NO_BROWSER%"=="1" set "OPEN_BROWSER=0"

:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--rebuild" set "REBUILD=1"
if /I "%~1"=="--no-browser" set "OPEN_BROWSER=0"
if /I "%~1"=="--port" (
  if not "%~2"=="" (
    set "PORT=%~2"
    shift
  )
)
shift
goto parse_args
:args_done

set "BOT_PORT=%PORT%"
set "DASHBOARD_URL=http://127.0.0.1:%PORT%"

echo ============================================================
echo   Cinebot - Star Cineplex 1s Drop Sniper ^& Web Dashboard
echo ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH. Install Node.js 22.12+ first.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [INFO] Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo [ERROR] Dependency install failed.
    pause
    exit /b 1
  )
)

rem Check if Cinebot is already running on this port
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri '%DASHBOARD_URL%/api/state' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  echo [INFO] Cinebot is already running at %DASHBOARD_URL%
  if "%OPEN_BROWSER%"=="1" (
    echo [INFO] Opening web dashboard...
    start "" "%DASHBOARD_URL%"
  )
  exit /b 0
)

if "%REBUILD%"=="1" goto do_build
if not exist "bot\dist\index.js" goto do_build
if not exist "dashboard\dist\index.html" goto do_build
goto start_server

:do_build
echo [INFO] Building bot and web dashboard...
call npm.cmd run build
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed. Fix build errors or run npm.cmd install first.
  pause
  exit /b 1
)

:start_server
echo [INFO] Starting Cinebot server and web dashboard on %DASHBOARD_URL%
echo [INFO] Press Ctrl+C in this window to stop the bot cleanly.
echo.

if "%OPEN_BROWSER%"=="1" (
  start "" /B powershell -NoProfile -WindowStyle Hidden -Command "$u='%DASHBOARD_URL%'; for($i=0;$i -lt 40;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri ($u + '/api/state') -TimeoutSec 1; if($r.StatusCode -eq 200){ Start-Process $u; break } } catch {}; Start-Sleep -Milliseconds 300 }"
)

node "bot\dist\index.js"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] Cinebot exited with code %EXIT_CODE%.
  pause
)
exit /b %EXIT_CODE%
