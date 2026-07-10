param(
  [string]$BackupRoot = "",
  [switch]$SkipWslExport
)

$ErrorActionPreference = "Stop"

function New-Directory {
  param([Parameter(Mandatory = $true)][string]$Path)
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Get-DirectorySizeBytes {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return 0 }
  $sum = (Get-ChildItem -LiteralPath $Path -Force -Recurse -File -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
  if ($null -eq $sum) { return 0 }
  return [int64]$sum
}

function Invoke-RobocopySafe {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$LogPath,
    [string[]]$ExcludeDirs = @(),
    [string[]]$ExcludeFiles = @()
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

  New-Directory $Destination
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
    "/TEE",
    "/LOG+:$LogPath"
  )
  if ($ExcludeDirs.Count) { $args += @("/XD") + $ExcludeDirs }
  if ($ExcludeFiles.Count) { $args += @("/XF") + $ExcludeFiles }

  & robocopy @args | Out-Host
  $code = $LASTEXITCODE
  $global:LASTEXITCODE = 0
  return [pscustomobject]@{
    source = $Source
    destination = $Destination
    exists = $true
    exitCode = $code
    ok = ($code -le 7)
    note = if ($code -le 7) { "copied" } else { "robocopy_failed" }
  }
}

function Copy-FileIfExists {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$DestinationRoot
  )
  if (-not (Test-Path -LiteralPath $Source)) {
    return [pscustomobject]@{ source = $Source; copied = $false; note = "missing" }
  }
  $leaf = Split-Path -Leaf $Source
  New-Directory $DestinationRoot
  Copy-Item -LiteralPath $Source -Destination (Join-Path $DestinationRoot $leaf) -Force
  return [pscustomobject]@{ source = $Source; copied = $true; note = "copied" }
}

