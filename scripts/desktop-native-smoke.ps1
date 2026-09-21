param([switch]$Portable)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimePath = Join-Path $projectRoot 'apps\desktop\runtime'
$binaryPath = Join-Path $projectRoot 'apps\desktop\src-tauri\target\debug\forgeflow-desktop.exe'
if ($Portable) { $binaryPath = Join-Path $projectRoot 'apps\desktop\dist\ForgeFlow\ForgeFlow.exe' }
$testData = Join-Path $projectRoot ('.artifacts\desktop-native-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $testData)
function Start-TestDesktop {
  $info = [Diagnostics.ProcessStartInfo]::new($binaryPath)
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardError = $true
  if ($Portable) { $info.EnvironmentVariables.Remove('FORGEFLOW_RUNTIME_ROOT') }
  else { $info.EnvironmentVariables['FORGEFLOW_RUNTIME_ROOT'] = $runtimePath }
  $info.EnvironmentVariables['FORGEFLOW_DATA_DIR'] = $testData
  return [Diagnostics.Process]::Start($info)
}
$first = $null
$second = $null
try {
  $first = Start-TestDesktop
  $descriptorPath = Join-Path $testData 'runtime.json'
  $deadline = [DateTime]::UtcNow.AddSeconds(25)
  while (!(Test-Path -LiteralPath $descriptorPath)) {
    if ($first.HasExited) { throw "Desktop exited before readiness: $($first.ExitCode)" }
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Native desktop readiness timed out' }
    Start-Sleep -Milliseconds 200
  }
  $descriptor = Get-Content -LiteralPath $descriptorPath -Raw | ConvertFrom-Json
  $identity = Invoke-RestMethod ($descriptor.url + '/api/runtime/identity') -Headers @{ 'X-ForgeFlow-Desktop' = $descriptor.secret }
  if ($identity.instanceId -ne $descriptor.instanceId) { throw 'Identity mismatch' }
  $second = Start-TestDesktop
  if (!$second.WaitForExit(5000) -or $second.ExitCode -ne 0) { throw 'Single-instance second process did not exit cleanly' }
  if ($first.HasExited) { throw 'First desktop exited unexpectedly' }
  $first.Refresh()
  Write-Output "PASS native process running; second instance exited; authenticated service ready; working set $([Math]::Round($first.WorkingSet64 / 1MB, 1)) MB (shell only, not total budget)."
  # Kill only the handle created by this test; bridge stdin EOF performs owned-service shutdown.
  $first.Kill()
  [void]$first.WaitForExit(5000)
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while (Test-Path -LiteralPath $descriptorPath) {
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Owned service did not clean up after shell exit' }
    Start-Sleep -Milliseconds 200
  }
  Write-Output 'PASS owned background service stopped after native parent exit. No production data was imported.'
  Write-Output "Test database retained: $testData"
} finally {
  if ($second -and !$second.HasExited) { $second.Kill() }
  if ($first -and !$first.HasExited) { $first.Kill() }
  if ($first) { [void]$first.WaitForExit(5000); Write-Output $first.StandardError.ReadToEnd() }
}
