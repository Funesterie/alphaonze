param(
  [switch]$AcceptAll,
  [switch]$SkipOllama,
  [switch]$SkipDevTools,
  [switch]$PullDefaultModel,
  [string]$DefaultModel = "llama3.2:3b"
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Relance PowerShell en administrateur pour autoriser l'installation autonome Kaen44."
  }
}

function Confirm-AutonomousInstall {
  if ($AcceptAll) { return }
  Write-Host "Kaen44 va installer ou verifier les outils utiles: Ollama, Git, Node.js LTS, Python, ffmpeg et Microsoft Edge WebView2 si disponibles via winget."
  Write-Host "Aucune cle API n'est affichee. Les tokens restent a ajouter via: kaen44 token set <nom>."
  $answer = Read-Host "Autoriser l'installation autonome maintenant ? (oui/non)"
  if ($answer.Trim().ToLowerInvariant() -notin @("o", "oui", "y", "yes")) {
    throw "Installation autonome annulee."
  }
}

function Test-CommandAvailable {
  param([Parameter(Mandatory = $true)][string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-WingetPackage {
  param(
    [Parameter(Mandatory = $true)][string]$Id,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if (-not (Test-CommandAvailable winget)) {
    Write-Warning "winget est indisponible; installation automatique de $Name ignoree."
    return
  }

  Write-Host "[Kaen44] Verification $Name..."
  $installed = winget list --id $Id --exact --accept-source-agreements 2>$null
  if ($LASTEXITCODE -eq 0 -and ($installed -match [regex]::Escape($Id))) {
    Write-Host "[Kaen44] $Name deja installe."
    return
  }

  Write-Host "[Kaen44] Installation $Name..."
  winget install --id $Id --exact --silent --accept-package-agreements --accept-source-agreements
}

Assert-Administrator
Confirm-AutonomousInstall

if (-not $SkipOllama) {
  Install-WingetPackage -Id "Ollama.Ollama" -Name "Ollama"
}

if (-not $SkipDevTools) {
  Install-WingetPackage -Id "Git.Git" -Name "Git"
  Install-WingetPackage -Id "OpenJS.NodeJS.LTS" -Name "Node.js LTS"
  Install-WingetPackage -Id "Python.Python.3.12" -Name "Python 3.12"
  Install-WingetPackage -Id "Gyan.FFmpeg" -Name "ffmpeg"
  Install-WingetPackage -Id "Microsoft.EdgeWebView2Runtime" -Name "Microsoft Edge WebView2 Runtime"
}

if ($PullDefaultModel -and -not $SkipOllama) {
  if (Test-CommandAvailable ollama) {
    Write-Host "[Kaen44] Telechargement du modele local $DefaultModel..."
    ollama pull $DefaultModel
  } else {
    Write-Warning "ollama n'est pas encore dans le PATH courant. Redemarre le terminal puis lance: ollama pull $DefaultModel"
  }
}

Write-Host "[Kaen44] Installation autonome terminee."
Write-Host "Commandes utiles:"
Write-Host "  kaen44 open"
Write-Host "  kaen44 token set openai"
Write-Host "  kaen44 token set groq"
Write-Host "  kaen44 token list"
