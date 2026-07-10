param(
  [Parameter(Mandatory = $true)]
  [string]$BackupRoot,
  [switch]$ReuseExistingCopies,
  [switch]$ReuseExistingWslExports
)

$ErrorActionPreference = "Stop"

function Set-BackupStatus {
  param(
    [Parameter(Mandatory = $true)][string]$Step,
    [Parameter(Mandatory = $true)][string]$State,
    [string]$Detail = ""
  )

  $status = [ordered]@{
    schema = "funesterie.preformat-backup-status.v1"
    updatedAt = (Get-Date).ToString("o")
    step = $Step
    state = $State
    detail = $Detail
  }
  $status | ConvertTo-Json | Set-Content -LiteralPath $script:StatusPath -Encoding UTF8
}

function Invoke-DeltaCopy {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$LogPath
  )

  if (-not (Test-Path -LiteralPath $Source)) {
    return [pscustomobject]@{
      source = $Source
      destination = $Destination
      exists = $false
      exitCode = $null
      ok = $false
      note = "source_missing"
    }
  }

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $args = @(
    $Source,
    $Destination,
    "/E",
    "/XJ",
    "/COPY:DAT",
    "/DCOPY:DAT",
    "/R:1",
    "/W:2",
    "/MT:16",
    "/NP",
    "/NFL",
    "/NDL",
    "/LOG:$LogPath",
    "/XD"
  ) + $script:ExcludeDirs + @("/XF") + $script:ExcludeFiles

  & robocopy @args | Out-Null
  $code = $LASTEXITCODE
  $global:LASTEXITCODE = 0

  return [pscustomobject]@{
    source = $Source
    destination = $Destination
    exists = $true
    exitCode = $code
    ok = ($code -le 7)
    note = if ($code -le 7) { "delta_complete" } else { "robocopy_failed" }
  }
}

function Copy-HomeFile {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$DestinationRoot
  )

  if (-not (Test-Path -LiteralPath $Source)) {
    return [pscustomobject]@{ source = $Source; copied = $false; note = "missing" }
  }

  New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null
  Copy-Item -LiteralPath $Source -Destination (Join-Path $DestinationRoot (Split-Path -Leaf $Source)) -Force
  return [pscustomobject]@{ source = $Source; copied = $true; note = "copied" }
}

function Export-WslDistribution {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  $available = @(& wsl.exe --list --quiet 2>$null) |
    ForEach-Object { (([string]$_) -replace "\x00", "").Trim() } |
    Where-Object { $_ -eq $Name }

  if (-not $available) {
    return [pscustomobject]@{ distro = $Name; exported = $false; note = "missing" }
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  if (Test-Path -LiteralPath $Destination) {
    Remove-Item -LiteralPath $Destination -Force
  }

  & wsl.exe --export $Name $Destination
  $code = $LASTEXITCODE
  $size = if (Test-Path -LiteralPath $Destination) { (Get-Item -LiteralPath $Destination).Length } else { 0 }

  return [pscustomobject]@{
    distro = $Name
    destination = $Destination
    exported = ($code -eq 0 -and $size -gt 0)
    exitCode = $code
    sizeGB = [math]::Round($size / 1GB, 2)
    note = if ($code -eq 0 -and $size -gt 0) { "exported" } else { "export_failed" }
  }
}

function Copy-WslDataDisk {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$DestinationRoot,
    [Parameter(Mandatory = $true)][string]$LogPath
  )

  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    return [pscustomobject]@{ source = $Source; copied = $false; ok = $true; note = "missing" }
  }

  New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null
  $sourceRoot = Split-Path -Parent $Source
  $fileName = Split-Path -Leaf $Source
  & robocopy $sourceRoot $DestinationRoot $fileName /J /COPY:DAT /R:1 /W:2 /NP "/LOG:$LogPath" | Out-Null
  $code = $LASTEXITCODE
  $global:LASTEXITCODE = 0
  $destination = Join-Path $DestinationRoot $fileName

  return [pscustomobject]@{
    source = $Source
    destination = $destination
    copied = (Test-Path -LiteralPath $destination -PathType Leaf)
    ok = ($code -le 7 -and (Test-Path -LiteralPath $destination -PathType Leaf))
    exitCode = $code
    sizeGB = if (Test-Path -LiteralPath $destination -PathType Leaf) {
      [math]::Round((Get-Item -LiteralPath $destination).Length / 1GB, 2)
    } else {
      0
    }
    note = if ($code -le 7 -and (Test-Path -LiteralPath $destination -PathType Leaf)) {
      "copied"
    } else {
      "copy_failed"
    }
  }
}

