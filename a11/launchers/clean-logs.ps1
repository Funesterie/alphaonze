param(
  [switch]$NoPause
)

$ErrorActionPreference = "Stop"

$targets = @(
  @{
    Name = "Launcher logs"
    Path = "D:\funesterie\a11\launchers\runtime\logs"
  },
  @{
    Name = "Qflush logs"
    Path = "D:\funesterie\a11\a11qflushrailway\.qflush\logs"
  }
)

$removed = 0
$skipped = 0

foreach ($target in $targets) {
  $path = $target.Path
  Write-Host ""
  Write-Host ("== " + $target.Name + " ==") -ForegroundColor Cyan

  if (-not (Test-Path $path)) {
    Write-Host ("Missing: " + $path) -ForegroundColor DarkYellow
    continue
  }

  $items = Get-ChildItem -Path $path -Force
  if (-not $items.Count) {
    Write-Host "Already empty." -ForegroundColor DarkGray
    continue
  }

  foreach ($item in $items) {
    try {
      Remove-Item -LiteralPath $item.FullName -Recurse -Force -ErrorAction Stop
      $removed++
    } catch {
      $skipped++
      Write-Host ("Skipped locked item: " + $item.FullName) -ForegroundColor DarkYellow
    }
  }

  Write-Host ("Processed " + $items.Count + " item(s) in " + $path) -ForegroundColor Green
}

Write-Host ""
Write-Host ("Total removed: " + $removed) -ForegroundColor Green
Write-Host ("Total skipped: " + $skipped) -ForegroundColor DarkYellow

if (-not $NoPause) {
  Write-Host ""
  Read-Host "Press Enter to close"
}
