param(
  [string]$RepoRoot = '',
  [string[]]$ExtraRepoRoot = @()
)

$ErrorActionPreference = 'Stop'

function Write-Step {
  param([string]$Message)
  Write-Host "[FUNESTERIE UPDATE] $Message" -ForegroundColor Cyan
}

function Invoke-GitText {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string[]]$GitArgs
  )

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = @(& git -C $Root @GitArgs 2>&1)
    $code = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($code -ne 0) {
    throw "git $($GitArgs -join ' ') failed ($code): $($output -join "`n")"
  }

  return ($output -join "`n").Trim()
}

function Test-GitRepo {
  param([string]$Root)

  if (-not (Test-Path -LiteralPath $Root)) {
    return $false
  }

  try {
    $inside = Invoke-GitText -Root $Root -GitArgs @('rev-parse', '--is-inside-work-tree')
    return ($inside -eq 'true')
  }
  catch {
    return $false
  }
}

function Invoke-RepoUpdate {
  param([string]$Root)

  $Root = [System.IO.Path]::GetFullPath($Root)
  if (-not (Test-GitRepo -Root $Root)) {
    Write-Step "Repo ignore (pas un repo Git): $Root"
    return
  }

  Write-Step "Repo: $Root"

  $branch = Invoke-GitText -Root $Root -GitArgs @('branch', '--show-current')
  if ([string]::IsNullOrWhiteSpace($branch)) {
    Write-Step 'Detached HEAD, mise a jour sautee.'
    return
  }

  Write-Step "Branche: $branch"

  $dirty = Invoke-GitText -Root $Root -GitArgs @('status', '--porcelain')
  if (-not [string]::IsNullOrWhiteSpace($dirty)) {
    Write-Step 'Arbre de travail modifie; mise a jour sautee pour proteger le travail local.'
    $dirtyLines = @($dirty -split "`r?`n" | Where-Object { $_ })
    foreach ($line in ($dirtyLines | Select-Object -First 20)) {
      Write-Step "  $line"
    }
    if ($dirtyLines.Count -gt 20) {
      Write-Step "  ... +$($dirtyLines.Count - 20) autres changements locaux"
    }
    return
  }

  $hasUpstream = $false
  $upstream = ''
  try {
    $upstream = Invoke-GitText -Root $Root -GitArgs @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
    if (-not [string]::IsNullOrWhiteSpace($upstream)) {
      $hasUpstream = $true
    }
  }
  catch {
  }

  if (-not $hasUpstream) {
    $upstream = "origin/$branch"
  }

  Write-Step "Source amont: $upstream"

  Invoke-GitText -Root $Root -GitArgs @('fetch', '--prune', 'origin') | Out-Null

  $counts = Invoke-GitText -Root $Root -GitArgs @('rev-list', '--left-right', '--count', "HEAD...$upstream")
  if ($counts -notmatch '^\s*(\d+)\s+(\d+)\s*$') {
    throw "Impossible de lire les compteurs ahead/behind pour ${upstream}: $counts"
  }

  $ahead = [int]$Matches[1]
  $behind = [int]$Matches[2]
  Write-Step "Etat sync: ahead=$ahead behind=$behind"

  if ($behind -eq 0) {
    Write-Step 'Deja a jour.'
    return
  }

  if ($ahead -gt 0) {
    Write-Step 'Branche divergee; mise a jour automatique sautee.'
    return
  }

  Write-Step "Fast-forward depuis $upstream..."
  if ($hasUpstream) {
    Invoke-GitText -Root $Root -GitArgs @('pull', '--ff-only') | Out-Null
  }
  else {
    Invoke-GitText -Root $Root -GitArgs @('pull', '--ff-only', 'origin', $branch) | Out-Null
  }

  Write-Step 'Mise a jour terminee.'
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $scriptDir = Split-Path -Parent $PSCommandPath
  $RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..'))
}
else {
  $RepoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'git introuvable dans le PATH'
}

$repos = New-Object System.Collections.Generic.List[string]
[void]$repos.Add($RepoRoot)

$defaultNestedRepos = @(
  (Join-Path $RepoRoot 'a11mcp')
)

foreach ($candidate in @($defaultNestedRepos + $ExtraRepoRoot)) {
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    continue
  }
  $fullCandidate = [System.IO.Path]::GetFullPath($candidate)
  if ((Test-GitRepo -Root $fullCandidate) -and -not $repos.Contains($fullCandidate)) {
    [void]$repos.Add($fullCandidate)
  }
}

foreach ($repo in $repos) {
  Invoke-RepoUpdate -Root $repo
}

exit 0