function Export-WslDistroIfPresent {
  param(
    [Parameter(Mandatory = $true)][string]$DistroName,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  $list = @(& wsl.exe --list --quiet 2>$null)
  $available = $false
  foreach ($entry in $list) {
    $name = (([string]$entry) -replace "\x00", "").Trim()
    if ($name -eq $DistroName) { $available = $true; break }
  }
  if (-not $available) {
    return [pscustomobject]@{ distro = $DistroName; exported = $false; note = "missing" }
  }

  New-Directory (Split-Path -Parent $Destination)
  & wsl.exe --export $DistroName $Destination
  $code = $LASTEXITCODE
  $size = if (Test-Path -LiteralPath $Destination) { (Get-Item -LiteralPath $Destination).Length } else { 0 }
  return [pscustomobject]@{
    distro = $DistroName
    destination = $Destination
    exported = ($code -eq 0 -and $size -gt 0)
    exitCode = $code
    sizeGB = [math]::Round($size / 1GB, 2)
    note = if ($code -eq 0 -and $size -gt 0) { "exported" } else { "export_failed" }
  }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
  $BackupRoot = "E:\FUNESTERIE_PREFORMAT_BACKUP_$stamp"
}
$BackupRoot = [System.IO.Path]::GetFullPath($BackupRoot)
$logRoot = Join-Path $BackupRoot "_logs"
$metaRoot = Join-Path $BackupRoot "_meta"
$wslRoot = Join-Path $BackupRoot "WSL"
New-Directory $BackupRoot
New-Directory $logRoot
New-Directory $metaRoot

$commonExcludeDirs = @(
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

$commonExcludeFiles = @(
  "*.tmp",
  "*.log",
  "*.pid",
  "*.lock"
)

$copyJobs = @(
  @{ Source = "D:\projets\funesterie"; Destination = "D\projets\funesterie" },
  @{ Source = "D:\agent-bus"; Destination = "D\agent-bus" },
  @{ Source = "D:\projets\funesterie-worktrees"; Destination = "D\projets\funesterie-worktrees" },
  @{ Source = "$env:USERPROFILE\.codex"; Destination = "C\Users\Djeff\.codex" },
  @{ Source = "$env:USERPROFILE\.ssh"; Destination = "C\Users\Djeff\.ssh" },
  @{ Source = "$env:USERPROFILE\.kiro"; Destination = "C\Users\Djeff\.kiro" },
  @{ Source = "$env:USERPROFILE\.claude"; Destination = "C\Users\Djeff\.claude" },
  @{ Source = "$env:USERPROFILE\.gemini"; Destination = "C\Users\Djeff\.gemini" },
  @{ Source = "$env:USERPROFILE\.vscode"; Destination = "C\Users\Djeff\.vscode" },
  @{ Source = "$env:USERPROFILE\.Neo4jDesktop2"; Destination = "C\Users\Djeff\.Neo4jDesktop2" },
  @{ Source = "$env:USERPROFILE\.continue"; Destination = "C\Users\Djeff\.continue" },
  @{ Source = "$env:USERPROFILE\.docker"; Destination = "C\Users\Djeff\.docker" },
  @{ Source = "$env:USERPROFILE\.grok"; Destination = "C\Users\Djeff\.grok" },
  @{ Source = "$env:USERPROFILE\.agents"; Destination = "C\Users\Djeff\.agents" },
  @{ Source = "$env:USERPROFILE\.cagent"; Destination = "C\Users\Djeff\.cagent" },
  @{ Source = "$env:USERPROFILE\.copilot"; Destination = "C\Users\Djeff\.copilot" },
  @{ Source = "$env:USERPROFILE\.kube"; Destination = "C\Users\Djeff\.kube" },
  @{ Source = "$env:USERPROFILE\.aws"; Destination = "C\Users\Djeff\.aws" },
  @{ Source = "$env:USERPROFILE\.azure"; Destination = "C\Users\Djeff\.azure" },
  @{ Source = "$env:USERPROFILE\.gnupg"; Destination = "C\Users\Djeff\.gnupg" },
  @{ Source = "$env:USERPROFILE\.mcp-auth"; Destination = "C\Users\Djeff\.mcp-auth" },
  @{ Source = "$env:USERPROFILE\.secrets"; Destination = "C\Users\Djeff\.secrets" },
  @{ Source = "$env:USERPROFILE\.cloudflared"; Destination = "C\Users\Djeff\.cloudflared" },
  @{ Source = "$env:USERPROFILE\.railway"; Destination = "C\Users\Djeff\.railway" },
  @{ Source = "$env:USERPROFILE\.render"; Destination = "C\Users\Djeff\.render" },
  @{ Source = "$env:USERPROFILE\.config"; Destination = "C\Users\Djeff\.config" },
  @{ Source = "$env:USERPROFILE\.funesterie"; Destination = "C\Users\Djeff\.funesterie" },
  @{ Source = "$env:USERPROFILE\.cargo"; Destination = "C\Users\Djeff\.cargo" },
  @{ Source = "$env:USERPROFILE\.rustup"; Destination = "C\Users\Djeff\.rustup" },
  @{ Source = "$env:USERPROFILE\.local\bin"; Destination = "C\Users\Djeff\.local\bin" },
  @{ Source = "$env:USERPROFILE\.local\state"; Destination = "C\Users\Djeff\.local\state" },
  @{ Source = "$env:USERPROFILE\.local\share\claude"; Destination = "C\Users\Djeff\.local\share\claude" },
  @{ Source = "$env:USERPROFILE\Desktop"; Destination = "C\Users\Djeff\Desktop" },
  @{ Source = "$env:USERPROFILE\Documents"; Destination = "C\Users\Djeff\Documents" },
  @{ Source = "$env:USERPROFILE\Downloads"; Destination = "C\Users\Djeff\Downloads" },
  @{ Source = "$env:APPDATA\Code"; Destination = "C\Users\Djeff\AppData\Roaming\Code" },
  @{ Source = "$env:APPDATA\npm"; Destination = "C\Users\Djeff\AppData\Roaming\npm" },
  @{ Source = "$env:APPDATA\Microsoft\Windows\PowerShell"; Destination = "C\Users\Djeff\AppData\Roaming\Microsoft\Windows\PowerShell" },
  @{ Source = "$env:USERPROFILE\Documents\PowerShell"; Destination = "C\Users\Djeff\Documents\PowerShell" },
  @{ Source = "$env:USERPROFILE\Documents\WindowsPowerShell"; Destination = "C\Users\Djeff\Documents\WindowsPowerShell" },
  @{ Source = "$env:LOCALAPPDATA\Google\Chrome\User Data"; Destination = "C\Users\Djeff\AppData\Local\Google\Chrome\User Data" },
  @{ Source = "$env:LOCALAPPDATA\Microsoft\Edge\User Data"; Destination = "C\Users\Djeff\AppData\Local\Microsoft\Edge\User Data" }
)

$results = New-Object System.Collections.Generic.List[object]
$index = 0
foreach ($job in $copyJobs) {
  $index++
  $source = [string]$job.Source
  $destination = Join-Path $BackupRoot ([string]$job.Destination)
  $logPath = Join-Path $logRoot ("robocopy-{0:00}.log" -f $index)
  Write-Host ("[{0}/{1}] Copy {2}" -f $index, $copyJobs.Count, $source) -ForegroundColor Cyan
  $result = Invoke-RobocopySafe -Source $source -Destination $destination -LogPath $logPath -ExcludeDirs $commonExcludeDirs -ExcludeFiles $commonExcludeFiles
  $results.Add($result) | Out-Null
  if (-not $result.ok) {
    Write-Host "  WARNING: $($result.note) exit=$($result.exitCode)" -ForegroundColor Yellow
  }
}

$fileResults = New-Object System.Collections.Generic.List[object]
$fileRoot = Join-Path $BackupRoot "C\Users\Djeff\home-files"
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
  $fileResults.Add((Copy-FileIfExists -Source $file -DestinationRoot $fileRoot)) | Out-Null
}

$wslResults = New-Object System.Collections.Generic.List[object]
if (-not $SkipWslExport) {
  foreach ($distro in @("podman-a11-wsl", "podman-net-usermode", "docker-desktop")) {
    Write-Host "Export WSL $distro" -ForegroundColor Cyan
    $wslResults.Add((Export-WslDistroIfPresent -DistroName $distro -Destination (Join-Path $wslRoot "$distro.tar"))) | Out-Null
  }
}

$driveSnapshot = @(Get-Volume | Sort-Object DriveLetter | Select-Object DriveLetter, FileSystemLabel, FileSystem, DriveType, HealthStatus, SizeRemaining, Size)
$backupSizeBytes = Get-DirectorySizeBytes $BackupRoot
$manifest = [ordered]@{
  schema = "funesterie.preformat-backup.v1"
  createdAt = (Get-Date).ToString("o")
  backupRoot = $BackupRoot
  backupSizeGB = [math]::Round($backupSizeBytes / 1GB, 2)
  driveSnapshot = $driveSnapshot
  copyJobs = $results
  copiedHomeFiles = $fileResults
  wslExports = $wslResults
  notes = @(
    "Secret values are copied for restore but not printed.",
    "Common rebuildable caches were excluded: node_modules, build/dist caches, browser caches, .codex-tmp.",
    "WSL Podman is exported as tar instead of copying live ext4.vhdx."
  )
}

$manifestPath = Join-Path $metaRoot "manifest.json"
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$restoreText = @"
Funesterie pre-format backup
Created: $($manifest.createdAt)
Root: $BackupRoot

Important restore roots:
- D/projets/funesterie -> D:\projets\funesterie
- D/agent-bus -> D:\agent-bus
- C/Users/Djeff/.codex -> C:\Users\Djeff\.codex
- C/Users/Djeff/.ssh -> C:\Users\Djeff\.ssh
- WSL/*.tar can be restored with: wsl --import <name> <install-dir> <tar-file> --version 2

Do not paste secrets from this backup into chat. Treat the whole backup as private.
"@
$restoreText | Set-Content -LiteralPath (Join-Path $BackupRoot "README_RESTORE.txt") -Encoding UTF8

Write-Host ""
Write-Host "Backup complete: $BackupRoot" -ForegroundColor Green
Write-Host ("Backup size: {0} GB" -f ([math]::Round($backupSizeBytes / 1GB, 2))) -ForegroundColor Green
Write-Host "Manifest: $manifestPath" -ForegroundColor Green

$failed = @($results | Where-Object { -not $_.ok })
if ($failed.Count) {
  Write-Host "WARNING: $($failed.Count) copy jobs reported problems. Read logs under $logRoot." -ForegroundColor Yellow
  exit 2
}

exit 0
