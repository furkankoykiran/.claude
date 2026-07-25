# nim-gateway.ps1 - Windows/PowerShell port of scripts/nim-gateway.sh.
# Runs the Anthropic-to-NVIDIA translating gateway that the `nvidia` provider
# (hosted build.nvidia.com catalog) needs.
#
#   pwsh scripts\nim-gateway.ps1 start    # install on first run, then serve on 127.0.0.1:4000
#   pwsh scripts\nim-gateway.ps1 stop
#   pwsh scripts\nim-gateway.ps1 status
#   pwsh scripts\nim-gateway.ps1 logs
#
# Why a gateway: Claude Code only speaks the Anthropic Messages API
# (/v1/messages). The hosted NVIDIA catalog is OpenAI-shaped and 404s on that
# path, so LiteLLM translates between the two. Self-hosted NIM containers serve
# /v1/messages natively - use `ccs nvidia-nim` for those and skip this script.
#
# LiteLLM is installed on demand into its own venv under cache\, NOT by
# install.ps1, so nobody pays for a dependency they don't use.
[CmdletBinding()]
param(
    [ArgumentCompleter({ @('start', 'stop', 'restart', 'status', 'logs') })]
    [string]$Command = 'status'
)

$ErrorActionPreference = 'Stop'

if (-not $env:CLAUDE_DIR) { $env:CLAUDE_DIR = Join-Path $HOME '.claude' }
$PDir    = Join-Path $env:CLAUDE_DIR 'providers'
$Config  = Join-Path $PDir 'nvidia-gateway.yaml'
$Example = Join-Path $PDir 'nvidia-gateway.yaml.example'
$RunDir  = Join-Path $env:CLAUDE_DIR 'cache\nim-gateway'
$Venv    = Join-Path $RunDir 'venv'
$PidFile = Join-Path $RunDir 'gateway.pid'
$LogFile = Join-Path $RunDir 'gateway.log'
$GwHost  = if ($env:NIM_GATEWAY_HOST) { $env:NIM_GATEWAY_HOST } else { '127.0.0.1' }
$GwPort  = if ($env:NIM_GATEWAY_PORT) { $env:NIM_GATEWAY_PORT } else { '4000' }
$LiteLlm = Join-Path $Venv 'Scripts\litellm.exe'

function Write-Step  { param($m) Write-Host "==> $m" -ForegroundColor Blue }
function Write-Warn { param($m) Write-Host "!! $m"  -ForegroundColor Yellow }
function Write-Die  { param($m) Write-Host "xx $m"  -ForegroundColor Red; exit 1 }

# The live gateway process, or $null. Verifies the recorded PID is still a
# python/litellm process so a stale pidfile never reads as running.
function Get-GatewayProcess {
    if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
    $raw = (Get-Content -LiteralPath $PidFile -Raw -ErrorAction SilentlyContinue)
    if (-not $raw) { return $null }
    $gwPid = 0
    if (-not [int]::TryParse($raw.Trim(), [ref]$gwPid)) { return $null }
    $proc = Get-Process -Id $gwPid -ErrorAction SilentlyContinue
    if (-not $proc) { return $null }
    if ($proc.ProcessName -notmatch 'litellm|python') { return $null }
    return $proc
}

