[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ApiKey,
    [string]$ServiceName = "MT5HeartbeatApi",
    [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$PythonPath = "",
    [string]$Host = "0.0.0.0",
    [int]$Port = 8000,
    [int]$MaxTsDriftSec = 300
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
    throw "nssm is required but not found in PATH. Install NSSM first."
}

if ([string]::IsNullOrWhiteSpace($PythonPath)) {
    $candidate = Join-Path $ProjectDir ".venv\Scripts\python.exe"
    if (Test-Path $candidate) {
        $PythonPath = $candidate
    } else {
        $PythonPath = "python"
    }
}

$runScript = Join-Path $ProjectDir "run_app.py"
$logsDir = Join-Path $ProjectDir "logs"
$stdoutLog = Join-Path $logsDir "service.stdout.log"
$stderrLog = Join-Path $logsDir "service.stderr.log"

if (-not (Test-Path $runScript)) {
    throw "run_app.py not found at $runScript"
}

if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "Service $ServiceName already exists. Reinstalling..."
    nssm stop $ServiceName | Out-Null
    nssm remove $ServiceName confirm | Out-Null
    Start-Sleep -Seconds 1
}

nssm install $ServiceName $PythonPath $runScript | Out-Null
nssm set $ServiceName AppDirectory $ProjectDir | Out-Null
nssm set $ServiceName Start SERVICE_AUTO_START | Out-Null
nssm set $ServiceName AppStdout $stdoutLog | Out-Null
nssm set $ServiceName AppStderr $stderrLog | Out-Null
nssm set $ServiceName AppRotateFiles 1 | Out-Null
nssm set $ServiceName AppRotateOnline 1 | Out-Null

$envExtra = @(
    "MT5_API_KEY=$ApiKey"
    "APP_HOST=$Host"
    "APP_PORT=$Port"
    "MT5_MAX_TS_DRIFT_SEC=$MaxTsDriftSec"
    "PYTHONUNBUFFERED=1"
) -join "`n"

nssm set $ServiceName AppEnvironmentExtra $envExtra | Out-Null
nssm start $ServiceName | Out-Null

Write-Host "Service installed and started: $ServiceName"
Write-Host "Logs:"
Write-Host "  $stdoutLog"
Write-Host "  $stderrLog"
