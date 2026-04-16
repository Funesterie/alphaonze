$ErrorActionPreference = 'Stop'

$cliArgs = @($args | ForEach-Object { [string]$_ })

function Has-Flag {
  param([string[]]$Names)
  foreach ($name in $Names) {
    if ($cliArgs -contains $name) {
      return $true
    }
  }
  return $false
}

function Get-CommandPath {
  param([string]$Name)

  try {
    return (Get-Command $Name -ErrorAction Stop).Source
  } catch {
    return $null
  }
}

function Resolve-Action {
  foreach ($arg in $cliArgs) {
    if ([string]::IsNullOrWhiteSpace($arg)) { continue }
    if ($arg.StartsWith('-')) { continue }
    return $arg.ToLowerInvariant()
  }
  return 'status'
}

function Resolve-LocalLauncherInvocation {
  param([string[]]$ForwardArgs)

  $knownCommands = @('start', 'desktop', 'stop', 'restart', 'status', 'status-json', 'check', 'package')
  if ($ForwardArgs.Count -gt 0) {
    $candidate = [string]$ForwardArgs[0]
    if ($knownCommands -contains $candidate.ToLowerInvariant()) {
      return ,$ForwardArgs
    }
  }

  return @('start') + $ForwardArgs
}

function Get-ForwardArgs {
  param([string]$Action)

  $foundAction = $false
  $result = @()

  foreach ($arg in $cliArgs) {
    if (-not $foundAction -and -not [string]::IsNullOrWhiteSpace($arg) -and -not $arg.StartsWith('-') -and $arg.ToLowerInvariant() -eq $Action) {
      $foundAction = $true
      continue
    }

    if ($foundAction) {
      $result += $arg
    }
  }

  return $result
}

function Invoke-Git {
  param([string[]]$Arguments)

  $maxAttempts = 3

  for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    & git -C $workspaceRoot @Arguments
    if ($LASTEXITCODE -eq 0) {
      return
    }

    if ($attempt -lt $maxAttempts) {
      Write-Host ("[funesterie] git retry {0}/{1} -> {2}" -f $attempt, $maxAttempts, ($Arguments -join ' ')) -ForegroundColor Yellow
      Start-Sleep -Seconds 2
      continue
    }

    throw "git $($Arguments -join ' ') a echoue."
  }
}

function Sync-Workspace {
  param([bool]$UseRemote)

  Write-Host '[funesterie] Sync workspace Git...'
  Invoke-Git @('submodule', 'sync', '--recursive')

  $updateArgs = @('submodule', 'update', '--init', '--recursive')
  if ($UseRemote) {
    $updateArgs += '--remote'
  }
  Invoke-Git $updateArgs
}

function Show-Status {
  Write-Host ('[funesterie] Racine          : {0}' -f $workspaceRoot)
  Write-Host ('[funesterie] Launchers A11   : {0}' -f $launchersRoot)
  Write-Host ('[funesterie] Backend A11     : {0}' -f (Join-Path $workspaceRoot 'a11\backend\apps\server'))
  Write-Host ('[funesterie] Frontend A11    : {0}' -f (Join-Path $workspaceRoot 'a11\frontend\apps\web'))
  Write-Host ''

  $criticalPaths = @(
    @{ Label = 'launchers local'; Path = $localLauncher },
    @{ Label = 'launcher desktop'; Path = $desktopLauncher },
    @{ Label = 'launchers online'; Path = $onlineLauncher },
    @{ Label = 'prod deploy'; Path = $prodDeployScript },
    @{ Label = 'launcher config'; Path = (Join-Path $launchersRoot 'config\a11-local.env') },
    @{ Label = 'boundaries'; Path = (Join-Path $workspaceRoot 'a11\WORKSPACE_BOUNDARIES.md') },
    @{ Label = 'backend app'; Path = (Join-Path $workspaceRoot 'a11\backend\apps\server') },
    @{ Label = 'frontend app'; Path = (Join-Path $workspaceRoot 'a11\frontend\apps\web') },
    @{ Label = 'desktop shortcut script'; Path = (Join-Path $launchersRoot 'create-desktop-shortcut.ps1') }
  )

  foreach ($entry in $criticalPaths) {
    if (Test-Path $entry.Path) {
      Write-Host ('[OK]  {0} -> {1}' -f $entry.Label, $entry.Path)
    } else {
      Write-Host ('[MISS] {0} -> {1}' -f $entry.Label, $entry.Path) -ForegroundColor Yellow
    }
  }

  Write-Host ''
  Write-Host '[funesterie] Submodules'
  Invoke-Git @('submodule', 'status')
}

function Invoke-LauncherScript {
  param(
    [string]$LauncherPath,
    [string[]]$ForwardArgs
  )

  if (-not (Test-Path $LauncherPath)) {
    throw "Launcher introuvable: $LauncherPath"
  }

  Write-Host ('[funesterie] Delegation -> {0}' -f $LauncherPath)
  & $powerShellExe -ExecutionPolicy Bypass -File $LauncherPath @ForwardArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Le launcher $LauncherPath a echoue."
  }
}

$workspaceRoot = Split-Path -Parent $PSCommandPath
$launchersRoot = Join-Path $workspaceRoot 'a11\launchers'
$localLauncher = Join-Path $launchersRoot 'a11-local.ps1'
$desktopLauncher = Join-Path $launchersRoot 'a11-desktop.ps1'
$onlineLauncher = Join-Path $launchersRoot 'start-prod-a11.ps1'
$prodDeployScript = Join-Path $workspaceRoot 'deploy-a11-prod.ps1'
$powerShellExe = Get-CommandPath 'pwsh'
if (-not $powerShellExe) {
  $powerShellExe = Get-CommandPath 'powershell'
}
if (-not $powerShellExe) {
  throw 'Aucune console PowerShell disponible.'
}

$action = Resolve-Action
$forwardArgs = Get-ForwardArgs -Action $action
$useRemote = Has-Flag @('--update', '--remote')

switch ($action) {
  'status' {
    Show-Status
  }
  'setup' {
    Sync-Workspace -UseRemote:$useRemote
    Write-Host ''
    Show-Status
  }
  'local' {
    Sync-Workspace -UseRemote:$false
    Write-Host ''
    Show-Status
    Write-Host ''
    Invoke-LauncherScript -LauncherPath $localLauncher -ForwardArgs (Resolve-LocalLauncherInvocation -ForwardArgs $forwardArgs)
  }
  'online' {
    Sync-Workspace -UseRemote:$false
    Write-Host ''
    Show-Status
    Write-Host ''
    Invoke-LauncherScript -LauncherPath $onlineLauncher -ForwardArgs $forwardArgs
  }
  default {
    throw "Action inconnue: $action. Utilise status, setup, local ou online."
  }
}
