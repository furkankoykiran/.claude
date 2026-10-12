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
$ProviderKeys = @('env', 'model', 'apiKeyHelper', 'modelDiscoveryEnabled', 'modelPrefer1mContext', 'inferenceModels', 'inferenceModelPricingEnabled', 'inferenceModelPricing', 'inferenceModelPricingMultiplier', 'modelPicker')

function Assert-ProviderArg($cmd, $ProviderArgs) {
  if ($ProviderArgs.Count -lt 1 -or [string]::IsNullOrWhiteSpace($ProviderArgs[0])) { throw "$cmd requires a provider name" }
  if ($ProviderArgs.Count -gt 1) { throw "$cmd accepts exactly one provider name" }
  return $ProviderArgs[0]
}

function Resolve-Provider($p) {
  if ($p -in @('codex', 'chatgpt', 'chatgpt-entitlement')) { return 'codex' }
  if ($p -eq 'google') { throw "'google' no longer switches providers. Use 'ccs gemini' for API/Vertex or 'ccs agy' for native CLI." }
  if ($p -eq 'antigravity') { throw "'antigravity' no longer switches providers. Use 'ccs agy'." }
  if ($p -in @('zai', 'glm', 'zhipu')) { return 'zai' }
  if ($p -in @('kimi', 'moonshot')) { return 'kimi' }
  if ($p -in @('nvidia-nim', 'nim')) { return 'nvidia-nim' }
  if ($p -in @('nvidia', 'nvidia-hosted', 'build-nvidia')) { return 'nvidia' }
  if ($p -in @('orcarouter', 'orca')) { return 'orcarouter' }
  if ($p -in @('onerouter', 'one')) { return 'onerouter' }
  return $p
}

