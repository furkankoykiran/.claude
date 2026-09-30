# cc-provider.ps1 - Windows/PowerShell port of bin/cc-provider.
# Switches the Claude Code API provider by MERGING a provider file into
# $HOME/.claude/settings.json (a real file, not a symlink, so it works on
# Windows). Merge order, lowest precedence first: the existing settings.json
# (carried over) <- settings.base.json <- the provider file.
#
#   pwsh cc-provider.ps1 use anthropic -> activate official Anthropic
#   pwsh cc-provider.ps1 zai           -> compatibility shorthand for use zai
#   pwsh cc-provider.ps1 list          -> list every available provider
#   pwsh cc-provider.ps1 status        -> print the active provider
#   pwsh cc-provider.ps1 auth zai      -> fill a local provider API key without echoing it
#   pwsh cc-provider.ps1 doctor        -> check the provider setup
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
  [string]$Command = 'status',
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Rest = @()
)

$ErrorActionPreference = 'Stop'

if (-not $env:CLAUDE_DIR) { $env:CLAUDE_DIR = Join-Path $HOME '.claude' }
$PDir     = Join-Path $env:CLAUDE_DIR 'providers'
$Settings = Join-Path $env:CLAUDE_DIR 'settings.json'
$BaseSettings = Join-Path $env:CLAUDE_DIR 'settings.base.json'
$Active   = Join-Path $PDir '.active'

# Keys the ACTIVE PROVIDER owns outright; see bin/cc-provider for the rationale.
# Kept identical to the bash list on purpose - the two ports must not disagree
# about which routing keys a switch is allowed to carry over.
$ProviderKeys = @('env', 'model', 'apiKeyHelper')

function Assert-ProviderArg($cmd, $ProviderArgs) {
  if ($ProviderArgs.Count -lt 1 -or [string]::IsNullOrWhiteSpace($ProviderArgs[0])) { throw "$cmd requires a provider name" }
  if ($ProviderArgs.Count -gt 1) { throw "$cmd accepts exactly one provider name" }
  return $ProviderArgs[0]
}

function Test-CodexEntitlement($p) {
  return $p -in @('codex', 'chatgpt', 'chatgpt-entitlement')
}

function Invoke-Codex($action) {
  if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
    throw 'codex CLI is not installed; install/sign in with official Codex tooling first'
  }
  switch ($action) {
    'login' { & codex login; return }
    'status' { & codex status; return }
    'logout' { & codex logout; return }
    default { throw "unsupported Codex action: $action" }
  }
}

function Protect-ProviderFile($path) {
  if (Get-Command chmod -ErrorAction SilentlyContinue) { & chmod 600 $path 2>$null }
}

function Format-SecretRedaction($value) {
  if ([string]::IsNullOrEmpty($value)) { return 'empty' }
  if ($value.Length -le 4) { return 'configured (****)' }
  return "configured (****$($value.Substring($value.Length - 4)))"
}

function Get-CredentialKey($p) {
  $f = Join-Path $PDir "$p.json"
  if (-not (Test-Path -LiteralPath $f)) { return $null }
  $data = Read-JsonMap $f
  if (-not $data.ContainsKey('env') -or -not ($data['env'] -is [hashtable])) { return $null }
  $found = @()
  foreach ($k in @('ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY')) {
    if ($data['env'].ContainsKey($k)) {
      $found += @{ Key = $k; Value = [string]($data['env'][$k]) }
    }
  }
  foreach ($item in $found) { if ($item.Value -match '^<[^>]+>$') { return $item.Key } }
  foreach ($item in $found) { if ($item.Value -eq '') { return $item.Key } }
  if ($found.Count -gt 0) { return $found[0].Key }
  return $null
}

function Get-CredentialValue($p, $key) {
  if ([string]::IsNullOrEmpty($key)) { return '' }
  $data = Read-JsonMap (Join-Path $PDir "$p.json")
  if (-not $data.ContainsKey('env') -or -not ($data['env'] -is [hashtable]) -or -not $data['env'].ContainsKey($key)) { return '' }
  return [string]$data['env'][$key]
}

