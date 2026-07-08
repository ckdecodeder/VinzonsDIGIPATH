# Install DigiPath to Windows Startup (runs automatically when you log in)
# Usage: npm run autostart:install

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $root "scripts\start-all.ps1"
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "DigiPath.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoExit -ExecutionPolicy Bypass -File `"$startScript`""
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle = 7
$shortcut.Description = "VinzonsDIGIPATH auto-start"
$shortcut.Save()

Write-Host ""
Write-Host "DigiPath autostart installed:"
Write-Host "  $shortcutPath"
Write-Host ""
Write-Host "It will run on every Windows login."
Write-Host "Remove with: npm run autostart:remove"
Write-Host ""
