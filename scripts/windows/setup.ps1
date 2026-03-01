[CmdletBinding()]
param(
    [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$PythonExe = "python"
)

$ErrorActionPreference = "Stop"

$venvDir = Join-Path $ProjectDir ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$requirementsFile = Join-Path $ProjectDir "requirements.txt"

if (-not (Test-Path $requirementsFile)) {
    throw "requirements.txt not found at $requirementsFile"
}

if (-not (Test-Path $venvPython)) {
    Write-Host "Creating virtual environment at $venvDir"
    & $PythonExe -m venv $venvDir
}

Write-Host "Installing dependencies from $requirementsFile"
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r $requirementsFile

Write-Host "Setup complete. Python: $venvPython"
