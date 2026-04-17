param(
  [string]$Message = "",
  [switch]$StatusOnly,
  [switch]$NoPause
)

$ErrorActionPreference = "Stop"

function Write-Step($text) {
  Write-Host ""
  Write-Host "== $text ==" -ForegroundColor Cyan
}

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)][string]$RepoPath,
    [Parameter(Mandatory = $true)][string[]]$Args,
    [switch]$AllowFailure
  )

  & git -C $RepoPath @Args
  $exitCode = $LASTEXITCODE
  if (-not $AllowFailure -and $exitCode -ne 0) {
    throw "git $($Args -join ' ') failed in $RepoPath (exit $exitCode)"
  }
  return $exitCode
}

function Get-PushRemotes {
  param([string]$RepoPath)

  $remoteNames = & git -C $RepoPath remote
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to list remotes for $RepoPath"
  }

  $preferred = @("origin", "jEFFLEZ")
  $selected = @()
  foreach ($name in $preferred) {
    if ($remoteNames -contains $name) {
      $selected += $name
    }
  }

  if (-not $selected.Count) {
    $selected = @($remoteNames)
  }

  return $selected
}

function Push-RepoHead {
  param(
    [Parameter(Mandatory = $true)][string]$RepoPath,
    [Parameter(Mandatory = $true)][string]$TargetBranch
  )

  foreach ($remoteName in (Get-PushRemotes -RepoPath $RepoPath)) {
    Write-Host "Push HEAD -> $remoteName/$TargetBranch" -ForegroundColor Green
    Invoke-Git -RepoPath $RepoPath -Args @("push", $remoteName, "HEAD:$TargetBranch")
  }
}

function Normalize-RepoPath {
  param([string]$Path)
  $normalized = ($Path -replace "\\", "/").Trim()
  if ($normalized.StartsWith('"') -and $normalized.EndsWith('"') -and $normalized.Length -ge 2) {
    $normalized = $normalized.Substring(1, $normalized.Length - 2)
  }
  return $normalized
}

function Test-IgnoredPath {
  param(
    [string]$RelativePath,
    [string[]]$IgnoreRules
  )

  $candidate = Normalize-RepoPath $RelativePath
  foreach ($rule in ($IgnoreRules | Where-Object { $_ })) {
    $normalizedRule = Normalize-RepoPath $rule
    if ($normalizedRule.EndsWith("/")) {
      $prefix = $normalizedRule.TrimEnd("/")
      if ($candidate -eq $prefix -or $candidate.StartsWith("$prefix/")) {
        return $true
      }
      continue
    }
    if ($normalizedRule.Contains("*") -or $normalizedRule.Contains("?")) {
      if ($candidate -like $normalizedRule) {
        return $true
      }
      continue
    }
    if ($candidate -eq $normalizedRule -or $candidate.StartsWith("$normalizedRule/")) {
      return $true
    }
  }
  return $false
}

function Get-RepoStatusEntries {
  param([string]$RepoPath)

  $lines = & git -c core.quotepath=false -C $RepoPath status --porcelain=v1
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to read git status for $RepoPath"
  }

  $entries = @()
  foreach ($line in $lines) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $status = if ($line.Length -ge 2) { $line.Substring(0, 2) } else { "??" }
    $body = if ($line.Length -ge 4) { $line.Substring(3).Trim() } else { "" }
    $paths = @()
    if ($body -match " -> ") {
      $paths = $body -split " -> "
    } elseif ($body) {
      $paths = @($body)
    }
    if (-not $paths.Count) {
      continue
    }
    $entries += [pscustomobject]@{
      Raw = $line
      Status = $status
      Paths = $paths
      PrimaryPath = $paths[-1]
    }
  }
  return $entries
}

function Get-CommitMessage {
  param(
    [string]$BaseMessage,
    [string]$RepoName
  )

  if ($BaseMessage) {
    return "$BaseMessage [$RepoName]"
  }
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  return "chore(sync): auto-push $stamp [$RepoName]"
}

