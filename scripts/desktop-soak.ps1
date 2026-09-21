param(
  [Parameter(Mandatory = $true)][string]$BinaryPath,
  [ValidateRange(10, 86400)][int]$DurationSeconds = 1800,
  [ValidateRange(1, 60)][int]$SampleSeconds = 10,
  [ValidateRange(0, 300)][int]$WarmupSeconds = 30,
  [string]$RuntimeRoot
)
$ErrorActionPreference = 'Stop'
$binary = (Resolve-Path -LiteralPath $BinaryPath).Path
$binarySha256 = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output = Join-Path $repository ('.artifacts\desktop-soak-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$data = Join-Path $output 'data'
$config = Join-Path $output 'config'
[void](New-Item -ItemType Directory -Path $data, $config)
$descriptorPath = Join-Path $data 'runtime.json'
$known = @{}
$samples = [Collections.Generic.List[object]]::new()
$failures = [Collections.Generic.List[string]]::new()
$root = $null
$shutdownClean = $false
$cpuCount = [Environment]::ProcessorCount
$lastCpu = @{}
$lastSample = $null
$startedUtc = [DateTime]::UtcNow

function Get-OwnedProcesses {
  $inventory = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate, Name)
  $owned = @{}
  # A PID is owned only while its creation time still matches: never kill a reused PID.
  foreach ($item in $inventory) {
    $key = [string]$item.ProcessId
    $created = $item.CreationDate.ToUniversalTime().Ticks
    if ($known.ContainsKey($key) -and $known[$key] -eq $created) { $owned[$key] = $item }
  }
  do {
    $added = $false
    foreach ($item in $inventory) {
      $key = [string]$item.ProcessId
      $parentKey = [string]$item.ParentProcessId
      if (!$owned.ContainsKey($key) -and $owned.ContainsKey($parentKey) -and $item.CreationDate -ge $owned[$parentKey].CreationDate) {
        $owned[$key] = $item
        $known[$key] = $item.CreationDate.ToUniversalTime().Ticks
        $added = $true
      }
    }
  } while ($added)
  return @($owned.Values)
}

function Test-AuthenticatedHealth {
  if (!(Test-Path -LiteralPath $descriptorPath)) { return $false }
  try {
    $descriptor = Get-Content -LiteralPath $descriptorPath -Raw | ConvertFrom-Json
    $uri = [Uri]$descriptor.url
    if ($uri.Scheme -ne 'http' -or $uri.Host -ne '127.0.0.1' -or !$descriptor.secret) { return $false }
    $identity = Invoke-RestMethod ($descriptor.url + '/api/runtime/identity') -Headers @{ 'X-ForgeFlow-Desktop' = $descriptor.secret } -TimeoutSec 3 -MaximumRedirection 0
    return ($identity.instanceId -eq $descriptor.instanceId -and $identity.protocolVersion -eq 1)
  } catch { return $false }
}

