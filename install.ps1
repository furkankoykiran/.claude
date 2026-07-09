#Requires -Version 5.1
<#
.SYNOPSIS
    Bootstrap furkankoykiran/.claude into $HOME\.claude on native Windows.

.DESCRIPTION
    Native PowerShell port of install.sh - no WSL required. WSL users already
    have a Linux userland, so they run the bash one-liner instead; this script
    is for people on real Windows (PowerShell / Windows Terminal).

    Same fail-soft philosophy as install.sh: git is the only hard requirement.
    Every other step (bun, gstack, rtk, manim, graphify) is optional. A step
    that can't complete is reported in the summary at the end instead of
    aborting the whole bootstrap. Re-running is safe (idempotent).

    gstack's setup is a bash script, so it is run through Git Bash (bash.exe,
    bundled with Git for Windows). Since git itself is required, Git Bash is
    almost always already present. On Windows the headless browser is driven by
    Node.js (Bun cannot launch Chromium there - oven-sh/bun#4253), so Node is
    checked for and recommended.

.PARAMETER Minimal
    Core install only (configs + gstack + rtk); skips the heavy upstream skill
    packs and manim. Equivalent to CLAUDE_BOOTSTRAP_MINIMAL=1.

.EXAMPLE
    irm https://raw.githubusercontent.com/furkankoykiran/.claude/main/install.ps1 | iex

.EXAMPLE
    .\install.ps1 -Minimal

.LINK
    https://github.com/furkankoykiran/.claude
#>
[CmdletBinding()]
param(
    [switch]$Minimal
)

# Fail-soft: we do NOT set $ErrorActionPreference='Stop' globally. Each step is
# wrapped in Invoke-Step (try/catch) so one failure never kills the run.
Set-StrictMode -Version Latest

$RepoUrl   = 'https://github.com/furkankoykiran/.claude.git'
$GstackRepo = 'https://github.com/garrytan/gstack.git'
$ClaudeDir = if ($env:CLAUDE_DIR) { $env:CLAUDE_DIR } else { Join-Path $HOME '.claude' }
$IsMinimal = $Minimal.IsPresent -or ($env:CLAUDE_BOOTSTRAP_MINIMAL -eq '1')

$script:FailedSteps = @()

# ---------------------------------------------------------------------------
# Output helpers (colored, mirror install.sh's log/warn/die)
# ---------------------------------------------------------------------------
function Write-Step  { param([string]$Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Warn { param([string]$Message) Write-Host "!! $Message"  -ForegroundColor Yellow }
function Write-Die  { param([string]$Message) Write-Host "xx $Message"  -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------------------
# Small utilities
# ---------------------------------------------------------------------------
function Test-Command {
    param([Parameter(Mandatory)][string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# Reload PATH from the registry plus the dirs installers drop binaries into, so
# tools installed earlier in this run are visible to later steps.
function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $extra   = @(
        (Join-Path $HOME '.bun\bin')
        (Join-Path $HOME '.local\bin')
        (Join-Path $env:APPDATA 'Python\Scripts')
    )
    $env:Path = (@($machine, $user) + $extra | Where-Object { $_ } ) -join ';'
}

# Detect a usable Python launcher (py -3 / python / python3).
function Get-PythonCommand {
    foreach ($candidate in @('py', 'python', 'python3')) {
        if (Test-Command $candidate) {
            $prefixArgs = if ($candidate -eq 'py') { @('-3') } else { @() }
            return [pscustomobject]@{ Exe = $candidate; Prefix = $prefixArgs }
        }
    }
    return $null
}

# Locate Git Bash (bash.exe) so we can run gstack's bash setup natively.
function Find-GitBash {
    $cmd = Get-Command bash -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Git\bin\bash.exe')
        (Join-Path ${env:ProgramFiles(x86)} 'Git\bin\bash.exe')
        (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe')
    )
    foreach ($path in $candidates) {
        if ($path -and (Test-Path $path)) { return $path }
    }
    return $null
}

# Run one optional step; record (but swallow) failures.
function Invoke-Step {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][scriptblock]$Action
    )
    try {
        & $Action
    }
    catch {
        Write-Warn "step skipped/failed: $Label ($($_.Exception.Message)) - continuing"
        $script:FailedSteps += $Label
    }
}

# ---------------------------------------------------------------------------
# 1. Sync the repo at $ClaudeDir
# ---------------------------------------------------------------------------
function Initialize-Repo {
    if (Test-Path (Join-Path $ClaudeDir '.git')) {
        Write-Step "Updating existing repo at $ClaudeDir"
        git -C $ClaudeDir fetch origin
        git -C $ClaudeDir reset --hard origin/main
    }
    elseif (Test-Path $ClaudeDir) {
        Write-Step "Initializing git in existing $ClaudeDir"
        git -C $ClaudeDir init -b main | Out-Null
        git -C $ClaudeDir remote add origin $RepoUrl 2>$null
        if ($LASTEXITCODE -ne 0) {
            git -C $ClaudeDir remote set-url origin $RepoUrl
        }
        git -C $ClaudeDir fetch origin
        git -C $ClaudeDir reset --hard origin/main
        git -C $ClaudeDir branch --set-upstream-to=origin/main main 2>$null
    }
    else {
        Write-Step "Cloning $RepoUrl into $ClaudeDir"
        git clone $RepoUrl $ClaudeDir
    }
    if ($LASTEXITCODE -ne 0) { throw "git sync failed (exit $LASTEXITCODE)" }
}

# ---------------------------------------------------------------------------
# 2. Seed personal config from the example templates (never overwrite)
# ---------------------------------------------------------------------------
function Set-SeedConfig {
    foreach ($name in @('config.json', 'settings.json')) {
        $target  = Join-Path $ClaudeDir $name
        $example = Join-Path $ClaudeDir "$name.example"
        if ((-not (Test-Path $target)) -and (Test-Path $example)) {
            Copy-Item $example $target
            Write-Step "Seeded $name from $name.example (edit it with your values)"
        }
    }
}

# ---------------------------------------------------------------------------
# 3. Install bun (gstack dependency)
# ---------------------------------------------------------------------------
function Install-Bun {
    # Invoke-Expression is the documented way to run bun's official Windows
    # installer (irm bun.sh/install.ps1 | iex); the source is a trusted vendor URL.
    [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingInvokeExpression', '')]
    param()
    Update-SessionPath
    if (Test-Command 'bun') { return }
    Write-Step 'Installing bun (required by gstack)'
    Invoke-Expression (Invoke-RestMethod 'https://bun.sh/install.ps1')
    Update-SessionPath
    if (-not (Test-Command 'bun')) {
        throw 'bun not on PATH after install - open a new terminal or install from https://bun.sh'
    }
}

# ---------------------------------------------------------------------------
# 4. Ensure Node.js (gstack drives Chromium via Node on Windows)
# ---------------------------------------------------------------------------
function Test-NodeRuntime {
    Update-SessionPath
    if (Test-Command 'node') { return }
    if (Test-Command 'winget') {
        Write-Step 'Installing Node.js LTS via winget (gstack needs it on Windows)'
        winget install --id OpenJS.NodeJS.LTS -e --source winget `
            --accept-package-agreements --accept-source-agreements
        Update-SessionPath
    }
    if (-not (Test-Command 'node')) {
        throw 'Node.js not found. gstack''s browser needs it on Windows. Install from https://nodejs.org/ and re-run.'
    }
}

# ---------------------------------------------------------------------------
# 5. Install gstack (clone + run its bash setup through Git Bash)
# ---------------------------------------------------------------------------
function Install-Gstack {
    $gstackDir = Join-Path $ClaudeDir 'skills\gstack'
    if (Test-Path (Join-Path $gstackDir '.git')) {
        Write-Step 'Updating gstack'
        git -C $gstackDir pull --ff-only origin main 2>$null
    }
    else {
        Write-Step "Cloning gstack into $gstackDir"
        git clone --depth 1 $GstackRepo $gstackDir
        if ($LASTEXITCODE -ne 0) { throw "gstack clone failed (exit $LASTEXITCODE)" }
    }

    $bash = Find-GitBash
    if (-not $bash) {
        throw 'Git Bash (bash.exe) not found. gstack''s setup is a bash script. Install Git for Windows (https://git-scm.com/download/win), which bundles Git Bash, then re-run.'
    }

    Write-Step "Running gstack setup via Git Bash ($bash)"
    # bash inherits the Windows CWD, so ./setup resolves relative to it - no
    # path conversion needed. Windows bundles Chromium's libraries, so there is
    # no libatk-style dependency step here (that's Linux-only).
    Push-Location $gstackDir
    try {
        & $bash './setup' '--no-prefix'
        if ($LASTEXITCODE -ne 0) {
            throw "gstack setup exited $LASTEXITCODE. Browser skills (/browse, /qa) may not work; ensure Node.js is installed."
        }
    }
    finally {
        Pop-Location
    }
}

# ---------------------------------------------------------------------------
# 6. Install rtk (token-saving CLI proxy)
# ---------------------------------------------------------------------------
function Install-Rtk {
    Update-SessionPath
    if (-not (Test-Command 'rtk')) {
        if (Test-Command 'winget') {
            Write-Step 'Installing rtk via winget'
            winget install --id rtk-ai.rtk -e --source winget `
                --accept-package-agreements --accept-source-agreements
            Update-SessionPath
        }
        else {
            throw 'rtk not installed and winget unavailable. Download rtk-x86_64-pc-windows-msvc.zip from https://github.com/rtk-ai/rtk/releases, add rtk.exe to PATH, then re-run.'
        }
    }
    if (-not (Test-Command 'rtk')) {
        throw 'rtk still not on PATH - open a new terminal or add it manually.'
    }
    # NOTE: on native Windows rtk's PreToolUse hook auto-install is limited
    # (rtk-ai/rtk#671). We attempt it; filters work even if the hook doesn't.
    Write-Step 'Initializing rtk hook (best-effort on native Windows)'
    rtk init -g --hook-only --auto-patch 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Warn 'rtk init did not fully apply on Windows - token filters still work; hook auto-rewrite is WSL-only. See README troubleshooting.'
    }
}

# ---------------------------------------------------------------------------
# Provider switcher (z.ai <-> Anthropic) — settings.json copy system
# ---------------------------------------------------------------------------
# settings.json is a COPY of providers/<active>.json (copy, not symlink, so it
# works on Windows where symlinks need admin/Developer Mode). Provider files
# are local (gitignored, hold auth tokens); *.json.example templates are
# tracked with a <ZAI_TOKEN>-style placeholder. `ccs` (-> bin/cc-provider.ps1)
# copies the chosen provider to settings.json and records it in providers/.active.
# Fresh installs opt in by running `ccs zai` once after filling the token.
function Set-Providers {
    $pdir = Join-Path $ClaudeDir 'providers'
    if (-not (Test-Path $pdir)) { New-Item -ItemType Directory -Path $pdir -Force | Out-Null }
    foreach ($p in @('zai', 'anthropic')) {
        $target  = Join-Path $pdir "$p.json"
        $example = Join-Path $pdir "$p.json.example"
        if ((-not (Test-Path $target)) -and (Test-Path $example)) {
            Copy-Item $example $target
            Write-Step "Seeded providers/$p.json from template (fill your token before switching to it)"
        }
    }
    Install-CcsProfile
}

# Add a `ccs` function to the user's PowerShell profile (idempotent).
# CurrentUserAllHosts so it loads in both Windows PowerShell and pwsh.
function Install-CcsProfile {
    $profilePath = $PROFILE.CurrentUserAllHosts
    $profileDir  = Split-Path $profilePath -Parent
    if (-not (Test-Path $profileDir)) { New-Item -ItemType Directory -Path $profileDir -Force | Out-Null }
    if (-not (Test-Path $profilePath)) { New-Item -ItemType File -Path $profilePath -Force | Out-Null }
    $existing = Get-Content -LiteralPath $profilePath -Raw -ErrorAction SilentlyContinue
    if ($existing -match 'cc-provider') { return }
    $entry = "`r`n# Claude Code provider switcher (managed by ~/.claude/install.ps1)`r`nfunction ccs { & `"$HOME\.claude\bin\cc-provider.ps1`" @args }`r`n"
    Add-Content -LiteralPath $profilePath -Value $entry
    Write-Step "Added 'ccs' function to $profilePath (open a new shell)"
}

# ---------------------------------------------------------------------------
# 7. Install manim-narration runtime deps (manim + edge-tts + ffmpeg)
# ---------------------------------------------------------------------------
function Install-ManimRuntime {
    $py = Get-PythonCommand
    if (-not $py) {
        throw 'python not found - skipping manim/edge-tts. Install from https://python.org/ if you want the manim-narration skill.'
    }

    $needManim = $false
    $needEdge  = $false
    & $py.Exe @($py.Prefix) -c 'import manim'    2>$null; if ($LASTEXITCODE -ne 0) { $needManim = $true }
    & $py.Exe @($py.Prefix) -c 'import edge_tts' 2>$null; if ($LASTEXITCODE -ne 0) { $needEdge  = $true }

    if ($needManim -or $needEdge) {
        $pkgs = @()
        if ($needManim) { $pkgs += 'manim' }
        if ($needEdge)  { $pkgs += 'edge-tts' }
        Write-Step "Installing Python deps for manim-narration: $($pkgs -join ', ')"
        # Windows ships prebuilt wheels for manimpango/pycairo, so no C toolchain
        # is needed (unlike Linux). pip --user keeps it out of system Python.
        & $py.Exe @($py.Prefix) -m pip install --user --upgrade @pkgs
        if ($LASTEXITCODE -ne 0) { Write-Warn "pip install failed for: $($pkgs -join ', ')" }
    }

    if (-not (Test-Command 'ffmpeg')) {
        if (Test-Command 'winget') {
            Write-Step 'Installing ffmpeg via winget'
            winget install --id Gyan.FFmpeg -e --source winget `
                --accept-package-agreements --accept-source-agreements
            Update-SessionPath
        }
        else {
            Write-Warn 'ffmpeg missing and winget unavailable - install it (https://ffmpeg.org/) for manim-narration rendering.'
        }
    }
}

# ---------------------------------------------------------------------------
# 8. Install graphify (knowledge-graph skill)
# ---------------------------------------------------------------------------
function Install-Graphify {
    $py = Get-PythonCommand
    if (-not $py) { throw 'python not found - skipping graphify.' }

    Update-SessionPath
    # Always pass --upgrade so re-running the bootstrap pulls the latest graphifyy,
    # mirroring the git skill packs (which reset to upstream HEAD on every run).
    # pip --upgrade is a fast no-op when already current.
    Write-Step 'Installing/upgrading graphifyy (graphify CLI)'
    & $py.Exe @($py.Prefix) -m pip install --user --upgrade graphifyy
    $pipOk = ($LASTEXITCODE -eq 0)
    Update-SessionPath
    if (-not $pipOk) {
        # pip missing or PEP 668 blocked --user: pipx is the right installer for a
        # CLI app (mirrors install.sh's fallback).
        if (Test-Command 'pipx') {
            Write-Warn 'pip install failed - falling back to pipx for graphifyy'
            pipx install graphifyy 2>$null
            if ($LASTEXITCODE -ne 0) { pipx upgrade graphifyy 2>$null }
            Update-SessionPath
        }
        # A prior install can still be wired; only give up if there's none.
        if (-not (Test-Command 'graphify')) {
            throw 'graphifyy install failed (no working pip; pipx fallback unavailable or failed). Run: python -m pip install --user --upgrade graphifyy'
        }
    }

    if (-not (Test-Command 'graphify')) {
        Write-Warn 'graphify installed but not on PATH. Add your pip --user Scripts dir (e.g. %APPDATA%\Python\Scripts) to PATH, then run: graphify install'
        return
    }
    Write-Step 'Wiring graphify skill into Claude Code'
    graphify install
    if ($LASTEXITCODE -ne 0) { Write-Warn "graphify install returned non-zero - check $ClaudeDir\skills\graphify\" }
}

# ---------------------------------------------------------------------------
# 9. Upstream skill packs (parity with install.sh)
# ---------------------------------------------------------------------------
# Each pack is cloned into a gitignored staging dir under skills/ and its skill
# subdirectories are copied to the top level so Claude Code auto-discovers them.

function Update-SkillStage {
    param([Parameter(Mandatory)][string]$Repo, [Parameter(Mandatory)][string]$StageDir)
    if (Test-Path (Join-Path $StageDir '.git')) {
        git -C $StageDir fetch origin --depth 1 2>$null
        git -C $StageDir reset --hard origin/HEAD 2>$null
    }
    else {
        git clone --depth 1 $Repo $StageDir
        if ($LASTEXITCODE -ne 0) { throw "clone failed: $Repo" }
    }
}

function Copy-SkillDir {
    param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$DestName)
    $dest = Join-Path $ClaudeDir "skills\$DestName"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item -Path (Join-Path $Source '*') -Destination $dest -Recurse -Force
}

function Install-ManimUpstream {
    $stage = Join-Path $ClaudeDir 'skills\.manim_upstream_src'
    Update-SkillStage 'https://github.com/adithya-s-k/manim_skill.git' $stage
    foreach ($s in @('manimce-best-practices', 'manimgl-best-practices', 'manim-composer')) {
        $src = Join-Path $stage "skills\$s"
        if (Test-Path $src) {
            Copy-SkillDir $src $s
            $lic = Join-Path $stage 'LICENSE'
            if (Test-Path $lic) { Copy-Item $lic (Join-Path $ClaudeDir "skills\$s\UPSTREAM_LICENSE") -Force }
            Write-Step "Synced upstream skill: $s"
        }
    }
}

function Install-KarpathySkill {
    $stage = Join-Path $ClaudeDir 'skills\.karpathy_upstream_src'
    Update-SkillStage 'https://github.com/multica-ai/andrej-karpathy-skills.git' $stage
    $src = Join-Path $stage 'skills\karpathy-guidelines'
    if (Test-Path $src) {
        Copy-SkillDir $src 'karpathy-guidelines'
        Write-Step 'Synced upstream skill: karpathy-guidelines'
    }
}

# Copy every skills/* subdir from a staged collection, guarding existing dirs
# that did NOT come from this pack (a per-pack marker file tracks ownership).
function Install-SkillCollection {
    param(
        [Parameter(Mandatory)][string]$Repo,
        [Parameter(Mandatory)][string]$StageDir,
        [Parameter(Mandatory)][string]$Marker,
        [switch]$RequireSkillMd
    )
    Update-SkillStage $Repo $StageDir
    $count = 0
    $skillsRoot = Join-Path $StageDir 'skills'
    if (-not (Test-Path $skillsRoot)) { return }
    foreach ($dir in Get-ChildItem -Path $skillsRoot -Directory) {
        if ($RequireSkillMd -and -not (Test-Path (Join-Path $dir.FullName 'SKILL.md'))) { continue }
        $dest = Join-Path $ClaudeDir "skills\$($dir.Name)"
        if ((Test-Path $dest) -and -not (Test-Path (Join-Path $dest $Marker))) {
            Write-Warn "skipping collision (not from this pack): $($dir.Name)"
            continue
        }
        Copy-SkillDir $dir.FullName $dir.Name
        New-Item -ItemType File -Force -Path (Join-Path $dest $Marker) | Out-Null
        $count++
    }
    Write-Step "Synced $count skills from $Repo"
}

function Install-ImpeccableSkill {
    $stage = Join-Path $ClaudeDir 'skills\.impeccable_upstream_src'
    Update-SkillStage 'https://github.com/pbakaus/impeccable.git' $stage
    $src = Join-Path $stage '.claude\skills\impeccable'
    if (Test-Path $src) {
        Copy-SkillDir $src 'impeccable'
        Write-Step 'Synced upstream skill: impeccable'
    }
    else {
        Write-Warn "impeccable upstream layout changed - $src missing"
    }
}

# Curated always-on subset from anthropics/skills (office docs + authoring +
# meta). The rest of the repo stays on-demand via the plugin marketplace. Skips
# `claude-api` (name-collides with an existing skill) and skills that overlap
# existing packs (frontend-design, webapp-testing, canvas-design, algorithmic-art).
function Install-AnthropicSkill {
    $stage = Join-Path $ClaudeDir 'skills\.anthropic_upstream_src'
    Update-SkillStage 'https://github.com/anthropics/skills.git' $stage
    $count = 0
    foreach ($name in @('docx', 'pdf', 'pptx', 'xlsx', 'mcp-builder', 'skill-creator', 'web-artifacts-builder', 'doc-coauthoring')) {
        $src = Join-Path $stage "skills\$name"
        if (-not (Test-Path (Join-Path $src 'SKILL.md'))) { Write-Warn "anthropic skill missing upstream: $name"; continue }
        $dest = Join-Path $ClaudeDir "skills\$name"
        if ((Test-Path $dest) -and -not (Test-Path (Join-Path $dest '.from_anthropic'))) {
            Write-Warn "skipping collision (not from anthropics/skills): $name"
            continue
        }
        Copy-SkillDir $src $name
        New-Item -ItemType File -Force -Path (Join-Path $dest '.from_anthropic') | Out-Null
        $lic = Join-Path $stage 'LICENSE'
        if (Test-Path $lic) { Copy-Item $lic (Join-Path $dest 'UPSTREAM_LICENSE') -Force }
        $count++
    }
    Write-Step "Synced $count anthropic skills (claude-api skipped: name collision)"
}

# Breadth without catalog bloat: registering a marketplace is free per session;
# only INSTALLED plugins load. Register the big collections for on-demand use,
# eagerly install a curated domain set (backend/data/cloud/CI-CD/database) that
# fills gaps without conflicting with gstack. Fail-soft: needs the `claude` CLI.
function Register-PluginMarketplace {
    if (-not (Test-Command 'claude')) {
        Write-Step 'claude CLI not present - skipping plugin marketplaces (expected without Claude Code; re-run here once it''s installed).'
        return
    }
    $existing = (claude plugin marketplace list 2>$null | Out-String)
    # Third-party marketplaces: only add sources you trust (no built-in gate).
    foreach ($repo in @('anthropics/skills', 'wshobson/agents', 'obra/superpowers', 'mukul975/Anthropic-Cybersecurity-Skills')) {
        if ($existing -match [regex]::Escape($repo)) { continue }
        claude plugin marketplace add $repo 2>$null
        if ($LASTEXITCODE -ne 0) { Write-Warn "plugin marketplace add failed: $repo" }
    }
    # wshobson's marketplace name is 'claude-code-workflows' (NOT the repo name).
    foreach ($p in @('backend-development', 'data-engineering', 'cloud-infrastructure', 'cicd-automation', 'database-design')) {
        claude plugin install "$p@claude-code-workflows" 2>$null
        if ($LASTEXITCODE -ne 0) { Write-Warn "plugin install failed: $p@claude-code-workflows" }
    }
    Write-Step 'Plugin marketplaces registered; curated workflow plugins installed'
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
function Write-Summary {
    Write-Host ''
    Write-Host 'Setup complete.' -ForegroundColor Green
    Write-Host ''
    Write-Host 'Next steps:'
    Write-Host "  1. Edit $ClaudeDir\config.json with your username, blog dir, etc."
    Write-Host '  2. Restart Claude Code to load skills, agents, and hooks.'
    Write-Host '  3. Re-run install.ps1 anytime to update - it''s idempotent.'
    Write-Host "  4. Switch API provider: fill providers\zai.json (<ZAI_TOKEN>), then run: ccs zai"

    if ($script:FailedSteps.Count -gt 0) {
        Write-Host ''
        Write-Warn "$($script:FailedSteps.Count) optional step(s) were skipped or failed:"
        foreach ($step in $script:FailedSteps) { Write-Warn "  - $step" }
        Write-Warn 'These are non-fatal. See the Troubleshooting section in README.md,'
        Write-Warn 'fix the cause, and re-run install.ps1 (it''s idempotent).'
    }
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
function Invoke-Main {
    if (-not (Test-Command 'git')) {
        Write-Die 'git is required. Install Git for Windows: https://git-scm.com/download/win'
    }

    # Core
    Initialize-Repo
    Invoke-Step 'config seeding'   { Set-SeedConfig }
    Invoke-Step 'bun'              { Install-Bun }
    Invoke-Step 'node runtime'     { Test-NodeRuntime }
    Invoke-Step 'gstack + browser' { Install-Gstack }
    Invoke-Step 'rtk'              { Install-Rtk }
    Invoke-Step 'providers'        { Set-Providers }

    if ($IsMinimal) {
        Write-Step 'Minimal mode - skipping manim, graphify, and upstream skill packs.'
    }
    else {
        Invoke-Step 'manim deps'      { Install-ManimRuntime }
        Invoke-Step 'manim skills'    { Install-ManimUpstream }
        Invoke-Step 'karpathy skill'  { Install-KarpathySkill }
        Invoke-Step 'marketing skills' {
            Install-SkillCollection `
                -Repo 'https://github.com/coreyhaines31/marketingskills.git' `
                -StageDir (Join-Path $ClaudeDir 'skills\.marketing_upstream_src') `
                -Marker '.from_marketing'
        }
        Invoke-Step 'impeccable skill' { Install-ImpeccableSkill }
        Invoke-Step 'taste skills' {
            Install-SkillCollection `
                -Repo 'https://github.com/Leonxlnx/taste-skill.git' `
                -StageDir (Join-Path $ClaudeDir 'skills\.taste_upstream_src') `
                -Marker '.from_taste' -RequireSkillMd
        }
        Invoke-Step 'anthropic skills' { Install-AnthropicSkill }
        Invoke-Step 'graphify' { Install-Graphify }
        Invoke-Step 'plugin marketplaces' { Register-PluginMarketplace }
    }

    Write-Summary
}

Invoke-Main