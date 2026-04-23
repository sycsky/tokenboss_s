# TokenBoss Router - openclaw plugin installer (Windows, local dev)
#
# Installs tokenboss-router as an openclaw extension so openclaw auto-starts it
# and routes through it. Mirrors ClawRouter's install flow.
#
# Usage:
#   iwr "http://127.0.0.1:3000/install/install.ps1?key=sk-xxx" | iex
# Or pinned:
#   iwr -OutFile install.ps1 "http://127.0.0.1:3000/install/install.ps1"
#   .\install.ps1 -ApiKey sk-xxx

param(
    [string]$BackendUrl = "http://127.0.0.1:3000",
    [string]$ApiKey = "",
    [int]$Port = 8402,
    [string]$NpmRegistry = "https://registry.npmmirror.com"
)

$ErrorActionPreference = "Stop"
# Suppress Invoke-WebRequest's progress bar — on Windows PowerShell 5.1 it can
# throw IndexOutOfRangeException inside the console buffer when downloading
# large binaries.
$ProgressPreference = "SilentlyContinue"

$PLUGIN_ID   = "tokenboss-router"
$EXT_ROOT    = "$env:USERPROFILE\.openclaw\extensions"
$PLUGIN_DIR  = "$EXT_ROOT\$PLUGIN_ID"
$OLD_PLUGIN  = "$EXT_ROOT\clawrouter"
$CONFIG_PATH = "$env:USERPROFILE\.openclaw\openclaw.json"

function Write-Ok   { param($m) Write-Host "  [ok]  $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "  [!]   $m" -ForegroundColor Yellow }
function Write-Err  { param($m) Write-Host "  [x]   $m" -ForegroundColor Red }
function Write-Step { param($m) Write-Host "`n-> $m" -ForegroundColor Cyan }

Write-Host ""
Write-Host "TokenBoss Router - openclaw plugin installer" -ForegroundColor Cyan
Write-Host "Backend: $BackendUrl"
Write-Host ""

# ── 1. Node >= 20 ─────────────────────────────────────────────
Write-Step "Checking Node..."
try {
    $nodeVer = (node --version) 2>&1
    $major = [int]($nodeVer -replace "^v(\d+).*", '$1')
    if ($major -lt 20) { throw "Node $nodeVer found, need >= 20" }
    Write-Ok "Node $nodeVer"
} catch {
    Write-Err "Node >= 20 required. Install from https://nodejs.org/"
    exit 1
}

# ── 2. API key ────────────────────────────────────────────────
if (-not $ApiKey) {
    $ApiKey = Read-Host "TokenBoss API key (sk-xxx from dashboard)"
    if (-not $ApiKey) { Write-Err "API key required"; exit 1 }
}

# ── 3. Stop old proxy on $Port ────────────────────────────────
Write-Step "Stopping anything on port $Port..."
try {
    $procs = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
             Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in $procs) {
        if ($procId -gt 0) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
    }
    Write-Ok "Port $Port cleared"
} catch {
    Write-Warn "Could not check port (non-fatal)"
}

# ── 4. Remove old installs (both ids) ─────────────────────────
Write-Step "Cleaning previous installs..."
foreach ($dir in @($PLUGIN_DIR, $OLD_PLUGIN)) {
    if (Test-Path $dir) {
        Remove-Item -Recurse -Force $dir
        Write-Ok "Removed $dir"
    }
}

# ── 5. Download from npm registry ────────────────────────────
Write-Step "Downloading @tokenboss/router from npm ($NpmRegistry)..."
$packTmp = Join-Path $env:TEMP "tb-pack-$([System.Guid]::NewGuid().ToString('N').Substring(0,8))"
New-Item -ItemType Directory -Path $packTmp -Force | Out-Null
Push-Location $packTmp
npm pack "@tokenboss/router" --registry=$NpmRegistry --silent
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Err "npm pack failed"; exit 1 }
$tgzFile = Get-ChildItem $packTmp -Filter "tokenboss-router-*.tgz" | Select-Object -First 1
if (-not $tgzFile) { Pop-Location; Write-Err "package not found on registry"; exit 1 }
Write-Ok "Downloaded $($tgzFile.Name)"
Pop-Location