try {
  $info = [Diagnostics.ProcessStartInfo]::new($binary)
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $info.WorkingDirectory = Split-Path -Parent $binary
  $info.EnvironmentVariables['FORGEFLOW_DATA_DIR'] = $data
  $info.EnvironmentVariables['FORGEFLOW_CONFIG_DIR'] = $config
  if ($RuntimeRoot) { $info.EnvironmentVariables['FORGEFLOW_RUNTIME_ROOT'] = (Resolve-Path -LiteralPath $RuntimeRoot).Path }
  else { $info.EnvironmentVariables.Remove('FORGEFLOW_RUNTIME_ROOT') }
  $root = [Diagnostics.Process]::Start($info)
  $rootCim = Get-CimInstance Win32_Process -Filter "ProcessId = $($root.Id)" -Property ProcessId, CreationDate
  if (!$rootCim) { throw 'Desktop exited before process ownership could be recorded.' }
  $known[[string]$root.Id] = $rootCim.CreationDate.ToUniversalTime().Ticks
  $readyDeadline = [DateTime]::UtcNow.AddSeconds(40)
  while (!(Test-AuthenticatedHealth)) {
    [void](Get-OwnedProcesses)
    if ($root.HasExited) { throw 'Desktop exited before authenticated readiness. Close another test instance first.' }
    if ([DateTime]::UtcNow -gt $readyDeadline) { throw 'Authenticated readiness timed out.' }
    Start-Sleep -Milliseconds 300
  }
  $clock = [Diagnostics.Stopwatch]::StartNew()
  Write-Output "Authenticated desktop ready. Measuring $DurationSeconds real seconds; report directory: $output"
  while ($true) {
    $now = [DateTime]::UtcNow
    $owned = @(Get-OwnedProcesses)
    $working = 0L; $private = 0L; $handles = 0L; $threads = 0L; $cpuDelta = 0.0
    $pids = [Collections.Generic.List[int]]::new()
    $names = [Collections.Generic.List[string]]::new()
    foreach ($item in $owned) {
      try {
        $process = Get-Process -Id $item.ProcessId -ErrorAction Stop
        # CIM truncates to microseconds; Process exposes 100 ns ticks.
        if ([Math]::Abs($process.StartTime.ToUniversalTime().Ticks - $known[[string]$item.ProcessId]) -gt 9) { continue }
        $working += $process.WorkingSet64; $private += $process.PrivateMemorySize64
        $handles += $process.HandleCount; $threads += $process.Threads.Count
        $cpuKey = "$($item.ProcessId):$($known[[string]$item.ProcessId])"
        $currentCpu = $process.TotalProcessorTime.TotalSeconds
        if ($lastCpu.ContainsKey($cpuKey)) { $cpuDelta += [Math]::Max(0.0, $currentCpu - $lastCpu[$cpuKey]) }
        elseif ($lastSample) { $cpuDelta += $currentCpu }
        $lastCpu[$cpuKey] = $currentCpu
        $pids.Add([int]$item.ProcessId); $names.Add($item.Name)
      } catch { }
    }
    $cpuPercent = $null
    if ($lastSample) { $cpuPercent = [Math]::Round(100 * $cpuDelta / (($now - $lastSample).TotalSeconds * $cpuCount), 4) }
    $lastSample = $now
    $healthy = Test-AuthenticatedHealth
    $samples.Add([pscustomobject]@{
      utc = $now.ToString('o'); elapsedSeconds = [Math]::Round($clock.Elapsed.TotalSeconds, 2)
      healthy = $healthy; processCount = $pids.Count; pids = ($pids -join ','); names = ($names -join ',')
      workingSetMiB = [Math]::Round($working / 1MB, 2); privateMiB = [Math]::Round($private / 1MB, 2)
      handles = $handles; threads = $threads; machineCpuPercent = $cpuPercent
    })
    $samples | Export-Csv -LiteralPath (Join-Path $output 'samples.csv') -NoTypeInformation -Encoding UTF8
    if ($root.HasExited) { throw 'Desktop exited during the soak period.' }
    if ($clock.Elapsed.TotalSeconds -ge $DurationSeconds) { break }
    Start-Sleep -Milliseconds ([Math]::Max(1, [int]([Math]::Min($SampleSeconds, $DurationSeconds - $clock.Elapsed.TotalSeconds) * 1000)))
  }
} catch {
  # Do not serialize arbitrary exception/request data: descriptors contain a private credential.
  $failures.Add('Startup or sampling failed: ' + $_.Exception.GetType().Name)
} finally {
  # Stop only this launch; test the normal parent-EOF cleanup before any forced descendant cleanup.
  if ($root -and !$root.HasExited) { $root.Kill(); [void]$root.WaitForExit(5000) }
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    $remaining = @(Get-OwnedProcesses)
    if (!$remaining.Count -and !(Test-Path -LiteralPath $descriptorPath)) { $shutdownClean = $true; break }
    Start-Sleep -Milliseconds 300
  } while ([DateTime]::UtcNow -lt $deadline)
  if (!$shutdownClean) {
    $failures.Add('Owned processes or runtime descriptor survived parent exit; forced cleanup was required.')
    foreach ($item in @(Get-OwnedProcesses)) {
      try {
        $process = Get-Process -Id $item.ProcessId -ErrorAction Stop
        if ([Math]::Abs($process.StartTime.ToUniversalTime().Ticks - $known[[string]$item.ProcessId]) -le 9) { $process.Kill() }
      } catch { }
    }
  }
}