function Test-GatewayHealth {
    try {
        Invoke-WebRequest -Uri "http://${GwHost}:${GwPort}/health/liveliness" `
            -TimeoutSec 3 -UseBasicParsing | Out-Null
        return $true
    } catch { return $false }
}

function Initialize-GatewayConfig {
    if (-not (Test-Path -LiteralPath $Config)) {
        if (-not (Test-Path -LiteralPath $Example)) { Write-Die "missing $Example" }
        Copy-Item -LiteralPath $Example -Destination $Config -Force
        Write-Step 'Seeded providers/nvidia-gateway.yaml from template'
    }
    if ((Get-Content -LiteralPath $Config -Raw) -match '<[A-Z_]+>') {
        Write-Die "providers/nvidia-gateway.yaml still has a placeholder (<...>). Put your build.nvidia.com key (nvapi-...) in $Config, then re-run."
    }
}

function Initialize-LiteLlm {
    if (Test-Path -LiteralPath $LiteLlm) { return }
    $py = Get-Command python -ErrorAction SilentlyContinue
    if (-not $py) { $py = Get-Command python3 -ErrorAction SilentlyContinue }
    if (-not $py) { Write-Die 'python is required to install the gateway (https://www.python.org/downloads/)' }
    Write-Step "Installing LiteLLM gateway into $Venv (one-time, a few minutes)"
    New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
    & $py.Source -m venv $Venv
    if ($LASTEXITCODE -ne 0) { Write-Die "could not create venv at $Venv" }
    $vpy = Join-Path $Venv 'Scripts\python.exe'
    & $vpy -m pip install --quiet --upgrade pip
    & $vpy -m pip install --quiet 'litellm[proxy]'
    if ($LASTEXITCODE -ne 0) { Write-Die "pip install 'litellm[proxy]' failed" }
    if (-not (Test-Path -LiteralPath $LiteLlm)) { Write-Die 'litellm did not install correctly' }
    Write-Step 'LiteLLM installed'
}

function Start-Gateway {
    $proc = Get-GatewayProcess
    if ($proc) {
        Write-Step "Gateway already running (pid $($proc.Id)) on ${GwHost}:${GwPort}"
        return
    }
    Initialize-GatewayConfig
    Initialize-LiteLlm
    New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
    Write-Step "Starting gateway on ${GwHost}:${GwPort}"
    $started = Start-Process -FilePath $LiteLlm `
        -ArgumentList @('--config', $Config, '--host', $GwHost, '--port', $GwPort) `
        -RedirectStandardOutput $LogFile -RedirectStandardError "$LogFile.err" `
        -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath $PidFile -Value $started.Id -NoNewline
    foreach ($i in 1..60) {
        if (Test-GatewayHealth) {
            Write-Step "Gateway up after ${i}s. Now run: ccs nvidia"
            return
        }
        if (-not (Get-GatewayProcess)) { break }
        Start-Sleep -Seconds 1
    }
    Write-Warn "Gateway did not answer on http://${GwHost}:${GwPort} within 60s. Last log lines:"
    if (Test-Path -LiteralPath $LogFile) { Get-Content -LiteralPath $LogFile -Tail 20 | Write-Host }
    exit 1
}

function Stop-Gateway {
    $proc = Get-GatewayProcess
    if (-not $proc) {
        Write-Step 'Gateway not running'
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        return
    }
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Step 'Gateway stopped'
}

function Get-GatewayStatus {
    $proc = Get-GatewayProcess
    if (-not $proc) {
        'nim-gateway: stopped'
        exit 1
    }
    if (Test-GatewayHealth) {
        "nim-gateway: running (pid $($proc.Id)) http://${GwHost}:${GwPort}"
    } else {
        "nim-gateway: process alive (pid $($proc.Id)) but not answering on ${GwHost}:${GwPort}"
        exit 1
    }
}

switch ($Command) {
    'start'   { Start-Gateway }
    'stop'    { Stop-Gateway }
    'restart' { Stop-Gateway; Start-Gateway }
    'status'  { Get-GatewayStatus }
    'logs'    {
        if (-not (Test-Path -LiteralPath $LogFile)) { Write-Die "no log at $LogFile" }
        Get-Content -LiteralPath $LogFile -Wait -Tail 40
    }
    default {
        @'
usage: nim-gateway.ps1 [start|stop|restart|status|logs]
  start     install on first run, then serve the Anthropic->NVIDIA gateway
  stop      stop the gateway
  restart   stop then start
  status    report whether the gateway is up (default)
  logs      follow the gateway log

env: NIM_GATEWAY_HOST (default 127.0.0.1), NIM_GATEWAY_PORT (default 4000)
'@ | Write-Host
        exit 1
    }
}
