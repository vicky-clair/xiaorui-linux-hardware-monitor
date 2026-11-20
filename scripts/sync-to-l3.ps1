#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Safely syncs tracked repository files to the isolated remote L3 workspace
  (~/linux-hardware-monitor) without touching any other host files or storing credentials.
.DESCRIPTION
  Requires LHM_SSH_HOST (e.g. hailan20251015@192.168.9.165) and either SSH key auth
  or SSH_ASKPASS configured in the calling session. Never stores passwords on disk.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$RemoteTarget,
    [string]$RemoteDir = "~/linux-hardware-monitor",
    [int]$Port = 22
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Safety guard: refuse syncing to anything outside the dedicated project folder
if ($RemoteDir -notmatch '^~/linux-hardware-monitor(/[A-Za-z0-9._-]+)*$') {
    throw "Refusing unsafe remote path: $RemoteDir (must be under ~/linux-hardware-monitor)"
}

Write-Host "==> Preparing clean archive of tracked git files (HEAD)..."
$tempTar = Join-Path ([System.IO.Path]::GetTempPath()) ("lhm-sync-" + [System.Guid]::NewGuid().ToString("N") + ".tar")

try {
    git archive --format=tar -o $tempTar HEAD
    Write-Host "==> Syncing to ${RemoteTarget}:${RemoteDir} (isolated workspace)..."
    Get-Content -Path $tempTar -AsByteStream -Raw |
        & ssh -p $Port -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 $RemoteTarget "mkdir -p $RemoteDir && tar -xf - -C $RemoteDir"
    if ($LASTEXITCODE -ne 0) {
        throw "Remote sync failed with exit code $LASTEXITCODE"
    }
    Write-Host "==> Sync completed cleanly."
} finally {
    if (Test-Path $tempTar) {
        Remove-Item -Force $tempTar
    }
}
