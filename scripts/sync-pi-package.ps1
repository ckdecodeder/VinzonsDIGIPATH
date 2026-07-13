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
  if ($RelativePath -like "*.sh" -or $RelativePath -like "*.env*" -or $RelativePath -eq ".env") {
    Convert-ToLf $to
    if ($RelativePath -like "*.sh") {
      Write-Host "Copied (LF): $RelativePath"
    } else {
      Write-Host "Copied (LF env): $RelativePath"
    }
  } else {
    Write-Host "Copied: $RelativePath"
  }
}

function Remove-UsbLegacy {
  param([string]$RelativePath)
  $target = Join-Path $Destination $RelativePath
  if (Test-Path $target) {
    Remove-Item $target -Recurse -Force
    Write-Host "Removed legacy: $RelativePath"
  }
}

if (-not (Test-Path $Destination)) {
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
}

# Minimal USB package — JPEG preview over WebSocket only (no WebRTC)

$rootFiles = @(
  "pi_ws_scanner.py",
  "pi_wifi_provision.py",
  "digipath_tb6600.py",
  "digipath_hall_ys27.py",
  "digipath_mechanism.py",
  "digipath_motor_test.py",
  "digipath_mechanism.env.example",
  "pi_ws_scanner.env.example",
  "PI-WS-FIX.txt",
  "README-USB.txt",
  "fix-pi-scripts.sh"
)

$scriptFiles = @(
  "scripts/pi-apt-lib.sh",
  "scripts/pi-venv-lib.sh",
  "scripts/pi-bootstrap-ws.sh",
  "scripts/pi-load-env.sh",
  "scripts/pi-install-lib.sh",
  "scripts/ws.sh",
  "scripts/pi-usb-auto-update.sh",
  "scripts/pi-install-usb-hook.sh",
  "scripts/pi-install-ws-service.sh",
  "scripts/pi-install-wifi-provision.sh",
  "scripts/pi-install-all.sh",
  "scripts/pi-wifi-provision.sh",
  "scripts/pi-restart-ws-scanner.sh",
  "scripts/pi-usb-ensure-scanner.sh",
  "scripts/test-motors.sh"
)

$legacyPaths = @(
  "pi_webrtc.py",
  "PI-WEBRTC-FIX.txt",
  "pi_scanner_bridge.py",
  "motor_controller.py",
  "relay_controller.py",
  "install-pi-deps.sh",
  "bridge.env",
  "bridge.env.example",
  "README-PI.txt",
  "verify-pi-deps.py",
  "requirements-pi.txt",
  "network.env.example",
  "start.sh",
  "run-pi-ws-scanner.sh",
  "pi-run-all-ws.sh",
  "pi-fix-and-run-ws.sh",
  "New Text Document.txt",
  "raspberry_pi",
  "scripts/pi-start-all.sh",
  "scripts/pi-test-backend.sh",
  "scripts/pi-restart-clean.sh",
  "scripts/pi-install-network-hook.sh",
  "scripts/pi-install-ws-service.sh",
  "scripts/pi-desktop-notify.sh",
  "scripts/pi-install-webrtc.sh",
  "scripts/pi-webrtc-fix-all.sh",
  "scripts/pi-audioop-fix.sh",
  "scripts/webrtc.sh",
  "scripts/pi-unlock-apt.sh",
  "scripts/pi-fix-and-run-ws.sh",
  "scripts/pi-run-all-ws.sh",
  "scripts/pi-update-network.sh",
  "scripts/pi-uninstall-all.sh",
  "scripts/fetch-devtunnel-token.ps1",
  "scripts/deploy-pi-bridge.ps1",
  "scripts/dev.js",
  "scripts/install-windows-autostart.ps1",
  "scripts/remove-windows-autostart.ps1",
  "scripts/start-all.js",
  "scripts/start-all.ps1",
  "scripts/sync-network-config.js",
  "scripts/sync-pi-package.ps1"
)

$allowedRelative = [System.Collections.Generic.HashSet[string]]::new(
  [string[]]($rootFiles + $scriptFiles + @(".env")),
  [System.StringComparer]::OrdinalIgnoreCase
)

function Remove-UsbStrays {
  if (-not (Test-Path $Destination)) { return }
  Get-ChildItem -Path $Destination -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($Destination.Length).TrimStart('\', '/').Replace('\', '/')
    if (-not $allowedRelative.Contains($rel)) {
      Remove-Item $_.FullName -Force
      Write-Host "Removed stray: $rel"
    }
  }
  Get-ChildItem -Path $Destination -Recurse -Directory | Sort-Object FullName -Descending | ForEach-Object {
    if (-not (Get-ChildItem -Path $_.FullName -Force | Select-Object -First 1)) {
      Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
    }
  }
}

foreach ($legacy in $legacyPaths) {
  Remove-UsbLegacy $legacy
}

foreach ($file in ($rootFiles + $scriptFiles)) {
  Copy-PiFile $file
}

Remove-UsbStrays

$wsEnvDst = Join-Path $Destination ".env"
$wsEnvSrc = Join-Path $repoRoot "pi_ws_scanner.env"
if (Test-Path $wsEnvSrc) {
  Copy-Item -Path $wsEnvSrc -Destination $wsEnvDst -Force
  Convert-ToLf $wsEnvDst
  Write-Host "Copied .env for pi_ws_scanner (from pi_ws_scanner.env, LF)"
} elseif (-not (Test-Path $wsEnvDst) -and (Test-Path (Join-Path $repoRoot "pi_ws_scanner.env.example"))) {
  Copy-Item -Path (Join-Path $repoRoot "pi_ws_scanner.env.example") -Destination $wsEnvDst -Force
  Convert-ToLf $wsEnvDst
  Write-Host "Created .env from pi_ws_scanner.env.example (LF)"
}

$venvOnUsb = Join-Path $Destination ".venv"
if (Test-Path $venvOnUsb) {
  Remove-Item $venvOnUsb -Recurse -Force
  Write-Host "Removed .venv from USB package (Pi creates it locally)."
}

$required = @(
  "pi_ws_scanner.py",
  "PI-WS-FIX.txt",
  "scripts/ws.sh",
  "scripts/pi-bootstrap-ws.sh"
)

$missing = @()
foreach ($rel in $required) {
  if (-not (Test-Path (Join-Path $Destination $rel))) {
    $missing += $rel
  }
}

Write-Host ""
if ($missing.Count -gt 0) {
  Write-Error "Package incomplete - missing: $($missing -join ', ')"
}

Write-Host "USB package ($($rootFiles.Count + $scriptFiles.Count) files):"
foreach ($rel in ($rootFiles + $scriptFiles)) {
  $info = Get-Item (Join-Path $Destination $rel)
  Write-Host "  $($info.Name) - $($info.Length) bytes"
}

Write-Host ""
Write-Host "Synced to $Destination"
