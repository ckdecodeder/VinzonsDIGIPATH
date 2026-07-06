param(
  [string]$PiHost = "10.137.17.39",
  [string]$PiUser = "digipathberry",
  [string]$BackendBaseUrl = "",
  [string]$DeviceApiKey = "",
  [string]$DeviceId = "DEV-001",
  [string]$OfficeId = "OFF-001",
  [int]$StreamPort = 8080,
  [string]$WifiSsid = "",
  [string]$WifiPassword = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$bridgeFile = Join-Path $repoRoot "pi_scanner_bridge.py"
$installerFile = Join-Path $repoRoot "raspberry_pi\install_digipath_scanner.sh"
$backendEnvFile = Join-Path $repoRoot "backend\.env"

function Get-BackendIp {
  param([string]$TargetHost)

  $targetPrefix = ($TargetHost -replace "\.\d+$", ".")
  $candidate = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.IPAddress -notlike "127.*" -and
      $_.IPAddress -notlike "169.254.*" -and
      $_.IPAddress.StartsWith($targetPrefix)
    } |
    Select-Object -First 1

  if (-not $candidate) {
    $candidate = Get-NetIPConfiguration |
      Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" -and $_.IPv4Address } |
      ForEach-Object { $_.IPv4Address } |
      Select-Object -First 1
  }

  if (-not $candidate) {
    throw "Could not detect this computer's WiFi/LAN IP. Pass -BackendBaseUrl http://YOUR_IP:5000/api."
  }

  return $candidate.IPAddress
}

if (-not (Test-Path $bridgeFile)) {
  throw "Missing $bridgeFile"
}

if (-not (Test-Path $installerFile)) {
  throw "Missing $installerFile"
}

if (-not $DeviceApiKey) {
  if (Test-Path $backendEnvFile) {
    $envLine = Get-Content $backendEnvFile | Where-Object { $_ -match "^DEVICE_API_KEY=" } | Select-Object -First 1
    if ($envLine) {
      $DeviceApiKey = ($envLine -replace "^DEVICE_API_KEY=", "").Trim()
    }
  }
}

if (-not $DeviceApiKey) {
  throw "Could not find DEVICE_API_KEY. Pass -DeviceApiKey or set DEVICE_API_KEY in backend\.env."
}

if (-not $BackendBaseUrl) {
  $backendIp = Get-BackendIp -TargetHost $PiHost
  $BackendBaseUrl = "http://${backendIp}:5000/api"
}

$remote = "${PiUser}@${PiHost}"
$remoteDir = "/tmp/digipath-scanner-install"

Write-Host "Deploying scanner bridge to $remote"
Write-Host "Backend URL for Pi: $BackendBaseUrl"
Write-Host "Dashboard bridge URL after install: http://${PiHost}:$StreamPort"

ssh $remote "rm -rf $remoteDir && mkdir -p $remoteDir/raspberry_pi"
scp $bridgeFile "${remote}:$remoteDir/pi_scanner_bridge.py"
scp $installerFile "${remote}:$remoteDir/raspberry_pi/install_digipath_scanner.sh"
$bridgeEnvExample = Join-Path $repoRoot "bridge.env.example"
if (Test-Path $bridgeEnvExample) {
  scp $bridgeEnvExample "${remote}:$remoteDir/bridge.env.example"
}

$argsList = @(
  "--backend-url", $BackendBaseUrl,
  "--device-key", $DeviceApiKey,
  "--device-id", $DeviceId,
  "--office-id", $OfficeId,
  "--stream-port", "$StreamPort"
)

if ($WifiSsid) {
  $argsList += @("--wifi-ssid", $WifiSsid, "--wifi-password", $WifiPassword)
}

$quotedArgs = ($argsList | ForEach-Object { "'" + ($_ -replace "'", "'\''") + "'" }) -join " "
ssh $remote "chmod +x $remoteDir/raspberry_pi/install_digipath_scanner.sh && cd $remoteDir && sudo raspberry_pi/install_digipath_scanner.sh $quotedArgs"

Write-Host ""
Write-Host "Done. Open Device Management and use Scanner Bridge URL: http://${PiHost}:$StreamPort"
