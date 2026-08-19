# Refresh dev tunnel connect token into network.env + Pi .env (token expires ~24h).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$networkEnv = Join-Path $root 'network.env'

if (-not (Test-Path $networkEnv)) {
  Copy-Item (Join-Path $root 'network.env.example') $networkEnv
}

function Read-EnvValue([string]$file, [string]$key) {
  foreach ($line in Get-Content $file) {
    if ($line -match "^\s*$key=(.*)$") {
      return $Matches[1].Trim().Trim('"')
    }
  }
  return ''
}

function Set-EnvValue([string]$file, [string]$key, [string]$value) {
  $pattern = "^\s*$key=.*$"
  $line = "$key=$value"
  $content = if (Test-Path $file) { Get-Content $file -Raw } else { '' }
  if ($content -match $pattern) {
    $content = [regex]::Replace($content, $pattern, $line)
  } else {
    $content = $content.TrimEnd() + "`n$line`n"
  }
  Set-Content -Path $file -Value $content -NoNewline
  Add-Content -Path $file -Value ''
}

$tunnelId = Read-EnvValue $networkEnv 'DIGIPATH_TUNNEL_ID'
if (-not $tunnelId) {
  $public = Read-EnvValue $networkEnv 'DIGIPATH_PUBLIC_BACKEND_URL'
  if ($public -match 'https://([a-z0-9-]+)-5000\.') {
    $tunnelId = $Matches[1]
  }
}
if (-not $tunnelId) {
  throw 'Set DIGIPATH_TUNNEL_ID in network.env first.'
}

$dt = (Get-Command devtunnel -ErrorAction SilentlyContinue).Source
if (-not $dt) {
  $dt = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\devtunnel.exe'
}
if (-not (Test-Path $dt)) {
  throw 'devtunnel CLI not found. Run: winget install Microsoft.devtunnel'
}

& $dt user show 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  & $dt user login -w -e
}

$token = (& $dt token $tunnelId --scopes connect 2>&1 | Select-String '^Token:\s*(.+)$').Matches.Groups[1].Value
if (-not $token) {
  throw "Could not read token for tunnel $tunnelId"
}

Set-EnvValue $networkEnv 'DIGIPATH_DEVTUNNEL_TOKEN' $token
Write-Host "Updated DIGIPATH_DEVTUNNEL_TOKEN in network.env"

Push-Location $root
node scripts/sync-network-config.js
Pop-Location

Write-Host 'Done. Copy D:\VinzonsDIGIPATH-Pi to Pi if needed, then restart pi_ws_scanner.'