function Test-GoogleProvider($p) {
  return $p -in @('agy', 'gemini')
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

function Format-CodexDisplay($value) {
  if ($null -eq $value) { return '' }
  $text = [string]$value
  $text = [regex]::Replace($text, "`e\[[0-9;?]*[ -/]*[@-~]", '')
  $text = [regex]::Replace($text, '\[[0-9;]*m', '')
  return [regex]::Replace($text, '[\x00-\x1F\x7F]', '')
}

function Get-CredentialKey($p) {
  $resolved = Resolve-Provider $p
  $f = Join-Path $PDir "$resolved.json"
  if (-not (Test-Path -LiteralPath $f)) { return $null }
  $data = Read-JsonMap $f
  if (-not $data.ContainsKey('env') -or -not ($data['env'] -is [hashtable])) { return $null }
  $found = @()
  foreach ($k in @('GEMINI_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY')) {
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
  $resolved = Resolve-Provider $p
  $data = Read-JsonMap (Join-Path $PDir "$resolved.json")
  if (-not $data.ContainsKey('env') -or -not ($data['env'] -is [hashtable]) -or -not $data['env'].ContainsKey($key)) { return '' }
  return [string]$data['env'][$key]
}

function Test-ConsumerAntigravityAuth {
  $geminiDir = Join-Path $HOME '.gemini'
  if (-not (Test-Path -LiteralPath $geminiDir)) { return $false }
  $oauthFiles = @('oauth_credentials.json', 'antigravity_tokens.json', 'google_accounts.json')
  foreach ($file in $oauthFiles) {
    if (Test-Path -LiteralPath (Join-Path $geminiDir $file)) { return $true }
  }
  return $false
}

function Test-OfficialGoogleCredential($p) {
  $config = Read-JsonMap (Join-Path $PDir "$p.json")
  $configEnv = if ($config.ContainsKey('env')) { $config['env'] } else { @{} }
  $key = if ($env:GEMINI_API_KEY) { $env:GEMINI_API_KEY } else { $configEnv['GEMINI_API_KEY'] }
  if ($key -and $key -notmatch '^<') { return $true }
  $token = if ($env:GOOGLE_OAUTH_TOKEN) { $env:GOOGLE_OAUTH_TOKEN } else { $configEnv['GOOGLE_OAUTH_TOKEN'] }
  $project = $env:VERTEX_PROJECT_ID
  if (-not $project) { $project = $env:GOOGLE_CLOUD_PROJECT }
  if (-not $project) { $project = $env:ANTHROPIC_VERTEX_PROJECT_ID }
  if (-not $project) { $project = $configEnv['VERTEX_PROJECT_ID'] }
  if (-not $project) { $project = $configEnv['GOOGLE_CLOUD_PROJECT'] }
  if (-not $project) { $project = $configEnv['ANTHROPIC_VERTEX_PROJECT_ID'] }
  return ($token -and $token -notmatch '^<' -and $project -and $project -notmatch '^<')
}

function Write-NativeAgyAdvice {
  Write-Host 'Gemini requires its own supported API/Vertex credentials and configured model.'
  Write-Host 'AGY login is separate: ccs agy uses the official native CLI session without copying OAuth.'
}

function Write-ProviderAuthStatus($p) {
  $resolved = Resolve-Provider $p
  if (Test-CodexEntitlement $resolved) {
    'Auth mode: ChatGPT entitlement via official codex login/status/logout (no API key is copied).'
    return
  }
  if ($resolved -eq 'agy') {
    'Auth mode: official AGY CLI owns login/session; activation requires a nonce preflight (no API key).'
    return
  }
  if ($resolved -eq 'gemini') {
    if (Test-OfficialGoogleCredential $resolved) {
      'Auth mode: official Google/Vertex credentials configured.'
    } else {
      'Auth mode: official Gemini API key or Vertex credentials required (not configured).'
      if (Test-ConsumerAntigravityAuth) {
        Write-NativeAgyAdvice
      }
    }
    return
  }
  $f = Join-Path $PDir "$resolved.json"
  if (-not (Test-Path -LiteralPath $f)) {
    "Auth mode: not configured (no providers/$resolved.json yet)."
    return
  }
  $key = Get-CredentialKey $resolved
  if ([string]::IsNullOrEmpty($key)) {
    $data = Read-JsonMap $f
    $url = ''
    if ($data.ContainsKey('env') -and $data['env'] -is [hashtable] -and $data['env'].ContainsKey('ANTHROPIC_BASE_URL')) { $url = [string]$data['env']['ANTHROPIC_BASE_URL'] }
    if ($url -match '127\.0\.0\.1|localhost|0\.0\.0\.0') {
      "Auth mode: local/gateway provider (no API key stored in providers/$resolved.json)."
    } else {
      "Auth mode: no API key field in providers/$resolved.json."
    }
    return
  }
  $value = Get-CredentialValue $resolved $key
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
  $resolved = Resolve-Provider $p
  if ($resolved -eq 'agy') { throw 'AGY owns login/session. Run the official agy CLI; no API key is copied.' }
  if (Test-CodexEntitlement $resolved) {
    throw "$p uses ChatGPT entitlement. Use: ccs login $p (delegates to codex login), not an API key."
  }
  if ((Get-ProviderList) -notcontains $resolved) { throw "unknown provider: $p" }
  Initialize-Provider $resolved
  $key = Get-CredentialKey $resolved
  if ([string]::IsNullOrEmpty($key)) { throw "providers/$resolved.json has no credential field to fill" }
  $secret = Read-ProviderSecret "Enter API key for $resolved ($key)"
  if ([string]::IsNullOrEmpty($secret)) { throw "empty API key; providers/$resolved.json was not changed" }
  $f = Join-Path $PDir "$resolved.json"
  $data = Read-JsonMap $f
  $data['env'][$key] = $secret
  Set-Content -LiteralPath $f -Value ($data | ConvertTo-Json -Depth 32) -Encoding utf8NoBOM
  Protect-ProviderFile $f
  "Updated providers/$resolved.json (${key}: $(Format-SecretRedaction $secret))."
  if ((Test-Path -LiteralPath $Active) -and ((Get-Content -LiteralPath $Active -Raw).Trim() -eq $resolved)) {
    Enable-Provider $resolved
  } else {
    "Run `ccs use $resolved` to activate it."
  }
}

function Clear-ProviderAuth($p) {
  $resolved = Resolve-Provider $p
  if ($resolved -eq 'agy') { throw 'AGY owns logout; use its native session controls.' }
  if (Test-CodexEntitlement $resolved) { Invoke-Codex logout; return }
  if ((Get-ProviderList) -notcontains $resolved) { throw "unknown provider: $p" }
  $f = Join-Path $PDir "$resolved.json"
  if (-not (Test-Path -LiteralPath $f)) { "Provider $p has no local file to clear."; return }
  $key = Get-CredentialKey $resolved
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
  Write-CodexPickerStatus
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


function Write-CodexPickerStatus {
  $codexFile = Join-Path $PDir 'codex.json'
  if (Test-Path -LiteralPath $codexFile) {
    $codex = Read-JsonMap $codexFile
    $providerCount = 0
    if ($codex.ContainsKey('modelPicker') -and $codex['modelPicker'].ContainsKey('options')) { $providerCount = @($codex['modelPicker']['options']).Count }
    $selected = 'unset'
    if ($codex.ContainsKey('env') -and $codex['env'].ContainsKey('CODEX_GATEWAY_MODEL')) { $selected = $codex['env']['CODEX_GATEWAY_MODEL'] }
    elseif ($codex.ContainsKey('model')) { $selected = $codex['model'] }
    $selected = Format-CodexDisplay $selected
    "Codex picker catalog: $providerCount model(s) cached in providers/codex.json"
    "Codex selected model: $selected"
  }
  if (Test-Path -LiteralPath $Settings) {
    $settingsMap = Read-JsonMap $Settings
    $settingsCount = 0
    if ($settingsMap.ContainsKey('modelPicker') -and $settingsMap['modelPicker'].ContainsKey('options')) { $settingsCount = @($settingsMap['modelPicker']['options']).Count }
    $pricing = 'false'
    if ($settingsMap.ContainsKey('inferenceModelPricingEnabled')) { $pricing = [string]$settingsMap['inferenceModelPricingEnabled'] }
    "Claude /model Codex rows: $settingsCount cached in settings.json"
    "Codex pricing estimate: $pricing"
  }
  'Codex gateway discovery: Claude Code keeps only raw /v1/models ids containing claude or anthropic; Codex ids use generated modelPicker rows.'
  'Codex bridge prompt forwarding: pending; promptless Claude Code requests fail closed instead of running Codex on system reminders.'
}

function Get-MapValue($obj, $name, $default = $null) {
  if ($null -eq $obj) { return $default }
  if ($obj -is [hashtable]) {
    if ($obj.ContainsKey($name)) { return $obj[$name] }
    return $default
  }
  $prop = $obj.PSObject.Properties[$name]
  if ($null -ne $prop) { return $prop.Value }
  return $default
}

function Get-CodexGatewayPort {
  if ($env:CODEX_GATEWAY_PORT) {
    return [string]$env:CODEX_GATEWAY_PORT
  }
  $codexFile = Join-Path $PDir 'codex.json'
  if (Test-Path -LiteralPath $codexFile) {
    $codex = Read-JsonMap $codexFile
    if ($codex.ContainsKey('env') -and $codex['env'].ContainsKey('CODEX_GATEWAY_PORT')) {
      return [string]$codex['env']['CODEX_GATEWAY_PORT']
    }
  }
  return '4545'
}

function Invoke-CodexGatewayJson($path) {
  $port = Get-CodexGatewayPort
  $uri = "http://127.0.0.1:$port$path"
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 5
    return ($response.Content | ConvertFrom-Json)
  } catch {
    throw "failed to query Codex account data at $uri"
  }
}

function Format-EmailRedaction($email) {
  if ([string]::IsNullOrWhiteSpace($email) -or -not $email.Contains('@')) { return 'redacted' }
  $parts = $email.Split('@', 2)
  if ([string]::IsNullOrEmpty($parts[0]) -or [string]::IsNullOrEmpty($parts[1])) { return 'redacted' }
  $prefix = $parts[0]
  if ($prefix.Length -gt 2) { $prefix = $prefix.Substring(0, 2) }
  return "$prefix***@$($parts[1])"
}

function Format-EpochUtc($epoch) {
  if ($null -eq $epoch -or "$epoch" -eq 'null' -or "$epoch" -notmatch '^\d+$') { return 'unavailable' }
  return ([DateTimeOffset]::FromUnixTimeSeconds([int64]$epoch).UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ssZ'))
}

function Format-TimeUntil($epoch) {
  if ($null -eq $epoch -or "$epoch" -eq 'null' -or "$epoch" -notmatch '^\d+$') { return 'unavailable' }
  $delta = [DateTimeOffset]::FromUnixTimeSeconds([int64]$epoch) - [DateTimeOffset]::UtcNow
  if ($delta.TotalSeconds -le 0) { return 'elapsed' }
  if ($delta.Days -gt 0) { return "$($delta.Days)d $($delta.Hours)h $($delta.Minutes)m" }
  if ($delta.Hours -gt 0) { return "$($delta.Hours)h $($delta.Minutes)m" }
  return "$($delta.Minutes)m"
}

function Show-CodexAccount {
  try { $accountJson = Invoke-CodexGatewayJson '/codex/account' } catch {
    'Codex account: unavailable'
    'Usage unavailable - open ChatGPT Settings -> Usage.'
    return
  }
  $account = Get-MapValue $accountJson 'account'
  $codexFile = Join-Path $PDir 'codex.json'
  $model = 'unset'
  $effort = 'default'
  if (Test-Path -LiteralPath $codexFile) {
    $codex = Read-JsonMap $codexFile
    if ($codex.ContainsKey('env')) {
      if ($codex['env'].ContainsKey('CODEX_GATEWAY_MODEL')) { $model = Format-CodexDisplay $codex['env']['CODEX_GATEWAY_MODEL'] }
      if ($codex['env'].ContainsKey('CODEX_GATEWAY_REASONING_EFFORT')) { $effort = [string]$codex['env']['CODEX_GATEWAY_REASONING_EFFORT'] }
    }
  }
  'Codex account'
  if ($null -eq $account) {
    '  Status: signed out or unavailable'
    $requiresAuth = Get-MapValue $accountJson 'requiresOpenaiAuth' $false
    if ($requiresAuth) { '  Auth mode: openai auth required' } else { '  Auth mode: unknown' }
    '  Account: redacted'
    '  Plan: unavailable'
  } else {
    '  Status: signed in'
    "  Auth mode: $(Get-MapValue $account 'type' 'unknown')"
    "  Account: $(Format-EmailRedaction (Get-MapValue $account 'email' ''))"
    "  Plan: $(Get-MapValue $account 'planType' 'unavailable')"
  }
  "  Model: $model"
  "  Effort: $effort"
  "  Last refresh: $([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))"
}

function Show-UsageWindow($name, $window) {
  if ($null -eq $window) { return }
  $used = Get-MapValue $window 'usedPercent' 'unavailable'
  $resetsAt = Get-MapValue $window 'resetsAt'
  $windowMins = Get-MapValue $window 'windowDurationMins'
  $line = "  ${name}: used $used%"
  if ($null -ne $resetsAt) { $line += " | resets $(Format-EpochUtc $resetsAt) ($(Format-TimeUntil $resetsAt))" }
  if ($null -ne $windowMins) { $line += " | windowMins $windowMins" }
  $line
}

function Show-CodexUsage {
  try { $limitsJson = Invoke-CodexGatewayJson '/codex/rate-limits' } catch {
    'Usage unavailable - open ChatGPT Settings -> Usage.'
    return
  }
  try { $usageJson = Invoke-CodexGatewayJson '/codex/usage' } catch { $usageJson = $null }
  'Codex usage'
  $ordinary = Get-MapValue $limitsJson 'ordinaryUsageAllowed'
  if ($ordinary -eq $true) { '  Ordinary usage: allowed' }
  elseif ($ordinary -eq $false) { '  Ordinary usage: exhausted' }
  else { '  Ordinary usage: unavailable' }

  $limitsById = Get-MapValue $limitsJson 'rateLimitsByLimitId'
  if ($null -eq $limitsById) {
    $limitsById = [pscustomobject]@{ default = (Get-MapValue $limitsJson 'rateLimits') }
  }
  foreach ($limit in $limitsById.PSObject.Properties) {
    if ($null -eq $limit.Value) { continue }
    "  Limit: $($limit.Name)"
    Show-UsageWindow 'primary' (Get-MapValue $limit.Value 'primary')
    Show-UsageWindow 'secondary' (Get-MapValue $limit.Value 'secondary')
  }
  $resetCredits = Get-MapValue (Get-MapValue $limitsJson 'rateLimitResetCredits') 'availableCount' 'unavailable'
  "  Reset credits: $resetCredits"
  $summary = Get-MapValue $usageJson 'summary'
  if ($null -eq $summary) {
    '  Token usage summary: unavailable'
  } else {
    $pairs = foreach ($prop in $summary.PSObject.Properties) { "$($prop.Name)=$($prop.Value)" }
    "  Token usage summary: $($pairs -join ', ')"
  }
  "  Last refresh: $([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))"
  '  Official details: ChatGPT Settings -> Usage'
}

function Show-PermissionMatrix {
  $activeProvider = 'none'
  if (Test-Path -LiteralPath $Active) { $activeProvider = (Get-Content -LiteralPath $Active -Raw).Trim() }
  $claudeMode = 'default'
  if (Test-Path -LiteralPath $Settings) {
    $settingsMap = Read-JsonMap $Settings
    if ($settingsMap.ContainsKey('permissions') -and $settingsMap['permissions'].ContainsKey('defaultMode')) {
      $claudeMode = [string]$settingsMap['permissions']['defaultMode']
    }
  }
  switch ($claudeMode) {
    'default' { $modeLabel = 'default (Manual / ask)' }
    'auto' { $modeLabel = 'auto (Claude Code support is model/session dependent)' }
    default { $modeLabel = $claudeMode }
  }
  'Permission and Auto semantics'
  "  Active provider: $activeProvider"
  "  Claude permission mode: $modeLabel"
  if ($activeProvider -eq 'codex') {
    '  Active scope: ccs codex bridge'
    '  Authority: Claude Code owns Bash, Read/Edit/Write, hooks, Claude-side MCP, tool results, and permission UI.'
    '  Codex bridge sandbox: read-only (network disabled for turn sandbox)'
    '  Codex bridge approval policy: never'
    '  Codex bridge approval reviewer: user (Codex auto_review is not authoritative)'
    '  Codex-side tool executor: disabled/fail-closed in bridge mode'
    '  Claude Auto mode: only available when Claude Code itself accepts the active model/session; not inferred from Codex auto_review.'
  } else {
    '  Active scope: standard'
    '  Authority: Claude Code owns provider requests and its normal permission UI for this provider.'
    '  Codex native controls: not active through ccs unless you run the official codex CLI directly.'
  }
  ''
  'Supported choices'
  '  Manual / ask:        fkt configure --yes --permission-mode manual'
  '  Plan:                fkt configure --yes --permission-mode plan'
  '  Accept edits:        fkt configure --yes --permission-mode acceptEdits'
  '  Hard deny prompts:   fkt configure --yes --permission-mode dontAsk'
  '  Claude Auto:         fkt configure --yes --permission-mode auto (only if Claude Code supports the active model/session)'
  '  Native Codex Auto Review: use official codex CLI settings outside ccs codex; ccs codex will not let it approve Claude-owned operations.'
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
function Get-ProviderCapabilities($providerFile) {
  $prov = Read-JsonMap $providerFile
  $baseName = [System.IO.Path]::GetFileNameWithoutExtension($providerFile)
  $canonical = Resolve-Provider $baseName
  $envBlock = if ($prov.ContainsKey('env') -and ($prov['env'] -is [hashtable])) { $prov['env'] } else { @{} }
  $model = if ($envBlock.ContainsKey('ANTHROPIC_MODEL')) { [string]$envBlock['ANTHROPIC_MODEL'] } elseif ($prov.ContainsKey('model')) { [string]$prov['model'] } else { '' }
  $userCtx = if ($envBlock.ContainsKey('CLAUDE_CODE_MAX_CONTEXT_TOKENS')) { [string]$envBlock['CLAUDE_CODE_MAX_CONTEXT_TOKENS'] } else { '' }
  $userRetries = if ($envBlock.ContainsKey('CLAUDE_CODE_MAX_RETRIES')) { [string]$envBlock['CLAUDE_CODE_MAX_RETRIES'] } else { '' }
  $finalCtx = ''
  $finalRetries = ''

  if ($userCtx -and $userCtx -notmatch '^<' -and [int]::TryParse($userCtx, [ref]$null)) {
    $finalCtx = $userCtx
  }
  if ($userRetries -and $userRetries -notmatch '^<') {
    $finalRetries = $userRetries
  }

  $stateDir = Join-Path $env:CLAUDE_DIR 'state'
  $discoveryFile = Join-Path $stateDir "discovery-$canonical.json"
  if (-not $finalCtx -and $model -and (Test-Path -LiteralPath $discoveryFile)) {
    try {
      $disc = Read-JsonMap $discoveryFile
      if ($disc.ContainsKey('data') -and ($disc['data'] -is [System.Collections.IEnumerable])) {
        foreach ($item in $disc['data']) {
          if ($item -is [hashtable] -and $item['id'] -eq $model) {
            $len = if ($item.ContainsKey('context_length')) { $item['context_length'] } elseif ($item.ContainsKey('max_context_length')) { $item['max_context_length'] } elseif ($item.ContainsKey('context_window')) { $item['context_window'] } else { $null }
            if ($null -ne $len -and [int]::TryParse([string]$len, [ref]$null) -and [int]$len -gt 0) {
              $finalCtx = [string]$len
              break
            }
          }
        }
      }
    } catch {}
  }

  $regPath = Join-Path $PDir 'registry.json'
  if (Test-Path -LiteralPath $regPath) {
    try {
      $reg = Read-JsonMap $regPath
      if ($reg.ContainsKey('providers') -and ($reg['providers'] -is [System.Collections.IEnumerable])) {
        foreach ($pDef in $reg['providers']) {
          if ($pDef -is [hashtable] -and $pDef['id'] -eq $canonical -and $pDef.ContainsKey('capabilities')) {
            $caps = $pDef['capabilities']
            if (-not $finalCtx -and $model -and $caps.ContainsKey('knownModels') -and $caps['knownModels'].ContainsKey($model)) {
              $km = $caps['knownModels'][$model]
              if ($km.ContainsKey('contextTokens') -and [int]$km['contextTokens'] -gt 0) {
                $finalCtx = [string]$km['contextTokens']
              }
            }
            if (-not $finalCtx -and $caps.ContainsKey('defaultContextTokens') -and [int]$caps['defaultContextTokens'] -gt 0) {
              $finalCtx = [string]$caps['defaultContextTokens']
            }
            if (-not $finalRetries -and $caps.ContainsKey('defaultRetries')) {
              $finalRetries = [string]$caps['defaultRetries']
            }
            break
          }
        }
      }
    } catch {}
  }

  if (-not $finalCtx -and $envBlock.ContainsKey('ANTHROPIC_BASE_URL') -and [string]$envBlock['ANTHROPIC_BASE_URL']) {
    $finalCtx = '200000'
  }

  return @{ ContextTokens = $finalCtx; Retries = $finalRetries }
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

  $dynCaps = Get-ProviderCapabilities $providerFile
  if (-not $merged.ContainsKey('env') -or -not ($merged['env'] -is [hashtable])) { $merged['env'] = @{} }
  $provEnv = if ($prov.ContainsKey('env') -and ($prov['env'] -is [hashtable])) { $prov['env'] } else { @{} }
  if (-not $provEnv.ContainsKey('CLAUDE_CODE_MAX_CONTEXT_TOKENS') -and $dynCaps.ContextTokens) {
    $merged['env']['CLAUDE_CODE_MAX_CONTEXT_TOKENS'] = [string]$dynCaps.ContextTokens
  }
  if (-not $provEnv.ContainsKey('CLAUDE_CODE_MAX_RETRIES') -and $dynCaps.Retries) {
    $merged['env']['CLAUDE_CODE_MAX_RETRIES'] = [string]$dynCaps.Retries
  }

  return $merged
}

# Provider names: every .json.example template, plus any local .json a user
# added by hand. Sorted and de-duplicated.
function Get-ProviderList {
  $names = @()
  foreach ($f in Get-ChildItem -LiteralPath $PDir -Filter '*.json.example' -ErrorAction SilentlyContinue) {
    $names += (Resolve-Provider ($f.Name -replace '\.json\.example$', ''))
  }
  foreach ($f in Get-ChildItem -LiteralPath $PDir -Filter '*.json' -ErrorAction SilentlyContinue) {
    $names += (Resolve-Provider ($f.Name -replace '\.json$', ''))
  }
  return $names | Where-Object { $_ -notin @('google', 'antigravity', 'registry') } | Sort-Object -Unique
}

function Initialize-Provider($p) {
  $resolved = Resolve-Provider $p
  $f = Join-Path $PDir "$resolved.json"
  if (-not (Test-Path -LiteralPath $f)) {
    if ($resolved -eq 'orcarouter') {
      $legacy = Join-Path $PDir 'orca.json'
      if (Test-Path -LiteralPath $legacy) {
        Move-Item -LiteralPath $legacy -Destination $f -Force
        Protect-ProviderFile $f
        "Migrated legacy providers/orca.json to providers/orcarouter.json." | Write-Host
      }
    }
    elseif ($resolved -eq 'onerouter') {
      $legacy = Join-Path $PDir 'one.json'
      if (Test-Path -LiteralPath $legacy) {
        Move-Item -LiteralPath $legacy -Destination $f -Force
        Protect-ProviderFile $f
        "Migrated legacy providers/one.json to providers/onerouter.json." | Write-Host
      }
    }
  }
  if (-not (Test-Path -LiteralPath $f)) {
    $ex = Join-Path $PDir "$resolved.json.example"
    if (Test-Path -LiteralPath $ex) {
      Copy-Item -LiteralPath $ex -Destination $f -Force
      Protect-ProviderFile $f
      "Created providers/$resolved.json from template." | Write-Host
    } else {
      throw "no providers/$resolved.json or $resolved.json.example to seed from"
    }
  }
  if ((Get-Content -LiteralPath $f -Raw) -match '<[A-Z_]+>') {
    "WARNING: providers/$resolved.json still has placeholder values (<...>)." | Write-Host
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
    $ok = $client.ConnectAsync($uri.DnsSafeHost, $uri.Port).Wait(1500)
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

function Get-GoogleAdapter($p) {
  if ($p -eq 'agy') { return 'agy-cli' }
  $config = Read-JsonMap (Join-Path $PDir "$p.json")
  $adapter = 'gemini-api'
  if ($config['env']['GEMINI_GATEWAY_ADAPTER']) { $adapter = [string]$config['env']['GEMINI_GATEWAY_ADAPTER'] }
  if ($env:GEMINI_GATEWAY_ADAPTER) { $adapter = $env:GEMINI_GATEWAY_ADAPTER }
  if ($adapter -notin @('gemini-api', 'vertex')) { throw 'ccs gemini accepts only gemini-api or vertex; no AGY fallback' }
  return $adapter
}

function Invoke-GooglePreflight($p) {
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { throw 'Bun is required for the Google gateway' }
  $script = Join-Path $env:CLAUDE_DIR 'gateways/claude-gemini-gateway/src/index.ts'
  if (-not (Test-Path -LiteralPath $script)) { throw 'Google gateway submodule is unavailable' }
  $previousConfig = $env:GEMINI_GATEWAY_CONFIG
  $previousAdapter = $env:GEMINI_GATEWAY_ADAPTER
  try {
    $env:GEMINI_GATEWAY_CONFIG = Join-Path $PDir "$p.json"
    $env:GEMINI_GATEWAY_ADAPTER = Get-GoogleAdapter $p
    & bun run $script preflight
    if ($LASTEXITCODE -ne 0) { throw 'Google preflight failed; active provider and settings remain unchanged' }
  } finally {
    $env:GEMINI_GATEWAY_CONFIG = $previousConfig
    $env:GEMINI_GATEWAY_ADAPTER = $previousAdapter
  }
}

function Get-GoogleOwnedProcess($pidFile) {
  if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
  $gatewayPid = 0
  if (-not [int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$gatewayPid)) { throw 'Invalid Google gateway pidfile' }
  $process = Get-Process -Id $gatewayPid -ErrorAction SilentlyContinue
  if (-not $process) { return $null }
  $commandLine = if ($env:OS -eq 'Windows_NT') { (Get-CimInstance Win32_Process -Filter "ProcessId = $gatewayPid").CommandLine } else { (& ps -p $gatewayPid -o args=) -join ' ' }
  $script = Join-Path $env:CLAUDE_DIR 'gateways/claude-gemini-gateway/src/index.ts'
  if (-not $commandLine.Contains($script) -or $commandLine -notmatch '\bserve\b') { throw 'Google pidfile points at an unrelated process; left untouched' }
  return $process
}

function Stop-GoogleOwnedProcess($process) {
  if ($env:OS -eq 'Windows_NT') { & taskkill /pid $process.Id /t /f | Out-Null }
  else { & kill -TERM $process.Id; if (-not $process.WaitForExit(5000)) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue } }
}

function Stop-GoogleGateway {
  $pidFile = Join-Path $env:CLAUDE_DIR 'state/gemini-gateway.pid'
  $metaFile = Join-Path $env:CLAUDE_DIR 'state/gemini-gateway.meta'
  $owned = Get-GoogleOwnedProcess $pidFile
  if ($owned) { Stop-GoogleOwnedProcess $owned }
  Remove-Item $pidFile, $metaFile -ErrorAction SilentlyContinue
}

function Get-GoogleGatewayUrl($p) {
  $config = Read-JsonMap (Join-Path $PDir "$p.json")
  $gatewayHost = if ($env:GEMINI_GATEWAY_HOST) { $env:GEMINI_GATEWAY_HOST } else { $config['env']['GEMINI_GATEWAY_HOST'] }
  if (-not $gatewayHost) { $gatewayHost = '127.0.0.1' }
  if ($gatewayHost -notin @('127.0.0.1', 'localhost', '::1')) { throw 'Google gateway must use loopback' }
  if ($gatewayHost -eq '::1') { $gatewayHost = '[::1]' }
  $port = if ($env:GEMINI_GATEWAY_PORT) { $env:GEMINI_GATEWAY_PORT } else { $config['env']['GEMINI_GATEWAY_PORT'] }
  if (-not $port) { $port = '4141' }
  return "http://${gatewayHost}:$port"
}

function Start-GoogleGateway($p) {
  $stateDir = Join-Path $env:CLAUDE_DIR 'state'
  if (-not (Test-Path -LiteralPath $stateDir)) { New-Item -ItemType Directory -Path $stateDir | Out-Null }
  $pidFile = Join-Path $stateDir 'gemini-gateway.pid'
  $metaFile = Join-Path $stateDir 'gemini-gateway.meta'
  $script = Join-Path $env:CLAUDE_DIR 'gateways/claude-gemini-gateway/src/index.ts'
  $configFile = Join-Path $PDir "$p.json"
  $adapter = Get-GoogleAdapter $p
  $signatureParts = @($p, $adapter, (Get-FileHash -LiteralPath $configFile -Algorithm SHA256).Hash)
  foreach ($file in Get-ChildItem (Split-Path $script) -Recurse -File | Sort-Object FullName) { $signatureParts += (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash }
  foreach ($key in @('AGY_GATEWAY_BIN', 'AGY_GATEWAY_MODEL', 'AGY_GATEWAY_EFFORT', 'GEMINI_GATEWAY_MODEL', 'GEMINI_MODEL', 'GEMINI_GATEWAY_PORT', 'GEMINI_GATEWAY_HOST', 'GEMINI_GATEWAY_TIMEOUT_MS', 'GEMINI_GATEWAY_API_BASE_URL', 'GEMINI_API_KEY', 'GOOGLE_OAUTH_TOKEN', 'VERTEX_PROJECT_ID', 'GOOGLE_CLOUD_PROJECT', 'ANTHROPIC_VERTEX_PROJECT_ID')) { $signatureParts += [Environment]::GetEnvironmentVariable($key) }
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $signature = [Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($signatureParts -join "`n")))) } finally { $sha.Dispose() }
  $owned = Get-GoogleOwnedProcess $pidFile
  $metadata = @{}
  if (Test-Path -LiteralPath $metaFile) { try { $metadata = Read-JsonMap $metaFile } catch { $metadata = @{} } }
  if ($owned -and $metadata['signature'] -eq $signature) {
    try { $health = Invoke-RestMethod "$(Get-GoogleGatewayUrl $p)/health" -TimeoutSec 2; if ($health.ok -and $health.adapter -eq $adapter) { return } } catch { $health = $null }
  }
  $uri = [uri](Get-GoogleGatewayUrl $p)
  $client = [Net.Sockets.TcpClient]::new()
  $occupied = $false
  try { $occupied = $client.ConnectAsync($uri.DnsSafeHost, $uri.Port).Wait(1000) } catch { $occupied = $false } finally { $client.Dispose() }
  if ($occupied -and (-not $owned -or $metadata['url'] -ne $uri.AbsoluteUri.TrimEnd('/'))) { throw 'Google target endpoint is occupied; previous runtime/provider left unchanged' }
  if ($owned) { Stop-GoogleOwnedProcess $owned }
  $previousConfig = $env:GEMINI_GATEWAY_CONFIG
  $previousAdapter = $env:GEMINI_GATEWAY_ADAPTER
  try {
    $env:GEMINI_GATEWAY_CONFIG = $configFile
    $env:GEMINI_GATEWAY_ADAPTER = $adapter
    if ($script.Contains('"')) { throw 'Unsupported gateway source path' }
    $started = Start-Process (Get-Command bun).Source -ArgumentList @('run', ('"' + $script + '"'), 'serve') -PassThru -RedirectStandardOutput (Join-Path $stateDir 'gemini-gateway.log') -RedirectStandardError (Join-Path $stateDir 'gemini-gateway.err.log')
    Set-Content -LiteralPath $pidFile -Value $started.Id
    @{ signature = $signature; url = (Get-GoogleGatewayUrl $p); provider = $p } | ConvertTo-Json | Set-Content -LiteralPath $metaFile
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
      Start-Sleep -Milliseconds 100
      try { $health = Invoke-RestMethod "$(Get-GoogleGatewayUrl $p)/health" -TimeoutSec 1; if ($health.ok -and $health.adapter -eq $adapter -and -not $started.HasExited) { return } } catch { $health = $null }
    }
    if (-not $started.HasExited) { Stop-GoogleOwnedProcess $started }
    Remove-Item $pidFile, $metaFile -ErrorAction SilentlyContinue
    throw 'Google gateway startup failed; provider remains unchanged'
  } finally {
    $env:GEMINI_GATEWAY_CONFIG = $previousConfig
    $env:GEMINI_GATEWAY_ADAPTER = $previousAdapter
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
  if (Test-GoogleProvider $p) { Invoke-GooglePreflight $p; $merged['env']['ANTHROPIC_BASE_URL'] = Get-GoogleGatewayUrl $p; Start-GoogleGateway $p }

  # Written whole to a temp file, then swapped: a half-written settings.json is
  # a broken Claude Code, and this file is read at startup.
  $tmp = "$Settings.tmp"
  Set-Content -LiteralPath $tmp -Value ($merged | ConvertTo-Json -Depth 32) -Encoding utf8NoBOM
  Move-Item -LiteralPath $tmp -Destination $Settings -Force

  Set-Content -LiteralPath $Active -Value $p -NoNewline
  "Active provider: $p"
  if (-not (Test-GoogleProvider $p)) { try { Stop-GoogleGateway } catch { Write-Warning 'Unrelated Google pidfile process was left untouched' } }
  Write-WarningIfLocalEndpointDown $p
  "Restart Claude Code for the change to take effect (env is read at startup)."
}

function Show-Usage {
  "usage: cc-provider.ps1 [list|status|doctor|models|account|usage|permissions|use <provider>|auth <provider>|login <provider>|api <provider>|logout <provider>|<provider>]" | Write-Host
  "  agy / gemini      native AGY session / separately authenticated API or Vertex" | Write-Host
  "  list              list available providers" | Write-Host
  "  status            print the active provider and auth summary" | Write-Host
  "  use <provider>    activate it (compatibility shorthand: cc-provider.ps1 <provider>)" | Write-Host
  "  auth <provider>   show auth mode or fill an API key when needed" | Write-Host
  "  login <provider>  fill an API key; codex/chatgpt delegates to official codex login" | Write-Host
  "  api <provider>    fill an API key in providers\<provider>.json" | Write-Host
  "  logout <provider> clear a local API key; codex/chatgpt delegates to codex logout" | Write-Host
  "  models            list the active Google gateway catalog" | Write-Host
  "  account           show supported Codex account/auth details" | Write-Host
  "  usage             show supported Codex usage and rate-limit details" | Write-Host
  "  permissions       show Claude/Codex permission and Auto ownership" | Write-Host
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
  'models' {
    if ($Rest.Count -gt 0) { throw 'models accepts no arguments' }
    if (-not (Test-Path -LiteralPath $Active)) { throw 'Activate a Google provider before querying its models' }
    $p = (Get-Content -LiteralPath $Active -Raw).Trim()
    if (-not (Test-GoogleProvider $p)) { throw 'This PowerShell catalog command requires active agy or gemini' }
    Invoke-GooglePreflight $p
    Start-GoogleGateway $p
    (Invoke-RestMethod "$(Get-GoogleGatewayUrl $p)/v1/models").data | ForEach-Object { $_.id }
  }
  'account' {
    if ($Rest.Count -gt 0) { throw 'account accepts no arguments' }
    Show-CodexAccount
  }
  'usage' {
    if ($Rest.Count -gt 0) { throw 'usage accepts no arguments' }
    Show-CodexUsage
  }
  'permissions' {
    if ($Rest.Count -gt 0) { throw 'permissions accepts no arguments' }
    Show-PermissionMatrix
  }
  'update' {
    Write-Host 'ccs update is not supported. Use fkt update to update the toolkit, provider registry, and components.'
    exit 1
  }
  'use' {
    $p = Assert-ProviderArg 'use' $Rest
    $resolved = Resolve-Provider $p
    if ((Get-ProviderList) -contains $resolved) { Enable-Provider $resolved } else { throw "unknown provider: $p" }
  }
  'auth' {
    $p = Assert-ProviderArg 'auth' $Rest
    $resolved = Resolve-Provider $p
    if (Test-CodexEntitlement $resolved) { Write-ProviderAuthStatus $resolved; return }
    if ($resolved -eq 'agy') { Write-ProviderAuthStatus $resolved; return }
    if ($resolved -eq 'gemini') {
      Write-ProviderAuthStatus $resolved
      if (-not (Test-OfficialGoogleCredential $resolved)) { Set-ProviderApiKey $resolved }
      return
    }
    if ((Get-ProviderList) -notcontains $resolved) { throw "unknown provider: $p" }
    Initialize-Provider $resolved
    Write-ProviderAuthStatus $resolved
    $key = Get-CredentialKey $resolved
    $value = ''
    if (-not [string]::IsNullOrEmpty($key)) { $value = Get-CredentialValue $resolved $key }
    if ([string]::IsNullOrEmpty($value) -or $value -match '^<') { Set-ProviderApiKey $resolved }
  }
  'login' {
    $p = Assert-ProviderArg 'login' $Rest
    $resolved = Resolve-Provider $p
    if ($resolved -eq 'agy') { throw 'AGY owns login; run the official agy CLI to sign in.' }
    if (Test-CodexEntitlement $resolved) { Invoke-Codex login } else { Set-ProviderApiKey $resolved }
  }
  'api' {
    $p = Assert-ProviderArg 'api' $Rest
    $resolved = Resolve-Provider $p
    Set-ProviderApiKey $resolved
  }
  'logout' {
    $p = Assert-ProviderArg 'logout' $Rest
    $resolved = Resolve-Provider $p
    Clear-ProviderAuth $resolved
  }
  '-h' { Show-Usage; exit 0 }
  '--help' { Show-Usage; exit 0 }
  default {
    $resolved = Resolve-Provider $Command
    if ($Command -and ((Get-ProviderList) -contains $resolved) -and $Rest.Count -eq 0) {
      Enable-Provider $resolved
    } else {
      if ($Command) { "cc-provider.ps1: unknown provider or command: $Command" | Write-Host; '' | Write-Host }
      Show-Usage
      exit 1
    }
  }
}
