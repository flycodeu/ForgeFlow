param([switch]$Build)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$binaryPath = Join-Path $projectRoot 'apps\desktop\src-tauri\target\debug\forgeflow-desktop.exe'
$runtimePath = Join-Path $projectRoot 'apps\desktop\runtime'
if ($Build) {
  & cargo build --locked --manifest-path (Join-Path $projectRoot 'apps\desktop\src-tauri\Cargo.toml')
  if ($LASTEXITCODE -ne 0) { throw '桌面构建失败' }
}
if (!(Test-Path -LiteralPath $binaryPath) -or !(Test-Path -LiteralPath (Join-Path $runtimePath 'node.exe'))) {
  throw '请先执行 pnpm build、node scripts/desktop-prepare.mjs 和 cargo build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml'
}
$startInfo = [Diagnostics.ProcessStartInfo]::new($binaryPath)
$startInfo.UseShellExecute = $false
$startInfo.EnvironmentVariables['FORGEFLOW_RUNTIME_ROOT'] = $runtimePath
$startInfo.CreateNoWindow = $true
[void][Diagnostics.Process]::Start($startInfo)