function Process-Repo {
  param(
    [hashtable]$RepoConfig,
    [switch]$StatusMode
  )

  $repoName = $RepoConfig.Name
  $repoPath = $RepoConfig.Path
  $targetBranch = $RepoConfig.Branch
  $ignoreRules = @($RepoConfig.Ignore)

  Write-Step $repoName

  if (-not (Test-Path (Join-Path $repoPath ".git"))) {
    throw "Missing .git in $repoPath"
  }

  $entries = Get-RepoStatusEntries -RepoPath $repoPath
  if (-not $entries.Count) {
    Write-Host "No local changes." -ForegroundColor DarkGray
    if (-not $StatusMode) {
      Write-Host "Push current HEAD to configured remotes..." -ForegroundColor DarkGray
      Push-RepoHead -RepoPath $repoPath -TargetBranch $targetBranch
    }
    return
  }

  $safeEntries = @()
  $ignoredEntries = @()
  foreach ($entry in $entries) {
    $isIgnored = $false
    foreach ($path in $entry.Paths) {
      if (Test-IgnoredPath -RelativePath $path -IgnoreRules $ignoreRules) {
        $isIgnored = $true
        break
      }
    }
    if ($isIgnored) {
      $ignoredEntries += $entry
    } else {
      $safeEntries += $entry
    }
  }

  if ($safeEntries.Count) {
    Write-Host "Safe changes:" -ForegroundColor Green
    foreach ($entry in $safeEntries) {
      Write-Host "  $($entry.Raw)"
    }
  } else {
    Write-Host "No safe changes to commit." -ForegroundColor DarkGray
  }

  if ($ignoredEntries.Count) {
    $ignoredPreviewLimit = 40
    if ($ignoredEntries.Count -gt $ignoredPreviewLimit) {
      Write-Host "Ignored changes: $($ignoredEntries.Count) entries (showing first $ignoredPreviewLimit)" -ForegroundColor Yellow
      $previewEntries = $ignoredEntries | Select-Object -First $ignoredPreviewLimit
    } else {
      Write-Host "Ignored changes:" -ForegroundColor Yellow
      $previewEntries = $ignoredEntries
    }

    foreach ($entry in $previewEntries) {
      Write-Host "  $($entry.Raw)"
    }
  }

  if ($StatusMode) {
    return
  }

  foreach ($entry in $safeEntries) {
    Invoke-Git -RepoPath $repoPath -Args @("add", "-A", "--", $entry.PrimaryPath)
  }

  Invoke-Git -RepoPath $repoPath -Args @("diff", "--cached", "--quiet") -AllowFailure | Out-Null
  $hasStagedChanges = $LASTEXITCODE -ne 0

  if ($hasStagedChanges) {
    $commitMessage = Get-CommitMessage -BaseMessage $Message -RepoName $repoName
    Write-Host "Commit: $commitMessage" -ForegroundColor Green
    Invoke-Git -RepoPath $repoPath -Args @("commit", "-m", $commitMessage)
  } else {
    Write-Host "Nothing staged after ignore filters." -ForegroundColor DarkGray
  }

  Push-RepoHead -RepoPath $repoPath -TargetBranch $targetBranch
}

$repoOrder = @(
  @{
    Name = "funesterie-monorepo"
    Path = "D:\funesterie"
    Branch = "master"
    Ignore = @(
      "a11_runtime/",
      "a11/runtime/",
      "a11/launchers/dist/",
      ".codex-tmp/",
      "a11/tmp/",
      "dump-a11-prep/",
      "pour copilot/",
      "tmp-*.log",
      "*.log"
    )
  }
)

try {
  foreach ($repo in $repoOrder) {
    Process-Repo -RepoConfig $repo -StatusMode:$StatusOnly
  }

  Write-Host ""
  Write-Host "Done." -ForegroundColor Green
} catch {
  Write-Host ""
  Write-Host "Push-all failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  if (-not $NoPause -and -not $StatusOnly) {
    Write-Host ""
    Read-Host "Appuie sur Entree pour fermer"
  }
}
