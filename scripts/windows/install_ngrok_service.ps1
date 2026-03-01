[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$NgrokAuthtoken,
    [string]$ServiceName = "MT5HeartbeatNgrok",
    [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$NgrokPath = "ngrok",
    [int]$LocalPort = 8000,
    [string]$ReservedDomain = "",
    [string]$BasicAuth = ""
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

function Resolve-NgrokPath {
    param([string]$Candidate)
    if (Test-Path $Candidate) {
        return (Resolve-Path $Candidate).Path
    }

    $cmd = Get-Command $Candidate -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    throw "ngrok not found. Install ngrok or pass -NgrokPath to ngrok.exe."
}

Assert-Admin

if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    throw "nssm is required but not found in PATH."
}

$resolvedNgrokPath = Resolve-NgrokPath -Candidate $NgrokPath
$configDir = Join-Path $ProjectDir "config"
$configPath = Join-Path $configDir "ngrok.yml"
$logsDir = Join-Path $ProjectDir "logs"
$stdoutLog = Join-Path $logsDir "ngrok.stdout.log"
$stderrLog = Join-Path $logsDir "ngrok.stderr.log"

if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
}

if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

$content = @(
    'version: "2"'
    ('authtoken: "{0}"' -f $NgrokAuthtoken)
    'tunnels:'
    '  mt5-heartbeat:'
    '    proto: http'
    ('    addr: 127.0.0.1:{0}' -f $LocalPort)
    '    inspect: false'
)

if (-not [string]::IsNullOrWhiteSpace($ReservedDomain)) {
    $content += ('    domain: {0}' -f $ReservedDomain.Trim())
}

if (-not [string]::IsNullOrWhiteSpace($BasicAuth)) {
    $content += '    basic_auth:'
    $content += ('      - {0}' -f $BasicAuth.Trim())
}

Set-Content -Path $configPath -Value ($content -join "`r`n") -Encoding ASCII

$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "Service $ServiceName already exists. Reinstalling..."
    nssm stop $ServiceName | Out-Null
    nssm remove $ServiceName confirm | Out-Null
    Start-Sleep -Seconds 1
}

$ngrokArgs = "start --all --config `"$configPath`""
nssm install $ServiceName $resolvedNgrokPath $ngrokArgs | Out-Null
nssm set $ServiceName AppDirectory $ProjectDir | Out-Null
nssm set $ServiceName Start SERVICE_AUTO_START | Out-Null
nssm set $ServiceName AppStdout $stdoutLog | Out-Null
nssm set $ServiceName AppStderr $stderrLog | Out-Null
nssm set $ServiceName AppRotateFiles 1 | Out-Null
nssm set $ServiceName AppRotateOnline 1 | Out-Null

nssm start $ServiceName | Out-Null

Write-Host "ngrok service installed and started: $ServiceName"
Write-Host "Config: $configPath"
Write-Host "Logs:"
Write-Host "  $stdoutLog"
Write-Host "  $stderrLog"
Write-Host ""
Write-Host "Check public URL with:"
Write-Host "  ngrok api tunnels list"