function Write-ProviderAuthStatus($p) {
  if (Test-CodexEntitlement $p) {
    'Auth mode: ChatGPT entitlement via official codex login/status/logout (no API key is copied).'
    return
  }
  $f = Join-Path $PDir "$p.json"
  if (-not (Test-Path -LiteralPath $f)) {
    "Auth mode: not configured (no providers/$p.json yet)."
    return
  }
  $key = Get-CredentialKey $p
  if ([string]::IsNullOrEmpty($key)) {
    $data = Read-JsonMap $f
    $url = ''
    if ($data.ContainsKey('env') -and $data['env'] -is [hashtable] -and $data['env'].ContainsKey('ANTHROPIC_BASE_URL')) { $url = [string]$data['env']['ANTHROPIC_BASE_URL'] }
    if ($url -match '127\.0\.0\.1|localhost|0\.0\.0\.0') {
      "Auth mode: local/gateway provider (no API key stored in providers/$p.json)."
    } else {
      "Auth mode: no API key field in providers/$p.json."
    }
    return
  }
  $value = Get-CredentialValue $p $key
  if ([string]::IsNullOrEmpty($value) -or $value -match '^<') {
    "Auth mode: API key required in $key (not configured)."
  } else {
    "Auth mode: API key in $key is $(Format-SecretRedaction $value)."
  }
}

