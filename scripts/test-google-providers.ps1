# Canonical provider activation using real gateway code and disposable fixture credentials.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$taskDir = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
$previousDir = $env:CLAUDE_DIR
$previousKey = $env:GEMINI_API_KEY
$previousBase = $env:GEMINI_GATEWAY_API_BASE_URL
$previousBinary = $env:AGY_GATEWAY_BIN
$previousAdapter = $env:GEMINI_GATEWAY_ADAPTER
$api = $null
try {
  New-Item -ItemType Directory -Path (Join-Path $taskDir 'providers'), (Join-Path $taskDir 'gateways') -Force | Out-Null
  Copy-Item (Join-Path $repo 'gateways/claude-gemini-gateway') (Join-Path $taskDir 'gateways/claude-gemini-gateway') -Recurse
  Copy-Item (Join-Path $repo 'settings.base.json') $taskDir
  foreach ($p in @('anthropic', 'agy', 'gemini')) { Copy-Item (Join-Path $repo "providers/$p.json.example") (Join-Path $taskDir 'providers') }
  $env:CLAUDE_DIR = $taskDir
  $env:GEMINI_API_KEY = ''
  $env:GEMINI_GATEWAY_ADAPTER = ''
  $switcher = Join-Path $repo 'bin/cc-provider.ps1'
  & $switcher anthropic | Out-Null
  $settings = Join-Path $taskDir 'settings.json'
  $before = (Get-FileHash $settings).Hash
  foreach ($command in @('gemini', 'google', 'antigravity', 'agy')) {
    $env:AGY_GATEWAY_BIN = Join-Path $taskDir 'missing-agy.exe'
    $failed = $false
    try { & $switcher $command | Out-Null } catch { $failed = $true }
    if (-not $failed) { throw "$command incorrectly activated" }
    if ((Get-Content (Join-Path $taskDir 'providers/.active') -Raw).Trim() -ne 'anthropic' -or (Get-FileHash $settings).Hash -ne $before) { throw 'Failed activation changed state' }
  }
  $apiScript = Join-Path $taskDir 'api.ts'
  $apiPortFile = Join-Path $taskDir 'api-port'
  @'
const server=Bun.serve({port:0,hostname:'127.0.0.1',async fetch(req){
if(req.headers.get('x-goog-api-key')!=='fixture-key')return new Response('denied',{status:401});
const body=await req.json();const text=body.contents[0].parts[0].text.replace('Reply exactly ','');
return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]});
}});await Bun.write(process.argv[2],String(server.port));
'@ | Set-Content $apiScript -Encoding utf8NoBOM
  $api = Start-Process (Get-Command bun).Source -ArgumentList @('run', ('"' + $apiScript + '"'), ('"' + $apiPortFile + '"')) -PassThru
  for ($i = 0; $i -lt 50 -and -not (Test-Path $apiPortFile); $i++) { Start-Sleep -Milliseconds 100 }
  $env:GEMINI_GATEWAY_API_BASE_URL = 'http://127.0.0.1:' + (Get-Content $apiPortFile -Raw).Trim()
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
  $config = Get-Content (Join-Path $taskDir 'providers/gemini.json.example') -Raw | ConvertFrom-Json -AsHashtable
  $config['env']['GEMINI_GATEWAY_MODEL'] = 'fixture-model'
  $config['env']['GEMINI_GATEWAY_PORT'] = [string]$port
  $config['env']['ANTHROPIC_BASE_URL'] = "http://127.0.0.1:$port"
  $config | ConvertTo-Json -Depth 32 | Set-Content (Join-Path $taskDir 'providers/gemini.json') -Encoding utf8NoBOM
  $env:GEMINI_API_KEY = 'fixture-key'
  $config['env']['GEMINI_GATEWAY_PORT'] = (Get-Content $apiPortFile -Raw).Trim()
  $config | ConvertTo-Json -Depth 32 | Set-Content (Join-Path $taskDir 'providers/gemini.json') -Encoding utf8NoBOM
  $failed = $false
  try { & $switcher gemini | Out-Null } catch { $failed = $true }
  if (-not $failed -or (Get-FileHash $settings).Hash -ne $before) { throw 'Occupied endpoint changed state' }
  $config['env']['GEMINI_GATEWAY_PORT'] = [string]$port
  $config | ConvertTo-Json -Depth 32 | Set-Content (Join-Path $taskDir 'providers/gemini.json') -Encoding utf8NoBOM
  & $switcher gemini | Out-Null
  if ((Get-Content (Join-Path $taskDir 'providers/.active') -Raw).Trim() -ne 'gemini') { throw 'Supported fixture credentials did not activate' }
  $health = Invoke-RestMethod "http://127.0.0.1:$port/health"
  if ($health.adapter -ne 'gemini-api') { throw 'Wrong adapter' }
  $before = (Get-FileHash $settings).Hash
  $env:GEMINI_API_KEY = 'invalid-fixture-key'
  $failed = $false
  try { & $switcher gemini | Out-Null } catch { $failed = $true }
  if (-not $failed -or (Get-FileHash $settings).Hash -ne $before) { throw 'Rejected credentials changed settings' }
  Write-Host 'PowerShell Google provider preflight, canonical routing and failure atomicity passed.'
} finally {
  $pidFile = Join-Path $taskDir 'state/gemini-gateway.pid'
  if (Test-Path $pidFile) { Stop-Process -Id ([int](Get-Content $pidFile -Raw)) -ErrorAction SilentlyContinue }
  if ($api) { Stop-Process -Id $api.Id -ErrorAction SilentlyContinue }
  $env:CLAUDE_DIR = $previousDir
  $env:GEMINI_API_KEY = $previousKey
  $env:GEMINI_GATEWAY_API_BASE_URL = $previousBase
  $env:AGY_GATEWAY_BIN = $previousBinary
  $env:GEMINI_GATEWAY_ADAPTER = $previousAdapter
  Remove-Item $taskDir -Recurse -Force -ErrorAction SilentlyContinue
}