function Measure-Metric($rows, [string]$property) {
  $values = @($rows | ForEach-Object { $_.$property } | Where-Object { $null -ne $_ })
  if (!$values.Count) { return $null }
  $m = $values | Measure-Object -Minimum -Maximum -Average
  return [ordered]@{ min = $m.Minimum; max = $m.Maximum; mean = [Math]::Round($m.Average, 4); drift = [Math]::Round($values[-1] - $values[0], 4) }
}
$steady = @($samples | Where-Object { $_.elapsedSeconds -ge $WarmupSeconds })
$elapsed = 0
if ($samples.Count) { $elapsed = $samples[$samples.Count - 1].elapsedSeconds }
$healthPass = $samples.Count -gt 0 -and @($samples | Where-Object { !$_.healthy }).Count -eq 0
$cpu = Measure-Metric $steady 'machineCpuPercent'
$count = Measure-Metric $steady 'processCount'
$memory = Measure-Metric $steady 'privateMiB'
$criteria = [ordered]@{
  durationAtLeast30Minutes = $elapsed -ge 1800
  allAuthenticatedHealthChecksPassed = $healthPass
  sampledShellNodeAndWebView = ($samples.Count -gt 0 -and @($samples | Where-Object { $_.names -match 'node.exe' -and $_.names -match 'msedgewebview2.exe' -and $_.processCount -ge 4 }).Count -gt 0)
  noPostWarmupProcessCountGrowth = ($null -ne $count -and $count.drift -le 0 -and $count.max -le $count.min)
  idleMeanMachineCpuBelowOnePercent = ($null -ne $cpu -and $cpu.mean -lt 1)
  privateMemoryDriftWithin64MiBAnd20Percent = ($null -ne $memory -and $memory.drift -le 64 -and $memory.drift -le [Math]::Max(1, $memory.min * 0.2))
  ownedBackgroundShutdownPassed = $shutdownClean
}
$result = 'PASS'
if ($failures.Count -or !$healthPass -or !$shutdownClean) { $result = 'FAIL' }
elseif (@($criteria.Values | Where-Object { !$_ }).Count) { $result = 'REVIEW' }
$report = [ordered]@{
  result = $result; binary = $binary; binarySha256 = $binarySha256
  startedUtc = $startedUtc.ToString('o'); endedUtc = [DateTime]::UtcNow.ToString('o')
  requestedSeconds = $DurationSeconds; observedSeconds = $elapsed; sampleCount = $samples.Count; warmupSeconds = $WarmupSeconds
  logicalCpuCount = $cpuCount; criteria = $criteria
  metrics = [ordered]@{ processCount = $count; workingSetMiB = (Measure-Metric $steady 'workingSetMiB'); privateMiB = $memory; handles = (Measure-Metric $steady 'handles'); threads = (Measure-Metric $steady 'threads'); machineCpuPercent = $cpu }
  failures = @($failures)
  scope = 'Idle isolated desktop with no AI capture enabled; includes sampled descendants (Node and WebView2), not just the shell. Short-lived processes between samples may be missed. CPU is normalized to all logical processors and is sampled, not an ETW trace.'
  limitations = 'A short run is REVIEW, not long-run acceptance. One machine/idle workload cannot prove all devices or active capture stability. Tray mouse actions and DPI are separate UI acceptance. Working sets include shared pages, so the sum is not exclusive physical RAM. Test database/config directories are isolated and retained; platform WebView caches may still be used.'
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $output 'report.json') -Encoding UTF8
Write-Output "$result | $($samples.Count) samples | $elapsed seconds | owned shutdown: $shutdownClean"
Write-Output "Report: $(Join-Path $output 'report.json')"
if ($result -eq 'FAIL') { exit 1 }