New-Item -ItemType Directory -Path $PLUGIN_DIR -Force | Out-Null
tar -xzf $tgzFile.FullName -C $PLUGIN_DIR --strip-components=1
if ($LASTEXITCODE -ne 0) { Write-Err "tar extraction failed"; exit 1 }
Remove-Item $packTmp -Recurse -Force
Write-Ok "Extracted to $PLUGIN_DIR"

# ── 6. Patch openclaw.json ────────────────────────────────────
Write-Step "Registering plugin in openclaw.json..."
if (-not (Test-Path $CONFIG_PATH)) {
    Write-Warn "openclaw.json not found at $CONFIG_PATH — is openclaw installed?"
} else {
    try {
        $cfg = Get-Content $CONFIG_PATH -Raw | ConvertFrom-Json

        # Drop stale entries for both ids under plugins.entries / plugins.installs
        if ($cfg.plugins) {
            foreach ($bucket in @('entries', 'installs')) {
                if ($cfg.plugins.$bucket) {
                    foreach ($stale in @('clawrouter', 'tokenboss-router')) {
                        if ($cfg.plugins.$bucket.PSObject.Properties[$stale]) {
                            $cfg.plugins.$bucket.PSObject.Properties.Remove($stale)
                        }
                    }
                }
            }
        }

        # Ensure plugins.allow contains tokenboss-router
        if (-not $cfg.plugins) {
            $cfg | Add-Member -NotePropertyName plugins -NotePropertyValue ([PSCustomObject]@{}) -Force
        }
        if (-not $cfg.plugins.allow) {
            $cfg.plugins | Add-Member -NotePropertyName allow -NotePropertyValue @() -Force
        }
        $allow = [System.Collections.Generic.List[string]]$cfg.plugins.allow
        $allow.Remove('clawrouter') | Out-Null
        if (-not $allow.Contains($PLUGIN_ID)) { $allow.Add($PLUGIN_ID) }
        $cfg.plugins.allow = $allow.ToArray()

        $cfg | ConvertTo-Json -Depth 20 | Set-Content $CONFIG_PATH -Encoding UTF8
        Write-Ok "plugins.allow updated"
    } catch {
        Write-Warn "Could not patch openclaw.json: $_"
    }
}

# ── 7. Clear models cache so openclaw re-fetches provider list ─
Write-Step "Clearing models cache..."
Get-ChildItem "$env:USERPROFILE\.openclaw\agents\*\agent\models.json" -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue
Write-Ok "Cache cleared"

# ── 8. Persist env vars (User scope) ──────────────────────────
Write-Step "Setting env vars (User scope)..."
[Environment]::SetEnvironmentVariable("TOKENBOSS_API_URL", $BackendUrl, "User")
[Environment]::SetEnvironmentVariable("TOKENBOSS_API_KEY", $ApiKey, "User")
[Environment]::SetEnvironmentVariable("TOKENBOSS_PROXY_PORT", "$Port", "User")
$env:TOKENBOSS_API_URL = $BackendUrl
$env:TOKENBOSS_API_KEY = $ApiKey
$env:TOKENBOSS_PROXY_PORT = "$Port"
Write-Ok "TOKENBOSS_API_URL / TOKENBOSS_API_KEY / TOKENBOSS_PROXY_PORT set"

# ── Done ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "TokenBoss Router installed as openclaw plugin." -ForegroundColor Green
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1. Restart openclaw gateway:   openclaw gateway restart"
Write-Host "  2. Proxy will listen on:       http://127.0.0.1:$Port"
Write-Host "  3. Upstream:                   $BackendUrl"
Write-Host ""
