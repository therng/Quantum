[CmdletBinding()]
param(
    [string]$ServiceName = "MT5HeartbeatNgrok"
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        throw "Run this script in an elevated PowerShell session (Run as Administrator)."
    }
}

Assert-Admin

if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    throw "nssm is required but not found in PATH."
}

$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $existingService) {
    Write-Host "Service not found: $ServiceName"
    exit 0
}

nssm stop $ServiceName | Out-Null
nssm remove $ServiceName confirm | Out-Null

Write-Host "Service removed: $ServiceName"