function Test-FilePair {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  $sourceExists = Test-Path -LiteralPath $Source -PathType Leaf
  $destinationExists = Test-Path -LiteralPath $Destination -PathType Leaf
  $matches = $false
  if ($sourceExists -and $destinationExists) {
    $sourceHash = Get-Sha256Hex -Path $Source
    $destinationHash = Get-Sha256Hex -Path $Destination
    $matches = ($sourceHash -eq $destinationHash)
  }

  return [pscustomobject]@{
    source = $Source
    destination = $Destination
    sourceExists = $sourceExists
    destinationExists = $destinationExists
    hashMatches = $matches
  }
}

function Get-Sha256Hex {
  param([Parameter(Mandatory = $true)][string]$Path)

  $stream = [System.IO.File]::OpenRead($Path)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha256.ComputeHash($stream)
    return ([System.BitConverter]::ToString($hash)).Replace("-", "")
  } finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

$BackupRoot = [System.IO.Path]::GetFullPath($BackupRoot)
if (-not $BackupRoot.StartsWith("E:\", [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "BackupRoot must remain on E:"
}
if (-not (Test-Path -LiteralPath $BackupRoot -PathType Container)) {
  throw "Backup root does not exist: $BackupRoot"
}

$logRoot = Join-Path $BackupRoot "_logs"
$metaRoot = Join-Path $BackupRoot "_meta"
$wslRoot = Join-Path $BackupRoot "WSL"
New-Item -ItemType Directory -Force -Path $logRoot, $metaRoot, $wslRoot | Out-Null
$script:StatusPath = Join-Path $metaRoot "status.json"

$script:ExcludeDirs = @(
  ".codex-tmp",
  "node_modules",
  ".turbo",
  ".cache",
  "cache",
  ".vite",
  ".next",
  "dist",
  "build",
  "coverage",
  ".nyc_output",
  ".pytest_cache",
  "__pycache__",
  "venv",
  ".venv",
  "tmp",
  "temp",
  "Cache",
  "Code Cache",
  "GPUCache",
  "ShaderCache",
  "GrShaderCache",
  "DawnCache",
  "Service Worker\CacheStorage",
  "assets-cache",
  "media-cache",
  "hf-cache",
  ".huggingface",
  ".torch",
  "wandb"
)
$script:ExcludeFiles = @("*.tmp", "*.log", "*.pid", "*.lock")

$deltaJobs = @(
  @{ Source = "D:\projets\funesterie"; Destination = "D\projets\funesterie"; Name = "repo" },
  @{ Source = "D:\agent-bus"; Destination = "D\agent-bus"; Name = "agent-bus" },
  @{ Source = "$env:USERPROFILE\.codex"; Destination = "C\Users\Djeff\.codex"; Name = "codex" },
  @{ Source = "$env:USERPROFILE\.ssh"; Destination = "C\Users\Djeff\.ssh"; Name = "ssh" },
  @{ Source = "$env:USERPROFILE\Desktop"; Destination = "C\Users\Djeff\Desktop"; Name = "desktop" },
  @{ Source = "$env:USERPROFILE\Documents"; Destination = "C\Users\Djeff\Documents"; Name = "documents" },
  @{ Source = "$env:USERPROFILE\Downloads"; Destination = "C\Users\Djeff\Downloads"; Name = "downloads" }
)

$deltaResults = New-Object System.Collections.Generic.List[object]
$index = 0
foreach ($job in $deltaJobs) {
  $index++
  $destination = Join-Path $BackupRoot ([string]$job.Destination)
  if ($ReuseExistingCopies) {
    $deltaResults.Add([pscustomobject]@{
      source = [string]$job.Source
      destination = $destination
      exists = (Test-Path -LiteralPath ([string]$job.Source))
      exitCode = $null
      ok = (Test-Path -LiteralPath $destination)
      note = "reused_existing_copy"
    }) | Out-Null
  } else {
    Set-BackupStatus -Step "delta:$($job.Name)" -State "running" -Detail "$index/$($deltaJobs.Count)"
    $deltaResults.Add((Invoke-DeltaCopy `
      -Source ([string]$job.Source) `
      -Destination $destination `
      -LogPath (Join-Path $logRoot "delta-$($job.Name).log"))) | Out-Null
  }
}

Set-BackupStatus -Step "home-files" -State "running"
$homeFileResults = New-Object System.Collections.Generic.List[object]
$homeFileRoot = Join-Path $BackupRoot "C\Users\Djeff\home-files"
foreach ($file in @(
  "$env:USERPROFILE\.gitconfig",
  "$env:USERPROFILE\.npmrc",
  "$env:USERPROFILE\.npmrc.bak-20260525-083117",
  "$env:USERPROFILE\.claude.json",
  "$env:USERPROFILE\.claude.json.backup",
  "$env:USERPROFILE\.boto",
  "$env:USERPROFILE\.bash_history",
  "$env:USERPROFILE\.yarnrc.yml"
)) {
  $homeFileResults.Add((Copy-HomeFile -Source $file -DestinationRoot $homeFileRoot)) | Out-Null
}

Set-BackupStatus -Step "wsl:shutdown" -State "running"
& wsl.exe --shutdown
Start-Sleep -Seconds 3

$wslResults = New-Object System.Collections.Generic.List[object]
foreach ($distro in @("podman-a11-wsl", "podman-net-usermode", "docker-desktop")) {
  $destination = Join-Path $wslRoot "$distro.tar"
  if ($ReuseExistingWslExports) {
    $size = if (Test-Path -LiteralPath $destination -PathType Leaf) { (Get-Item -LiteralPath $destination).Length } else { 0 }
    $wslResults.Add([pscustomobject]@{
      distro = $distro
      destination = $destination
      exported = ($size -gt 0)
      exitCode = $null
      sizeGB = [math]::Round($size / 1GB, 2)
      note = if ($size -gt 0) { "reused_existing_export" } else { "export_missing" }
    }) | Out-Null
  } else {
    Set-BackupStatus -Step "wsl:$distro" -State "running"
    $wslResults.Add((Export-WslDistribution -Name $distro -Destination $destination)) | Out-Null
  }
}

Set-BackupStatus -Step "wsl:docker-data" -State "running"
$wslDataDisks = @(
  Copy-WslDataDisk `
    -Source "$env:LOCALAPPDATA\Docker\wsl\disk\docker_data.vhdx" `
    -DestinationRoot (Join-Path $wslRoot "docker-data") `
    -LogPath (Join-Path $logRoot "docker-data-vhd.log")
)

Set-BackupStatus -Step "verification" -State "running"
$verification = @(
  Test-FilePair `
    -Source "D:\projets\funesterie\a11\backend\apps\server\profiles\a11.env" `
    -Destination (Join-Path $BackupRoot "D\projets\funesterie\a11\backend\apps\server\profiles\a11.env")
  Test-FilePair `
    -Source "D:\projets\funesterie\.git\HEAD" `
    -Destination (Join-Path $BackupRoot "D\projets\funesterie\.git\HEAD")
  Test-FilePair `
    -Source "$env:USERPROFILE\.codex\config.toml" `
    -Destination (Join-Path $BackupRoot "C\Users\Djeff\.codex\config.toml")
)

$originalLogs = foreach ($log in Get-ChildItem -LiteralPath $logRoot -Filter "robocopy-*.log" | Sort-Object Name) {
  $text = Get-Content -LiteralPath $log.FullName -Raw
  [pscustomobject]@{
    log = $log.Name
    completed = [bool]($text -match "(?m)^\s*(Fin|Ended)")
    lastWriteTime = $log.LastWriteTime.ToString("o")
  }
}

$manifest = [ordered]@{
  schema = "funesterie.preformat-backup.v2"
  finalizedAt = (Get-Date).ToString("o")
  backupRoot = $BackupRoot
  originalCopyLogs = $originalLogs
  deltaCopies = $deltaResults
  copiedHomeFiles = $homeFileResults
  wslExports = $wslResults
  wslDataDisks = $wslDataDisks
  verification = $verification
  notes = @(
    "Secret values are copied for restore but are not printed.",
    "Common rebuildable caches were excluded.",
    "The old funesterie-worktrees copy is partial; the complete primary repository is backed up.",
    "WSL distributions were stopped before export for a consistent archive."
  )
}

$manifestPath = Join-Path $metaRoot "manifest.json"
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$restoreText = @"
Funesterie pre-format backup
Finalized: $($manifest.finalizedAt)
Root: $BackupRoot

Important restore roots:
- D/projets/funesterie -> D:\projets\funesterie
- D/agent-bus -> D:\agent-bus
- C/Users/Djeff/.codex -> C:\Users\Djeff\.codex
- C/Users/Djeff/.ssh -> C:\Users\Djeff\.ssh
- WSL/*.tar -> wsl --import <name> <install-dir> <tar-file> --version 2

The old D/projets/funesterie-worktrees directory is intentionally only a partial convenience copy.
Treat this backup as private: it includes credentials required for restoration.
"@
$restoreText | Set-Content -LiteralPath (Join-Path $BackupRoot "README_RESTORE.txt") -Encoding UTF8

$failedDelta = @($deltaResults | Where-Object { -not $_.ok })
$failedWsl = @($wslResults | Where-Object { -not $_.exported })
$failedWslData = @($wslDataDisks | Where-Object { -not $_.ok })
$failedVerification = @($verification | Where-Object { -not $_.hashMatches })
if ($failedDelta.Count -or $failedWsl.Count -or $failedWslData.Count -or $failedVerification.Count) {
  Set-BackupStatus -Step "complete" -State "warning" -Detail "Review manifest.json"
  exit 2
}

Set-BackupStatus -Step "complete" -State "ok" -Detail "Ready for safe disconnect"
exit 0
