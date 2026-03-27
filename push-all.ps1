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
      Write-Host "Push current HEAD to origin/$targetBranch..." -ForegroundColor DarkGray
      Invoke-Git -RepoPath $repoPath -Args @("push", "origin", "HEAD:$targetBranch")
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

  Write-Host "Push HEAD -> origin/$targetBranch" -ForegroundColor Green
  Invoke-Git -RepoPath $repoPath -Args @("push", "origin", "HEAD:$targetBranch")
}

$repoOrder = @(
  @{
    Name = "a11backendrailway"
    Path = "D:\funesterie\a11\a11backendrailway"
    Branch = "main"
    Ignore = @(
      "apps/server/.env.local",
      "a11_memory/memos/memo_index.jsonl",
      "a11_runtime/",
      "tmp-*.log",
      "*.log"
    )
  },
  @{
    Name = "a11frontendnetlify"
    Path = "D:\funesterie\a11\a11frontendnetlify"
    Branch = "main"
    Ignore = @()
  },
  @{
    Name = "a11llm"
    Path = "D:\funesterie\a11\a11llm"
    Branch = "main"
    Ignore = @(
      "llm/models/",
      "llm/server/",
      "llama.cpp/",
      "*.gguf",
      "*.dll",
      "*.exe"
    )
  },
  @{
    Name = "a11qflushrailway"
    Path = "D:\funesterie\a11\a11qflushrailway"
    Branch = "main"
    Ignore = @()
  },
  @{
    Name = "funesterie"
    Path = "D:\funesterie"
    Branch = "main"
    Ignore = @(
      "a11_runtime/",
      "a11/launchers/dist/",
      "a11/a11desktoptauri/node_modules/",
      "a11/a11desktoptauri/dist/",
      "a11/a11desktoptauri/resources/a11-local/",
      "a11/a11desktoptauri/src-tauri/target/",
      "a11/a11desktoptauri/src-tauri/target-alt/",
      "tmp-*.log",
      "*.log"
    )
  },
  @{
    Name = "dragon"
    Path = "D:\dragon"
    Branch = "main"
    Ignore = @(
      ".dragon/runtime/",
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
