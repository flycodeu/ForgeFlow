param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$InstallDir,
  [Parameter(Mandatory=$true)][int]$ParentPid
)
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:LOCALAPPDATA 'ForgeFlow\update.log'
function Get-LocalDrivePath([string]$Value) {
  $path = $Value
  # Rust canonicalize returns \\?\C:\... on Windows. NSIS and the TEMP guard
  # use ordinary drive paths, so compare and launch with the same representation.
  if ($path.StartsWith('\\?\', [StringComparison]::OrdinalIgnoreCase)) {
    $path = $path.Substring(4)
  }
  if ($path -notmatch '^[A-Za-z]:\\') { throw 'Invalid local update path.' }
  return [IO.Path]::GetFullPath($path)
}
try {
  $folder = (Get-LocalDrivePath $InstallDir).TrimEnd('\')
  $file = Get-LocalDrivePath $Installer
  $allowed = (Get-LocalDrivePath (Join-Path $env:TEMP 'ForgeFlow-updates')).TrimEnd('\') + '\'
  if (-not $file.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($file) -notmatch '^ForgeFlow-Setup-\d+\.\d+\.\d+\.exe$' -or
      -not (Test-Path -LiteralPath (Join-Path $folder 'Uninstall.exe'))) { throw 'Invalid update paths.' }
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
  }
  if (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) { throw 'ForgeFlow did not exit before installation.' }
  $process = New-Object Diagnostics.Process
  $process.StartInfo.FileName = $file
  $process.StartInfo.Arguments = "/S /D=$folder"
  $process.StartInfo.UseShellExecute = $false
  $process.StartInfo.CreateNoWindow = $true
  if (-not $process.Start()) { throw 'Could not start the installer.' }
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw "Installer failed with exit code $($process.ExitCode)." }
  Add-Content -LiteralPath $log -Value "$(Get-Date -Format o) Update installed successfully."
  Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue
  $updated = Join-Path $folder 'ForgeFlow.exe'
  if (-not (Test-Path -LiteralPath $updated)) { throw 'Updated application is missing.' }
  Start-Process -FilePath $updated
} catch {
  Add-Content -LiteralPath $log -Value "$(Get-Date -Format o) Update failed: $($_.Exception.Message)"
  exit 1
}
