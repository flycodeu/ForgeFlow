param(
  [Parameter(Mandatory=$true)][ValidateSet('Install','Uninstall')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$Target,
  [string]$ManifestHash
)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules') + ';' + $env:PSModulePath
Import-Module ([IO.Path]::Combine($PSHOME, 'Modules', 'Microsoft.PowerShell.Utility')) -ErrorAction Stop
Import-Module ([IO.Path]::Combine($PSHOME, 'Modules', 'CimCmdlets')) -ErrorAction Stop
try {
  $targetPath = [IO.Path]::GetFullPath($Target).TrimEnd('\')
  if ($targetPath -notmatch '^[A-Za-z]:\\' -or $targetPath.Length -lt 6) { throw 'Choose a dedicated local application folder.' }
  foreach ($reserved in @($env:USERPROFILE, $env:LOCALAPPDATA, $env:APPDATA, $env:WINDIR, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if ($reserved -and $targetPath -eq $reserved.TrimEnd('\')) { throw 'A system or profile root cannot be used.' }
  }
  $ancestor = $targetPath
  while ($ancestor) {
    if (Test-Path -LiteralPath $ancestor) {
      $item = Get-Item -LiteralPath $ancestor -Force
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked directories are not supported.' }
    }
    $ancestor = [IO.Path]::GetDirectoryName($ancestor)
  }
  if ($Mode -eq 'Install') {
    if ((Test-Path -LiteralPath $targetPath) -and @(Get-ChildItem -LiteralPath $targetPath -Force).Count -gt 0) {
      $isExistingForgeFlow = (Test-Path -LiteralPath (Join-Path $targetPath 'forgeflow-install-manifest.json')) -or `
                             ((Test-Path -LiteralPath (Join-Path $targetPath 'ForgeFlow.exe')) -and (Test-Path -LiteralPath (Join-Path $targetPath 'Uninstall.exe')))
      if (-not $isExistingForgeFlow) {
        throw 'The destination must be empty or an existing ForgeFlow installation directory. Project data is retained.'
      }
      $active = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath -ne (Join-Path $targetPath 'Uninstall.exe') -and $_.ExecutablePath.StartsWith($targetPath + '\', [StringComparison]::OrdinalIgnoreCase)
      })
      if ($active.Count -gt 0) {
        foreach ($proc in $active) {
          Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Milliseconds 500
        $stillActive = @(Get-CimInstance Win32_Process | Where-Object {
          $_.ExecutablePath -and $_.ExecutablePath -ne (Join-Path $targetPath 'Uninstall.exe') -and $_.ExecutablePath.StartsWith($targetPath + '\', [StringComparison]::OrdinalIgnoreCase)
        })
        if ($stillActive.Count -gt 0) {
          throw 'The application or its background service is running. Exit from the tray before upgrading.'
        }
      }
    }
    exit 0
  }
  $manifestPath = Join-Path $targetPath 'forgeflow-install-manifest.json'
  if ((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash -ne $ManifestHash) { throw 'The installation manifest is missing or changed; no files were removed.' }
  $marker = Get-Content -LiteralPath (Join-Path $targetPath 'forgeflow-install-location.txt') -Raw
  if ($marker.Trim() -ne $targetPath) { throw 'The installation directory was moved; no files were removed.' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $active = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath -ne (Join-Path $targetPath 'Uninstall.exe') -and $_.ExecutablePath.StartsWith($targetPath + '\', [StringComparison]::OrdinalIgnoreCase)
  })
  if ($active.Count -gt 0) { throw 'The application or its background service is running. Exit from the tray before uninstalling.' }
  $removable = @()
  foreach ($entry in $manifest.files) {
    $candidate = [IO.Path]::GetFullPath((Join-Path $targetPath $entry.path))
    if (-not $candidate.StartsWith($targetPath + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid manifest path.' }
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    $cursor = $candidate
    while ($cursor -ne $targetPath) {
      if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked application files detected; no files were removed.' }
      $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    $stream = [IO.File]::Open($candidate, 'Open', 'Read', 'None')
    $stream.Dispose()
    if ((Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash -eq $entry.sha256) { $removable += $candidate }
  }
  # All candidate locks and paths are checked before any removal. Changed files are kept.
  foreach ($candidate in $removable) { Remove-Item -LiteralPath $candidate -Force }
  foreach ($relative in @($manifest.directories | Sort-Object Length -Descending)) {
    $directory = [IO.Path]::GetFullPath((Join-Path $targetPath $relative))
    if ($directory.StartsWith($targetPath + '\', [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $directory)) {
      if (@(Get-ChildItem -LiteralPath $directory -Force).Count -eq 0) { Remove-Item -LiteralPath $directory }
    }
  }
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 2
}
