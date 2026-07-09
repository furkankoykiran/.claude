# cc-provider.ps1 — Windows/PowerShell port of bin/cc-provider.
# Switches the Claude Code API provider by COPYING a provider file to
# $HOME/.claude/settings.json (copy, not symlink, so it works on Windows).
#
#   pwsh cc-provider.ps1 zai          -> activate z.ai (GLM)
#   pwsh cc-provider.ps1 anthropic    -> activate official Anthropic
#   pwsh cc-provider.ps1 status       -> print the active provider
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
  [ArgumentCompleter({ @('zai', 'anthropic', 'status') })]
  [string]$Command = 'status'
)

$ErrorActionPreference = 'Stop'

if (-not $env:CLAUDE_DIR) { $env:CLAUDE_DIR = Join-Path $HOME '.claude' }
$PDir     = Join-Path $env:CLAUDE_DIR 'providers'
$Settings = Join-Path $env:CLAUDE_DIR 'settings.json'
$Active   = Join-Path $PDir '.active'

function Ensure-Provider($p) {
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

function Activate($p) {
  Ensure-Provider $p
  if (-not (Test-Path $PDir)) { New-Item -ItemType Directory -Path $PDir | Out-Null }
  Set-Content -LiteralPath $Active -Value $p -NoNewline
  if (Test-Path -LiteralPath $Settings) { Remove-Item -LiteralPath $Settings -Force }
  Copy-Item -LiteralPath (Join-Path $PDir "$p.json") -Destination $Settings -Force
  "Active provider: $p"
  "Restart Claude Code for the change to take effect (env is read at startup)."
}

switch ($Command) {
  'zai'       { Activate 'zai' }
  'anthropic' { Activate 'anthropic' }
  'status'    {
    if (Test-Path -LiteralPath $Active) { (Get-Content -LiteralPath $Active -Raw).Trim() }
    else { 'none (provider system not active; settings.json is whatever install.sh seeded)' }
  }
  default {
    "usage: cc-provider.ps1 [zai|anthropic|status]" | Write-Host
    exit 1
  }
}
