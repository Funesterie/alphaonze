param(
  [string]$Message = "",
  [switch]$StatusOnly,
  [switch]$NoPause,
  [switch]$SkipQflush,
  [switch]$RedeployRailway,
  [switch]$ForceRailwayRedeploy
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
      if ($prefix -and -not $prefix.Contains("/")) {
        $segments = $candidate -split "/"
        if ($segments -contains $prefix) {
          return $true
        }
      }
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

function Get-CurrentBranch {
  param([string]$RepoPath)

  $branch = (& git -C $RepoPath rev-parse --abbrev-ref HEAD).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to resolve current branch for $RepoPath"
  }
  return $branch
}

function Get-BranchDivergence {
  param(
    [string]$RepoPath,
    [string]$TargetBranch
  )

  Invoke-Git -RepoPath $RepoPath -Args @("fetch", "origin", $TargetBranch, "--prune") | Out-Null
  $counts = (& git -C $RepoPath rev-list --left-right --count "origin/$TargetBranch...HEAD").Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to compare HEAD with origin/$TargetBranch in $RepoPath"
  }

  $parts = $counts -split "\s+"
  if ($parts.Count -lt 2) {
    throw "Unexpected divergence output '$counts' for $RepoPath"
  }

  return [pscustomobject]@{
    Behind = [int]$parts[0]
    Ahead = [int]$parts[1]
  }
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
  return "chore(prod): deploy sync $stamp [$RepoName]"
}

function Show-Entries {
  param(
    [string]$Title,
    [object[]]$Entries,
    [string]$Color = "DarkGray",
    [int]$Limit = 20
  )

  if (-not $Entries -or -not $Entries.Count) {
    return
  }

  if ($Entries.Count -gt $Limit) {
    Write-Host "$Title ($($Entries.Count), first $Limit):" -ForegroundColor $Color
    $preview = $Entries | Select-Object -First $Limit
  } else {
    Write-Host "${Title}:" -ForegroundColor $Color
    $preview = $Entries
  }

  foreach ($entry in $preview) {
    Write-Host "  $($entry.Raw)"
  }
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

  $currentBranch = Get-CurrentBranch -RepoPath $repoPath
  $divergence = Get-BranchDivergence -RepoPath $repoPath -TargetBranch $targetBranch

  Write-Host "Branch: $currentBranch | target prod: $targetBranch | ahead=$($divergence.Ahead) behind=$($divergence.Behind)" -ForegroundColor DarkCyan
  Show-Entries -Title "Safe changes" -Entries $safeEntries -Color "Green"
  Show-Entries -Title "Ignored changes" -Entries $ignoredEntries -Color "Yellow"

  $state = "noop"
  $note = "Rien a deployer."
  $shouldPush = $false
  $shouldCommit = $false

  if ($divergence.Behind -gt 0 -and $divergence.Ahead -gt 0) {
    $state = "blocked"
    $note = "La branche locale a diverge de origin/$targetBranch. Rebase ou merge $targetBranch avant le deploy prod."
  } elseif ($safeEntries.Count -gt 0 -and $divergence.Behind -gt 0) {
    $state = "blocked"
    $note = "Des changements locaux existent, mais la branche est en retard sur origin/$targetBranch. Mets-la a jour avant de deployer."
  } elseif ($safeEntries.Count -gt 0) {
    $state = "deploy"
    $note = "Changements locaux prets a etre commit puis pousses vers origin/$targetBranch."
    $shouldCommit = $true
    $shouldPush = $true
  } elseif ($divergence.Ahead -gt 0 -and $divergence.Behind -eq 0) {
    $state = "deploy"
    $note = "Commits deja prets localement, push direct vers origin/$targetBranch."
    $shouldPush = $true
  } elseif ($currentBranch -ne $targetBranch -and $divergence.Behind -gt 0 -and $divergence.Ahead -eq 0) {
    $state = "noop"
    $note = "Branche locale de test plus vieille que $targetBranch, mais sans nouveau commit a deployer."
  } elseif ($currentBranch -eq $targetBranch -and $divergence.Behind -gt 0 -and $divergence.Ahead -eq 0) {
    $state = "noop"
    $note = "Le depot local est en retard sur origin/$targetBranch, mais il n'y a rien de nouveau a deployer."
  }

  switch ($state) {
    "deploy" { Write-Host $note -ForegroundColor Green }
    "blocked" { Write-Host $note -ForegroundColor Red }
    default { Write-Host $note -ForegroundColor DarkGray }
  }

  if ($StatusMode -or $state -ne "deploy") {
    return [pscustomobject]@{
      Name = $repoName
      State = $state
      Note = $note
      Branch = $currentBranch
      TargetBranch = $targetBranch
      Ahead = $divergence.Ahead
      Behind = $divergence.Behind
      Path = $repoPath
      RailwayService = $RepoConfig.RailwayService
    }
  }

  if ($shouldCommit) {
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
      Write-Host "Rien a commit apres filtrage." -ForegroundColor DarkGray
    }
  }

  if ($shouldPush) {
    Write-Host "Push HEAD -> origin/$targetBranch" -ForegroundColor Green
    Invoke-Git -RepoPath $repoPath -Args @("push", "origin", "HEAD:$targetBranch")
  }

  return [pscustomobject]@{
    Name = $repoName
    State = $state
    Note = $note
    Branch = $currentBranch
    TargetBranch = $targetBranch
    Ahead = $divergence.Ahead
    Behind = $divergence.Behind
    Path = $repoPath
    RailwayService = $RepoConfig.RailwayService
  }
}