function Read-ProviderSecret($prompt) {
  if ($env:CC_PROVIDER_API_KEY) { return $env:CC_PROVIDER_API_KEY }
  $secure = Read-Host -Prompt $prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Set-ProviderApiKey($p) {
  if (Test-CodexEntitlement $p) {
    throw "$p uses ChatGPT entitlement. Use: ccs login $p (delegates to codex login), not an API key."
  }
  if ((Get-ProviderList) -notcontains $p) { throw "unknown provider: $p" }
  Initialize-Provider $p
  $key = Get-CredentialKey $p
  if ([string]::IsNullOrEmpty($key)) { throw "providers/$p.json has no ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY field to fill" }
  $secret = Read-ProviderSecret "Enter API key for $p ($key)"
  if ([string]::IsNullOrEmpty($secret)) { throw "empty API key; providers/$p.json was not changed" }
  $f = Join-Path $PDir "$p.json"
  $data = Read-JsonMap $f
  $data['env'][$key] = $secret
  Set-Content -LiteralPath $f -Value ($data | ConvertTo-Json -Depth 32) -Encoding utf8NoBOM
  Protect-ProviderFile $f
  "Updated providers/$p.json (${key}: $(Format-SecretRedaction $secret))."
  if ((Test-Path -LiteralPath $Active) -and ((Get-Content -LiteralPath $Active -Raw).Trim() -eq $p)) {
    Enable-Provider $p
  } else {
    "Run `ccs use $p` to activate it."
  }
}

function Clear-ProviderAuth($p) {
  if (Test-CodexEntitlement $p) { Invoke-Codex logout; return }
  if ((Get-ProviderList) -notcontains $p) { throw "unknown provider: $p" }
  $f = Join-Path $PDir "$p.json"
  if (-not (Test-Path -LiteralPath $f)) { "Provider $p has no local file to clear."; return }
  $key = Get-CredentialKey $p
  if ([string]::IsNullOrEmpty($key)) { "Provider $p has no API key field to clear."; return }
  $data = Read-JsonMap $f
  $data['env'][$key] = ''
  Set-Content -LiteralPath $f -Value ($data | ConvertTo-Json -Depth 32) -Encoding utf8NoBOM
  Protect-ProviderFile $f
  "Cleared API key in providers/$p.json ($key)."
  if ((Test-Path -LiteralPath $Active) -and ((Get-Content -LiteralPath $Active -Raw).Trim() -eq $p)) { Enable-Provider $p }
}

function Invoke-Doctor {
  'Provider doctor'
  if (Get-Command jq -ErrorAction SilentlyContinue) { 'jq: ok' } else { 'jq: missing (PowerShell switcher does not require jq)' }
  if (Test-Path -LiteralPath $BaseSettings) { 'settings.base.json: present' } else { 'settings.base.json: missing' }
  if (Test-Path -LiteralPath $Active) {
    $a = (Get-Content -LiteralPath $Active -Raw).Trim()
    "active provider: $a"
    Write-ProviderAuthStatus $a
    $pf = Join-Path $PDir "$a.json"
    if ((Test-Path -LiteralPath $pf) -and (Test-Path -LiteralPath $Settings) -and (Test-Path -LiteralPath $BaseSettings)) {
      $expected = (ConvertTo-CanonicalObject (Build-MergedSetting $pf)) | ConvertTo-Json -Depth 32 -Compress
      $actual = (ConvertTo-CanonicalObject (Read-JsonMap $Settings)) | ConvertTo-Json -Depth 32 -Compress
      if ($expected -eq $actual) { 'settings.json: matches active provider merge' } else { "settings.json: drifted (run: ccs use $a)" }
    }
    Write-WarningIfLocalEndpointDown $a
  } else {
    'active provider: none'
  }
  if (Test-Path -LiteralPath $Settings) {
    $settingsMap = Read-JsonMap $Settings
    $denyCount = 0
    if ($settingsMap.ContainsKey('permissions') -and $settingsMap['permissions'].ContainsKey('deny')) { $denyCount = @($settingsMap['permissions']['deny']).Count }
    $hookCount = 0
    if ($settingsMap.ContainsKey('hooks')) {
      foreach ($eventName in $settingsMap['hooks'].Keys) {
        foreach ($group in @($settingsMap['hooks'][$eventName])) { $hookCount += @($group['hooks']).Count }
      }
    }
    "safety deny rules: $denyCount"
    "hook handlers: $hookCount"
  }
  $nvidia = Join-Path $PDir 'nvidia.json'
  $nvidiaExample = Join-Path $PDir 'nvidia.json.example'
  $gatewayScript = Join-Path $env:CLAUDE_DIR 'scripts\nim-gateway.ps1'
  if ((Test-Path -LiteralPath $nvidia) -or (Test-Path -LiteralPath $nvidiaExample) -or (Test-Path -LiteralPath $gatewayScript)) {
    if (Test-Path -LiteralPath $nvidia) {
      'gateway check: nvidia provider present'
      Write-WarningIfLocalEndpointDown 'nvidia'
    } else {
      'gateway check: nvidia template present'
    }
  }
}


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

# Identity of a hook handler, matching bin/cc-provider's hook_key. JSON-encoded
# so the parts cannot run together: a naive "$matcher|$command" makes
# (matcher='Bash|Write', command='x') and (matcher='Bash', command='Write|x')
# the same key, and silently drops one of them. Handlers with no `command` are
# keyed by their whole value, or every prompt-type hook would collide on the
# empty string.
function Get-HookKey($matcher, $handler) {
  if ($handler -is [hashtable] -and $handler.ContainsKey('command') -and $null -ne $handler['command']) {
    $type = 'command'
    if ($handler.ContainsKey('type') -and $null -ne $handler['type']) { $type = [string]$handler['type'] }
    return (@($matcher, $type, [string]$handler['command']) | ConvertTo-Json -Compress)
  }
  return (@($matcher, ((ConvertTo-CanonicalObject $handler) | ConvertTo-Json -Depth 32 -Compress)) | ConvertTo-Json -Compress)
}

# Union hook handlers across layers, keeping first-seen order but letting a
# later layer replace the descriptor at the same identity, regrouped under one
# group per matcher. All lookups use ordinal (case-sensitive) comparers:
# PowerShell hashtables are case-INSENSITIVE by default, so `Bash` and `bash`
# would collide here while jq keeps them apart, and the two ports would diverge.
function Merge-HookMap($layers) {
  $pairs = [ordered]@{}
  foreach ($layer in $layers) {
    if (-not $layer.ContainsKey('hooks') -or $null -eq $layer['hooks']) { continue }
    foreach ($ev in $layer['hooks'].Keys) {
      if (-not $pairs.Contains($ev)) { $pairs[$ev] = [System.Collections.ArrayList]::new() }
      foreach ($g in @($layer['hooks'][$ev])) {
        $m = ''
        if ($g.ContainsKey('matcher') -and $null -ne $g['matcher']) { $m = [string]$g['matcher'] }
        foreach ($h in @($g['hooks'])) {
          $null = $pairs[$ev].Add(@{ Matcher = $m; Handler = $h; Key = (Get-HookKey $m $h) })
        }
      }
    }
  }
  $out = [ordered]@{}
  foreach ($ev in $pairs.Keys) {
    $order = [System.Collections.ArrayList]::new()
    $byKey = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::Ordinal)
    foreach ($p in $pairs[$ev]) {
      if (-not $byKey.ContainsKey($p.Key)) { $null = $order.Add($p.Key) }
      $byKey[$p.Key] = $p
    }
    $index = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::Ordinal)
    $groups = [System.Collections.ArrayList]::new()
    foreach ($k in $order) {
      $p = $byKey[$k]
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
  $prov.Remove('enabledPlugins')
  $prov.Remove('effortLevel')
  $carry = Read-JsonMap $Settings
  # Drop provider-owned keys from the carried-over layer first, so a key the
  # new provider does not set is removed rather than inherited.
  foreach ($k in $ProviderKeys) { $carry.Remove($k) }

  $merged = Merge-Map (Merge-Map $carry $base) $prov
  # Merge-Map recurses into objects, so a provider-owned OBJECT would be merged
  # rather than replaced and a lower layer's env.ANTHROPIC_BASE_URL could
  # survive alongside the new provider's token. Assign each present
  # provider-owned key straight from the provider.
  foreach ($k in $ProviderKeys) { if ($prov.ContainsKey($k)) { $merged[$k] = $prov[$k] } }
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
      Protect-ProviderFile $f
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
    elseif ($p -eq 'codex') {
      "Start the experimental gateway first: bun run $env:CLAUDE_DIR\scripts\codex-anthropic-gateway.ts" | Write-Host
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
  "usage: cc-provider.ps1 [list|status|doctor|use <provider>|auth <provider>|login <provider>|api <provider>|logout <provider>|<provider>]" | Write-Host
  "  list              list available providers" | Write-Host
  "  status            print the active provider and auth summary" | Write-Host
  "  use <provider>    activate it (compatibility shorthand: cc-provider.ps1 <provider>)" | Write-Host
  "  auth <provider>   show auth mode or fill an API key when needed" | Write-Host
  "  login <provider>  fill an API key; codex/chatgpt delegates to official codex login" | Write-Host
  "  api <provider>    fill an API key in providers\<provider>.json" | Write-Host
  "  logout <provider> clear a local API key; codex/chatgpt delegates to codex logout" | Write-Host
  "  doctor            check provider setup, safety merge and local gateway state" | Write-Host
  "" | Write-Host
  "available providers:" | Write-Host
  foreach ($p in Get-ProviderList) { "  $p" | Write-Host }
}

switch ($Command) {
  'status' {
    if ($Rest.Count -gt 0) { throw 'status accepts no provider argument' }
    if (-not (Test-Path -LiteralPath $Active)) {
      'none (provider system not active; settings.json is whatever install.sh seeded)'
      return
    }
    $a = (Get-Content -LiteralPath $Active -Raw).Trim()
    $a
    Write-ProviderAuthStatus $a | Write-Host
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
  'list' {
    if ($Rest.Count -gt 0) { throw 'list accepts no provider argument' }
    Get-ProviderList
  }
  'doctor' {
    if ($Rest.Count -gt 0) { throw 'doctor accepts no provider argument' }
    Invoke-Doctor
  }
  'use' {
    $p = Assert-ProviderArg 'use' $Rest
    if ((Get-ProviderList) -contains $p) { Enable-Provider $p } else { throw "unknown provider: $p" }
  }
  'auth' {
    $p = Assert-ProviderArg 'auth' $Rest
    if (Test-CodexEntitlement $p) { Write-ProviderAuthStatus $p; return }
    if ((Get-ProviderList) -notcontains $p) { throw "unknown provider: $p" }
    Initialize-Provider $p
    Write-ProviderAuthStatus $p
    $key = Get-CredentialKey $p
    $value = ''
    if (-not [string]::IsNullOrEmpty($key)) { $value = Get-CredentialValue $p $key }
    if ([string]::IsNullOrEmpty($value) -or $value -match '^<') { Set-ProviderApiKey $p }
  }
  'login' {
    $p = Assert-ProviderArg 'login' $Rest
    if (Test-CodexEntitlement $p) { Invoke-Codex login } else { Set-ProviderApiKey $p }
  }
  'api' {
    $p = Assert-ProviderArg 'api' $Rest
    Set-ProviderApiKey $p
  }
  'logout' {
    $p = Assert-ProviderArg 'logout' $Rest
    Clear-ProviderAuth $p
  }
  '-h' { Show-Usage; exit 0 }
  '--help' { Show-Usage; exit 0 }
  default {
    if ($Command -and ((Get-ProviderList) -contains $Command) -and $Rest.Count -eq 0) {
      Enable-Provider $Command
    } else {
      if ($Command) { "cc-provider.ps1: unknown provider or command: $Command" | Write-Host; '' | Write-Host }
      Show-Usage
      exit 1
    }
  }
}
