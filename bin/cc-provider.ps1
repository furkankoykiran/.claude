# cc-provider.ps1 - Windows/PowerShell port of bin/cc-provider.
# Switches the Claude Code API provider by COPYING a provider file to
# $HOME/.claude/settings.json (copy, not symlink, so it works on Windows).
#
#   pwsh cc-provider.ps1 anthropic    -> activate official Anthropic
#   pwsh cc-provider.ps1 zai          -> activate z.ai (GLM)
#   pwsh cc-provider.ps1 list         -> list every available provider
#   pwsh cc-provider.ps1 status       -> print the active provider
#
# The provider set is DATA, not code: whatever providers\<name>.json.example
# templates exist are the valid names, so adding a provider means dropping in a
# template - no edits here, in install.sh, or in install.ps1.
#
# Optional shell function for $PROFILE so you can type `ccs`:
#   function ccs { & "$HOME\.claude\bin\cc-provider.ps1" @args }
#
# Provider files (providers\<name>.json) are local and gitignored (auth tokens
# live here). Templates (providers\<name>.json.example) are committed with a
# <ZAI_TOKEN>-style placeholder. providers\.active records the choice.
# Restart Claude Code after switching (env is read at startup).
[CmdletBinding()]
param(
  [string]$Command = 'status'
)

$ErrorActionPreference = 'Stop'

if (-not $env:CLAUDE_DIR) { $env:CLAUDE_DIR = Join-Path $HOME '.claude' }
$PDir     = Join-Path $env:CLAUDE_DIR 'providers'
$Settings = Join-Path $env:CLAUDE_DIR 'settings.json'
$Active   = Join-Path $PDir '.active'

# Provider names: every .json.example template, plus any local .json a user
# added by hand. Sorted and de-duplicated.
function Get-ProviderList {
  $names = @()
  foreach ($f in Get-ChildItem -LiteralPath $PDir -Filter '*.json.example' -ErrorAction SilentlyContinue) {
    $names += ($f.Name -replace '\.json\.example$', '')
  }
  foreach ($f in Get-ChildItem -LiteralPath $PDir -Filter '*.json' -ErrorAction SilentlyContinue) {
    $names += ($f.Name -replace '\.json$', '')
  }
  return $names | Sort-Object -Unique
}

function Initialize-Provider($p) {
  $f = Join-Path $PDir "$p.json"
  if (-not (Test-Path -LiteralPath $f)) {
    $ex = Join-Path $PDir "$p.json.example"
    if (Test-Path -LiteralPath $ex) {
      Copy-Item -LiteralPath $ex -Destination $f -Force
      "Created providers/$p.json from template." | Write-Host
    } else {
      throw "no providers/$p.json or $p.json.example to seed from"
    }
  }
  if ((Get-Content -LiteralPath $f -Raw) -match '<[A-Z_]+>') {
    "WARNING: providers/$p.json still has placeholder values (<...>)." | Write-Host
    "Edit it and fill your real token before relying on this provider." | Write-Host
  }
}

# Providers that point at a loopback base URL (the NVIDIA gateway, a self-hosted
# NIM container, a local Ollama) are dead until that listener is up, and the
# symptom in Claude Code is an opaque connection error. Warn at switch time
# instead. Best-effort: a parse miss just skips the check.
function Write-WarningIfLocalEndpointDown($p) {
  $f = Join-Path $PDir "$p.json"
  if (-not (Test-Path -LiteralPath $f)) { return }
  $m = [regex]::Match((Get-Content -LiteralPath $f -Raw), '"ANTHROPIC_BASE_URL"\s*:\s*"([^"]*)"')
  if (-not $m.Success) { return }
  try { $uri = [Uri]$m.Groups[1].Value } catch { return }
  if ($uri.Host -notin @('127.0.0.1', 'localhost', '0.0.0.0')) { return }
  $ok = $false
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $ok = $client.ConnectAsync($uri.Host, $uri.Port).Wait(1500)
  } catch { $ok = $false } finally { if ($client) { $client.Dispose() } }
  if (-not $ok) {
    "WARNING: nothing is listening on $($uri.Host):$($uri.Port), which providers/$p.json points at." | Write-Host
    if ($p -eq 'nvidia') {
      "Start the gateway first: pwsh $env:CLAUDE_DIR\scripts\nim-gateway.ps1 start" | Write-Host
    }
  }
}

function Enable-Provider($p) {
  Initialize-Provider $p
  if (-not (Test-Path $PDir)) { New-Item -ItemType Directory -Path $PDir | Out-Null }
  Set-Content -LiteralPath $Active -Value $p -NoNewline
  if (Test-Path -LiteralPath $Settings) { Remove-Item -LiteralPath $Settings -Force }
  Copy-Item -LiteralPath (Join-Path $PDir "$p.json") -Destination $Settings -Force
  "Active provider: $p"
  Write-WarningIfLocalEndpointDown $p
  "Restart Claude Code for the change to take effect (env is read at startup)."
}

function Show-Usage {
  "usage: cc-provider.ps1 [<provider>|list|status]" | Write-Host
  "  <provider>  activate it (copies providers\<provider>.json to settings.json)" | Write-Host
  "  list        list available providers" | Write-Host
  "  status      print the active provider (default)" | Write-Host
  "" | Write-Host
  "available providers:" | Write-Host
  foreach ($p in Get-ProviderList) { "  $p" | Write-Host }
}

switch ($Command) {
  'status' {
    if (-not (Test-Path -LiteralPath $Active)) {
      'none (provider system not active; settings.json is whatever install.sh seeded)'
      return
    }
    $a = (Get-Content -LiteralPath $Active -Raw).Trim()
    $a
    # Surface the common footgun: settings.json is a COPY, so editing the
    # provider file (or a stale switch) leaves it out of sync -> silent 401.
    $pf = Join-Path $PDir "$a.json"
    if (Test-Path -LiteralPath $pf) {
      if ((Test-Path -LiteralPath $Settings) -and ((Get-Content -LiteralPath $pf -Raw) -ne (Get-Content -LiteralPath $Settings -Raw))) {
        "WARNING: settings.json differs from providers/$a.json - re-run: ccs $a" | Write-Host
      }
      if ((Get-Content -LiteralPath $pf -Raw) -match '<[A-Z_]+>') {
        "WARNING: providers/$a.json still has a placeholder (<...>) - fill your token, then: ccs $a" | Write-Host
      }
      Write-WarningIfLocalEndpointDown $a
    }
  }
  'list' { Get-ProviderList }
  default {
    if ($Command -and ((Get-ProviderList) -contains $Command)) {
      Enable-Provider $Command
    } else {
      if ($Command) { "cc-provider.ps1: unknown provider: $Command" | Write-Host; '' | Write-Host }
      Show-Usage
      exit 1
    }
  }
}