function Invoke-RailwayRedeploy {
  param(
    [Parameter(Mandatory = $true)][string]$RepoPath,
    [Parameter(Mandatory = $true)][string]$ServiceName
  )

  Write-Host "Railway redeploy: $ServiceName" -ForegroundColor Cyan
  Push-Location $RepoPath
  try {
    & railway redeploy -y -s $ServiceName --json | Out-Host
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
      throw "railway redeploy failed for service '$ServiceName' in $RepoPath (exit $exitCode)"
    }
  } finally {
    Pop-Location
  }
}

$repoOrder = @(
  @{
    Name = "a11backendrailway"
    Path = "D:\funesterie\a11\a11backendrailway"
    Branch = "main"
    RailwayService = "a11backend"
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
    Ignore = @(
      "node_modules/",
      "apps/web/node_modules/",
      "dist/",
      "apps/web/dist/",
      ".netlify/plugins/"
    )
  }
)

  if (-not $SkipQflush) {
  $repoOrder += @{
    Name = "a11qflushrailway"
    Path = "D:\funesterie\a11\a11qflushrailway"
    Branch = "main"
    RailwayService = "qflush"
    Ignore = @(
      ".qflush/",
      "dist/",
      "node_modules/",
      "*.log"
    )
  }
}

$results = @()

try {
  foreach ($repo in $repoOrder) {
    $results += Process-Repo -RepoConfig $repo -StatusMode:$StatusOnly
  }

  Write-Host ""
  Write-Host "Resume deploy A11 prod:" -ForegroundColor Cyan
  foreach ($result in $results) {
    $color = switch ($result.State) {
      "deploy" { "Green" }
      "blocked" { "Red" }
      default { "DarkGray" }
    }
    Write-Host ("- {0}: {1} ({2})" -f $result.Name, $result.State, $result.Note) -ForegroundColor $color
  }

  $blocked = @($results | Where-Object { $_.State -eq "blocked" })
  if ($blocked.Count) {
    throw "Deploy prod bloque sur $($blocked.Count) depot(s). Corrige d'abord les branches signalees ci-dessus."
  }

  if (-not $StatusOnly -and ($RedeployRailway -or $ForceRailwayRedeploy)) {
    Write-Host ""
    Write-Host "Redeploy Railway:" -ForegroundColor Cyan
    foreach ($result in $results) {
      if (-not $result.RailwayService) { continue }
      if (-not $ForceRailwayRedeploy -and $result.State -eq "noop") {
        Write-Host "- $($result.Name): saute (pas de nouveau deploy Git)" -ForegroundColor DarkGray
        continue
      }
      Invoke-RailwayRedeploy -RepoPath $result.Path -ServiceName $result.RailwayService
    }
  }

  Write-Host ""
  Write-Host "Deploy prod termine." -ForegroundColor Green
} catch {
  Write-Host ""
  Write-Host "Deploy A11 prod echoue: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  if (-not $NoPause -and -not $StatusOnly) {
    Write-Host ""
    Read-Host "Appuie sur Entree pour fermer"
  }
}
