[CmdletBinding()]
param(
    [int]$Port = $(if ($env:BOT_PORT) { [int]$env:BOT_PORT } else { 4317 }),
    [switch]$Rebuild,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$Host.UI.RawUI.WindowTitle = "Cinebot - Bot & Web Dashboard"
$env:BOT_PORT = "$Port"
$dashboardUrl = "http://127.0.0.1:$Port"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Cinebot - Star Cineplex 1s Drop Sniper & Web Dashboard" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js was not found in PATH. Install Node.js 22.12+ first." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path -LiteralPath "node_modules")) {
    Write-Host "[INFO] Installing dependencies..." -ForegroundColor Yellow
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Dependency install failed." -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

function Test-CinebotReady {
    param([string]$Url)
    try {
        $resp = Invoke-WebRequest -UseBasicParsing -Uri "$Url/api/state" -TimeoutSec 2
        return ($resp.StatusCode -eq 200)
    } catch {
        return $false
    }
}

if (Test-CinebotReady -Url $dashboardUrl) {
    Write-Host "[INFO] Cinebot is already running at $dashboardUrl" -ForegroundColor Green
    if (-not $NoBrowser -and $env:CINEBOT_NO_BROWSER -ne "1") {
        Write-Host "[INFO] Opening web dashboard..." -ForegroundColor Green
        Start-Process $dashboardUrl
    }
    exit 0
}

$needsBuild = $Rebuild -or (-not (Test-Path -LiteralPath "bot\dist\index.js")) -or (-not (Test-Path -LiteralPath "dashboard\dist\index.html"))
if ($needsBuild) {
    Write-Host "[INFO] Building bot and web dashboard..." -ForegroundColor Yellow
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Build failed." -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

Write-Host "[INFO] Starting Cinebot server and web dashboard on $dashboardUrl" -ForegroundColor Green
Write-Host "[INFO] Press Ctrl+C in this terminal to stop the bot cleanly." -ForegroundColor DarkGray
Write-Host ""

if (-not $NoBrowser -and $env:CINEBOT_NO_BROWSER -ne "1") {
    $opener = "`$u='$dashboardUrl'; for(`$i=0;`$i -lt 40;`$i++){ try { `$r=Invoke-WebRequest -UseBasicParsing -Uri (`$u + '/api/state') -TimeoutSec 1; if(`$r.StatusCode -eq 200){ Start-Process `$u; break } } catch {}; Start-Sleep -Milliseconds 300 }"
    Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-Command", $opener) | Out-Null
}

& node "bot\dist\index.js"
exit $LASTEXITCODE
