param(
  [string]$Destination = "D:\VinzonsDIGIPATH-Pi"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Convert-ToLf {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return }
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  $text = $text -replace "`r`n", "`n" -replace "`r", "`n"
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $text, $utf8NoBom)
}

function Copy-PiFile {
  param([string]$RelativePath)
  $from = Join-Path $repoRoot $RelativePath
  if (-not (Test-Path $from)) {
    Write-Warning "Missing: $RelativePath"
    return
  }
  $to = Join-Path $Destination $RelativePath
  $parent = Split-Path $to -Parent
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  Copy-Item -Path $from -Destination $to -Force
  if ($RelativePath -like "*.sh") {
    Convert-ToLf $to
    Write-Host "Copied (LF): $RelativePath"
  } else {
    Write-Host "Copied: $RelativePath"
  }
}

if (-not (Test-Path $Destination)) {
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
}

$rootFiles = @(
  "pi_scanner_bridge.py",
  "motor_controller.py",
  "relay_controller.py",
  "install-pi-deps.sh",
  "bridge.env.example",
  "README-PI.txt",
  "verify-pi-deps.py",
  "requirements-pi.txt",
  "fix-pi-scripts.sh",
  "network.env.example",
  "start.sh"
)

$scriptFiles = @(
  "scripts/pi-start-all.sh",
  "scripts/pi-update-network.sh",
  "scripts/pi-test-backend.sh",
  "scripts/pi-restart-clean.sh",
  "scripts/pi-install-network-hook.sh"
)

$raspberryFiles = @(
  "raspberry_pi/install_digipath_scanner.sh",
  "raspberry_pi/digipath-scanner.service",
  "raspberry_pi/digipath-scanner.env.example"
)

foreach ($file in ($rootFiles + $scriptFiles + $raspberryFiles)) {
  Copy-PiFile $file
}

$dstEnv = Join-Path $Destination "bridge.env"
$srcEnv = Join-Path $repoRoot "bridge.env"
if (Test-Path $srcEnv) {
  Copy-Item -Path $srcEnv -Destination $dstEnv -Force
  Write-Host "Copied bridge.env (with stream + network settings)"
} elseif (-not (Test-Path $dstEnv)) {
  Write-Host "No bridge.env found in repo or destination"
} else {
  Write-Host "Kept existing bridge.env on destination"
}

# Ensure repo shell scripts are LF too (for git / future copies)
Get-ChildItem -Path $repoRoot -Filter "*.sh" -Recurse | ForEach-Object {
  Convert-ToLf $_.FullName
}

Write-Host ""
Write-Host "Pi package synced to $Destination (shell scripts use Unix LF line endings)."
