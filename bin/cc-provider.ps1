# cc-provider.ps1 - Windows/PowerShell port of bin/cc-provider.
# Switches the Claude Code API provider by MERGING a provider file into
# $HOME/.claude/settings.json (a real file, not a symlink, so it works on
# Windows). Merge order, lowest precedence first: the existing settings.json
# (carried over) <- settings.base.json <- the provider file.
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
$BaseSettings = Join-Path $env:CLAUDE_DIR 'settings.base.json'
$Active   = Join-Path $PDir '.active'

# Keys the ACTIVE PROVIDER owns outright; see bin/cc-provider for the rationale.
# Kept identical to the bash list on purpose - the two ports must not disagree
# about which keys a switch is allowed to carry over.
$ProviderKeys = @('env', 'model', 'apiKeyHelper', 'enabledPlugins', 'effortLevel')

function Read-JsonMap($path) {
  if (-not (Test-Path -LiteralPath $path)) { return @{} }
  $raw = Get-Content -LiteralPath $path -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) { return @{} }
  return (ConvertFrom-Json $raw -AsHashtable)
}

# Recursive object merge; $upper wins. Arrays are replaced, not concatenated -
# deny/allow and hooks are unioned explicitly by the caller instead.
function Merge-Map($lower, $upper) {
  $out = @{}
  foreach ($k in $lower.Keys) { $out[$k] = $lower[$k] }
  foreach ($k in $upper.Keys) {
    if ($out.ContainsKey($k) -and ($out[$k] -is [hashtable]) -and ($upper[$k] -is [hashtable])) {
      $out[$k] = Merge-Map $out[$k] $upper[$k]
    } else {
      $out[$k] = $upper[$k]
    }
  }
  return $out
}

# PowerShell hashtables enumerate in unspecified order, so serialising two
# equal maps can produce two different strings. Sort keys recursively before
# comparing, or `status` reports drift on a settings.json it just wrote.
function ConvertTo-CanonicalObject($value) {
  if ($value -is [hashtable] -or $value -is [System.Collections.Specialized.OrderedDictionary]) {
    $sorted = [ordered]@{}
    foreach ($k in ($value.Keys | Sort-Object)) { $sorted[$k] = ConvertTo-CanonicalObject $value[$k] }
    return $sorted
  }
  if ($value -is [System.Collections.IEnumerable] -and $value -isnot [string]) {
    return @(foreach ($v in $value) { ConvertTo-CanonicalObject $v })
  }
  return $value
}

function Join-UniqueList($lists) {
  $out = [System.Collections.ArrayList]::new()
  foreach ($l in $lists) {
    foreach ($v in @($l)) {
      if ($null -ne $v -and -not $out.Contains($v)) { $null = $out.Add($v) }
    }
  }
  return , $out.ToArray()
}

# Union hook handlers across layers, deduped by (matcher, command) and kept in
# layer order, regrouped under one group per matcher.
function Merge-HookMap($layers) {
  $pairs = [ordered]@{}
  foreach ($layer in $layers) {
    if (-not $layer.ContainsKey('hooks') -or $null -eq $layer['hooks']) { continue }
    foreach ($ev in $layer['hooks'].Keys) {
      if (-not $pairs.Contains($ev)) { $pairs[$ev] = [System.Collections.ArrayList]::new() }
      foreach ($g in @($layer['hooks'][$ev])) {
        $m = ''
        if ($g.ContainsKey('matcher') -and $null -ne $g['matcher']) { $m = [string]$g['matcher'] }
        foreach ($h in @($g['hooks'])) { $null = $pairs[$ev].Add(@{ Matcher = $m; Handler = $h }) }
      }
    }
  }
  $out = [ordered]@{}
  foreach ($ev in $pairs.Keys) {
    $seen = @{}
    $index = @{}
    $groups = [System.Collections.ArrayList]::new()
    foreach ($p in $pairs[$ev]) {
      $key = '{0}|{1}' -f $p.Matcher, [string]$p.Handler['command']
      if ($seen.ContainsKey($key)) { continue }
      $seen[$key] = $true
      if (-not $index.ContainsKey($p.Matcher)) {
        $g = [ordered]@{}
        if ($p.Matcher -ne '') { $g['matcher'] = $p.Matcher }
        $g['hooks'] = [System.Collections.ArrayList]::new()
        $null = $groups.Add($g)
        $index[$p.Matcher] = $g
      }
      $null = $index[$p.Matcher]['hooks'].Add($p.Handler)
    }
    foreach ($g in $groups) { $g['hooks'] = @($g['hooks'].ToArray()) }
    $out[$ev] = @($groups.ToArray())
  }
  return $out
}

