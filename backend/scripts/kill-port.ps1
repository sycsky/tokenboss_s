# Usage:
#   .\scripts\kill-port.ps1            # defaults to 3000
#   .\scripts\kill-port.ps1 -Port 8402
#
# Finds every process LISTENING on the given TCP port and force-kills it.
# Safe to re-run — reports "nothing listening" when the port is already free.

param(
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $conns) {
    Write-Host "Nothing listening on port $Port."
    exit 0
}

$pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $pids) {
    try {
        $proc = Get-Process -Id $procId -ErrorAction Stop
        Write-Host "Killing PID $procId ($($proc.ProcessName)) on port $Port"
        Stop-Process -Id $procId -Force
    } catch {
        Write-Host "Could not kill PID $procId`: $_"
    }
}
