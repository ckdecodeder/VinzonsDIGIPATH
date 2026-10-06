# One command on Windows: sync + backend + dashboard + open browser
# Usage: .\scripts\start-all.ps1   or   npm start

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Test-Path "node_modules")) {
  Write-Host "[DigiPath] First run — installing dependencies..."
  npm run install:all
}

npm start
