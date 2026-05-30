param(
  [string]$OutputRoot = "D:\agent-bus\symetrie-op-table",
  [string]$PythonExe = "python",
  [string]$ModulePath = "D:\projets\funesterie\a11\backend\apps\voice-module\app\prime_spiral_morph.py"
)

$ErrorActionPreference = "Stop"

function Write-Utf8File {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Content = ""
  )
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

if (-not (Test-Path -LiteralPath $ModulePath -PathType Leaf)) {
  throw "ModulePath not found: $ModulePath"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $OutputRoot $timestamp
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$jsonText = & $PythonExe $ModulePath --op-table
if ($LASTEXITCODE -ne 0) {
  throw "prime_spiral_morph.py --op-table failed with exit code $LASTEXITCODE"
}

$report = $jsonText | ConvertFrom-Json
$jsonPath = Join-Path $outDir "symetrie-op-table.json"
$mdPath = Join-Path $outDir "symetrie-op-table.md"

Write-Utf8File -Path $jsonPath -Content (($report | ConvertTo-Json -Depth 12) + "`n")

$md = New-Object System.Text.StringBuilder
[void]$md.AppendLine("# Symetrie OP Table $timestamp")
[void]$md.AppendLine("")
[void]$md.AppendLine("Status: $($report.status)")
[void]$md.AppendLine("")
[void]$md.AppendLine("This is an executable research table, not a proof. It separates ordinary complex multiplication from the custom `op_sym` resonance rule.")
[void]$md.AppendLine("")
[void]$md.AppendLine("## Checks")
[void]$md.AppendLine("")
foreach ($property in $report.checks.PSObject.Properties) {
  [void]$md.AppendLine("- $($property.Name): $($property.Value)")
}
[void]$md.AppendLine("")

[void]$md.AppendLine("## Directions")
[void]$md.AppendLine("")
[void]$md.AppendLine("- Directions: $($report.directions -join ', ')")
[void]$md.AppendLine("- Alphabet: $($report.alphabet -join ', ')")
[void]$md.AppendLine("")

function Add-Table {
  param(
    [System.Text.StringBuilder]$Builder,
    [string]$Title,
    [object[]]$Rows
  )
  [void]$Builder.AppendLine("## $Title")
  [void]$Builder.AppendLine("")
  [void]$Builder.AppendLine("| left | right | result | kind |")
  [void]$Builder.AppendLine("|---|---|---|---|")
  foreach ($row in $Rows) {
    [void]$Builder.AppendLine("| $($row.left) | $($row.right) | $($row.result) | $($row.kind) |")
  }
  [void]$Builder.AppendLine("")
}

Add-Table -Builder $md -Title "Ordinary Complex Multiplication" -Rows @($report.complexMultiplication)
Add-Table -Builder $md -Title "Custom op_sym Table" -Rows @($report.opSym)

[void]$md.AppendLine("## Observed Screenshot Equations")
[void]$md.AppendLine("")
[void]$md.AppendLine("| id | operator | left | right | expected | actual | status |")
[void]$md.AppendLine("|---|---|---|---|---|---|---|")
foreach ($row in @($report.observedEquations)) {
  [void]$md.AppendLine("| $($row.id) | $($row.operator) | $($row.left) | $($row.right) | $($row.expected) | $($row.actual) | $($row.status) |")
}
[void]$md.AppendLine("")

[void]$md.AppendLine("## Guardrails")
[void]$md.AppendLine("")
foreach ($rule in @($report.guardrails)) {
  [void]$md.AppendLine("- $rule")
}

Write-Utf8File -Path $mdPath -Content $md.ToString()

[pscustomobject]@{
  ok = $true
  outputDir = $outDir
  json = $jsonPath
  markdown = $mdPath
  checks = $report.checks
} | ConvertTo-Json -Depth 6