# settings.json used to be a straight Copy-Item of the provider file, which
# silently deleted every repo-owned safety control on each switch. It is now a
# merge of three layers, lowest precedence first:
#   1. the existing settings.json  - carried over, minus $ProviderKeys
#   2. settings.base.json          - repo-owned safety config, always applied
#   3. providers\<name>.json       - the provider's own keys, applied last
function Build-MergedSetting($providerFile) {
  $base  = Read-JsonMap $BaseSettings
  $prov  = Read-JsonMap $providerFile
  $carry = Read-JsonMap $Settings
  # Drop provider-owned keys from the carried-over layer first, so a key the
  # new provider does not set is removed rather than inherited.
  foreach ($k in $ProviderKeys) { $carry.Remove($k) }

  $merged = Merge-Map (Merge-Map $carry $base) $prov
  $merged.Remove('_comment')

  $permissions = @{}
  foreach ($layer in @($carry, $base, $prov)) {
    if ($layer.ContainsKey('permissions') -and $layer['permissions'] -is [hashtable]) {
      $permissions = Merge-Map $permissions $layer['permissions']
    }
  }
  $denyLists  = @($carry, $base, $prov) | ForEach-Object { if ($_.ContainsKey('permissions') -and $_['permissions']) { $_['permissions']['deny'] } }
  $allowLists = @($carry, $base, $prov) | ForEach-Object { if ($_.ContainsKey('permissions') -and $_['permissions']) { $_['permissions']['allow'] } }
  $permissions['deny'] = Join-UniqueList @($denyLists)
  $allow = Join-UniqueList @($allowLists)
  if ($allow.Count -gt 0) { $permissions['allow'] = $allow } else { $permissions.Remove('allow') }
  $merged['permissions'] = $permissions

  $merged['hooks'] = Merge-HookMap @($carry, $base, $prov)

  foreach ($k in $ProviderKeys) { if (-not $prov.ContainsKey($k)) { $merged.Remove($k) } }
  return $merged
}

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

  # Refuse rather than write an unguarded settings.json. A safety control that
  # silently is not there is the failure this merge exists to end.
  if (-not (Test-Path -LiteralPath $BaseSettings)) {
    throw "missing $BaseSettings; re-run install.ps1 to restore the repo-owned safety settings"
  }
  $merged = Build-MergedSetting (Join-Path $PDir "$p.json")

  # Written whole to a temp file, then swapped: a half-written settings.json is
  # a broken Claude Code, and this file is read at startup.
  $tmp = "$Settings.tmp"
  Set-Content -LiteralPath $tmp -Value ($merged | ConvertTo-Json -Depth 32) -Encoding utf8NoBOM
  Move-Item -LiteralPath $tmp -Destination $Settings -Force

  Set-Content -LiteralPath $Active -Value $p -NoNewline
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
    # settings.json is a MERGE now, so a byte compare against the provider file
    # would always report drift. Recompute the merge and compare against that,
    # which still catches an edited provider file that was never re-activated
    # (the silent-401 footgun) and additionally catches an edited
    # settings.base.json whose safety rules have not been applied yet.
    $pf = Join-Path $PDir "$a.json"
    if (Test-Path -LiteralPath $pf) {
      if ((Test-Path -LiteralPath $Settings) -and (Test-Path -LiteralPath $BaseSettings)) {
        $expected = (ConvertTo-CanonicalObject (Build-MergedSetting $pf)) | ConvertTo-Json -Depth 32 -Compress
        $actual = (ConvertTo-CanonicalObject (Read-JsonMap $Settings)) | ConvertTo-Json -Depth 32 -Compress
        if ($expected -ne $actual) {
          "WARNING: settings.json is out of date with providers/$a.json or settings.base.json - re-run: ccs $a" | Write-Host
        }
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
