# Remove DigiPath from Windows Startup
# Usage: npm run autostart:remove

$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "DigiPath.lnk"

if (Test-Path $shortcutPath) {
  Remove-Item $shortcutPath -Force
  Write-Host "Removed: $shortcutPath"
} else {
  Write-Host "No autostart shortcut found."
}
