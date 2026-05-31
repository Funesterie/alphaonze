# New-SemanticFileIndex.ps1 - Secret-safe semantic anchors for local source files.
# Produces a JSON index plus a Markdown map that Rome/Katana/Allmight can consume later.

param(
  [string]$RepoRoot = "D:\projets\funesterie",
  [string]$OutputDir = "D:\agent-bus\semantic-index",
  [string[]]$Path = @(),
  [string]$PathListFile = "",
  [int]$MaxFileBytes = 900000,
  [int]$MaxSnippetChars = 180
)

$ErrorActionPreference = "Stop"

function Write-Utf8File {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Convert-ToRelativePath {
  param([Parameter(Mandatory = $true)][string]$FullPath)
  $root = (Resolve-Path -LiteralPath $RepoRoot).Path.TrimEnd('\', '/')
  $resolved = (Resolve-Path -LiteralPath $FullPath).Path
  if ($resolved.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $resolved.Substring($root.Length).TrimStart('\', '/') -replace '\\', '/'
  }
  return $resolved -replace '\\', '/'
}

function Get-Language {
  param([Parameter(Mandatory = $true)][string]$FilePath)
  switch ([System.IO.Path]::GetExtension($FilePath).ToLowerInvariant()) {
    ".tsx" { return "tsx" }
    ".ts" { return "ts" }
    ".jsx" { return "jsx" }
    ".js" { return "js" }
    ".cjs" { return "cjs" }
    ".mjs" { return "mjs" }
    ".py" { return "python" }
    ".ps1" { return "powershell" }
    ".css" { return "css" }
    ".md" { return "markdown" }
    ".json" { return "json" }
    default { return "text" }
  }
}

function Test-SkipPath {
  param([Parameter(Mandatory = $true)][string]$RelativePath)
  $p = $RelativePath -replace '\\', '/'
  return (
    $p -match '(^|/)node_modules/' -or
    $p -match '(^|/)\.git/' -or
    $p -match '(^|/)dist/' -or
    $p -match '(^|/)build/' -or
    $p -match '(^|/)coverage/' -or
    $p -match '(^|/)public/legacy/' -or
    $p -match '(^|/)runtime/browser-profiles/' -or
    $p -match '(^|/)logs?/' -or
    $p -match '\.(png|jpg|jpeg|gif|webp|ico|wav|mp3|mp4|zip|gz|7z|bin|exe|dll|pdb)$'
  )
}

function Redact-Snippet {
  param([string]$Text)
  $value = ($Text -replace '\s+', ' ').Trim()
  if ($value.Length -gt $MaxSnippetChars) {
    $value = $value.Substring(0, $MaxSnippetChars) + "..."
  }
  if ($value -match '(?i)(api[_-]?key|secret|token|password|passwd|private[_-]?key)\s*[:=]') {
    return "[redacted secret-like line]"
  }
  return $value
}

function Add-Tag {
  param(
    [System.Collections.Generic.HashSet[string]]$Set,
    [Parameter(Mandatory = $true)][string]$Value
  )
  [void]$Set.Add($Value)
}

function Get-SemanticTags {
  param([string]$Text, [string]$RelativePath)
  $tags = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  $hay = ($RelativePath + "`n" + $Text).ToLowerInvariant()

  if ($hay -match 'auth|session|oauth|cookie|login|family|gate') { Add-Tag $tags "auth-session-gate" }
  if ($hay -match 'vivy|voice|tts|audio|song|lyrics|xtts|rvc|piper|speak') { Add-Tag $tags "voice-audio-vivy" }
  if ($hay -match 'drive|google|microsoft|onedrive|storage|upload|connector') { Add-Tag $tags "account-drive-storage" }
  if ($hay -match 'mcp|neo4j|memory|agent|discussion|job|worker') { Add-Tag $tags "mcp-agent-memory" }
  if ($hay -match 'wip|katana|allmight|rome|rescue|semantic') { Add-Tag $tags "wip-tooling" }
  if ($hay -match 'prime|riemann|spiral|symmetry|symetr|spectral|complex|imaginary|nombre') { Add-Tag $tags "djeff-math-research" }
  if ($hay -match 'route|router\.|app\.get|app\.post|fetch\(|api/') { Add-Tag $tags "api-routing" }
  if ($hay -match 'component|tsx|react|useeffect|usestate|button|panel') { Add-Tag $tags "frontend-ui" }
  if ($hay -match 'cors|origin|csrf|rate|limit|safe|guard|redact') { Add-Tag $tags "security-safety" }

  return @($tags | Sort-Object)
}

function New-Anchor {
  param(
    [int]$Line,
    [string]$Kind,
    [string]$Name,
    [string]$Snippet
  )
  [pscustomobject]@{
    line = $Line
    kind = $Kind
    name = $Name
    snippet = (Redact-Snippet $Snippet)
  }
}

function Get-Anchors {
  param(
    [string[]]$Lines,
    [string]$Language
  )

  $anchors = New-Object System.Collections.Generic.List[object]

  for ($i = 0; $i -lt $Lines.Count; $i++) {
    $lineNo = $i + 1
    $line = $Lines[$i]
    $trim = $line.Trim()
    if (-not $trim) { continue }

    if ($Language -in @("js", "cjs", "mjs", "ts", "tsx", "jsx")) {
      if ($trim -match '^(export\s+)?(async\s+)?function\s+([A-Za-z0-9_$]+)') {
        $anchors.Add((New-Anchor $lineNo "function" $Matches[3] $trim))
      } elseif ($trim -match '^(export\s+)?class\s+([A-Za-z0-9_$]+)') {
        $anchors.Add((New-Anchor $lineNo "class" $Matches[2] $trim))
      } elseif ($trim -match '^(export\s+)?const\s+([A-Za-z0-9_$]+)\s*=') {
        $name = $Matches[2]
        $kind = "const"
        if ($name -cmatch '^[A-Z]') { $kind = "component-or-const" }
        if ($trim -match '=>|function|\(\s*\)') { $kind = "function-const" }
        $anchors.Add((New-Anchor $lineNo $kind $name $trim))
      } elseif ($trim -match '(router|app)\.(get|post|put|patch|delete|use)\s*\(\s*["'']([^"'']+)') {
        $anchors.Add((New-Anchor $lineNo "route:$($Matches[2])" $Matches[3] $trim))
      } elseif ($trim -match '^(export\s+)?default\s+function\s+([A-Za-z0-9_$]+)') {
        $anchors.Add((New-Anchor $lineNo "default-function" $Matches[2] $trim))
      } elseif ($trim -match '^import\s+') {
        $anchors.Add((New-Anchor $lineNo "import" "import" $trim))
      } elseif ($trim -match '^export\s+') {
        $anchors.Add((New-Anchor $lineNo "export" "export" $trim))
      }
    } elseif ($Language -eq "python") {
      if ($trim -match '^def\s+([A-Za-z0-9_]+)\s*\(') {
        $anchors.Add((New-Anchor $lineNo "function" $Matches[1] $trim))
      } elseif ($trim -match '^async\s+def\s+([A-Za-z0-9_]+)\s*\(') {
        $anchors.Add((New-Anchor $lineNo "async-function" $Matches[1] $trim))
      } elseif ($trim -match '^class\s+([A-Za-z0-9_]+)') {
        $anchors.Add((New-Anchor $lineNo "class" $Matches[1] $trim))
      } elseif ($trim -match '^@(app|router)\.(get|post|put|patch|delete)\s*\(\s*["'']([^"'']+)') {
        $anchors.Add((New-Anchor $lineNo "route:$($Matches[2])" $Matches[3] $trim))
      }
    } elseif ($Language -eq "powershell") {
      if ($trim -match '^function\s+([A-Za-z0-9_-]+)') {
        $anchors.Add((New-Anchor $lineNo "function" $Matches[1] $trim))
      } elseif ($trim -match '^param\s*\(') {
        $anchors.Add((New-Anchor $lineNo "param" "param" $trim))
      }
    } elseif ($Language -eq "css") {
      if ($trim -match '^([.#][A-Za-z0-9_-]+|[A-Za-z][A-Za-z0-9_-]*)[^{]*\{') {
        $anchors.Add((New-Anchor $lineNo "selector" $Matches[1] $trim))
      }
    } elseif ($Language -eq "markdown") {
      if ($trim -match '^(#{1,6})\s+(.+)') {
        $anchors.Add((New-Anchor $lineNo "heading:$($Matches[1].Length)" $Matches[2] $trim))
      }
    }
  }

  return $anchors.ToArray()
}

function Get-InputFiles {
  if ($PathListFile) {
    if (-not (Test-Path -LiteralPath $PathListFile -PathType Leaf)) {
      throw "PathListFile not found: $PathListFile"
    }
    $Path = Get-Content -LiteralPath $PathListFile | Where-Object { $_ -and $_.Trim() }
  }

  if ($Path.Count -gt 0) {
    $items = foreach ($p in $Path) {
      $candidate = if ([System.IO.Path]::IsPathRooted($p)) { $p } else { Join-Path $RepoRoot $p }
      if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        Get-Item -LiteralPath $candidate
      } elseif (Test-Path -LiteralPath $candidate -PathType Container) {
        Get-ChildItem -LiteralPath $candidate -Recurse -File
      }
    }
    return @($items)
  }

  $status = git -C $RepoRoot status --short
  $paths = foreach ($entry in $status) {
    $raw = $entry.Substring(3).Trim()
    if ($raw -match ' -> ') { $raw = ($raw -split ' -> ')[-1] }
    $raw
  }
  return @($paths | Sort-Object -Unique | ForEach-Object {
    $full = Join-Path $RepoRoot $_
    if (Test-Path -LiteralPath $full -PathType Leaf) { Get-Item -LiteralPath $full }
  })
}

if (-not (Test-Path -LiteralPath $RepoRoot)) {
  throw "RepoRoot not found: $RepoRoot"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runDir = Join-Path $OutputDir $timestamp
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$files = Get-InputFiles
$indexed = New-Object System.Collections.Generic.List[object]

foreach ($file in $files) {
  $relative = Convert-ToRelativePath $file.FullName
  if (Test-SkipPath $relative) { continue }
  if ($file.Length -gt $MaxFileBytes) { continue }

  $language = Get-Language $file.FullName
  $text = [System.IO.File]::ReadAllText($file.FullName)
  if ($text.IndexOf([char]0) -ge 0) { continue }
  $lines = $text -split "`r?`n"
  $anchors = Get-Anchors -Lines $lines -Language $language
  $tags = Get-SemanticTags -Text $text -RelativePath $relative

  if ($anchors.Count -eq 0 -and $tags.Count -eq 0) { continue }

  $entry = [pscustomobject]@{
    path = $relative
    language = $language
    bytes = $file.Length
    lines = $lines.Count
    tags = @($tags)
    anchors = @($anchors)
  }
  $indexed.Add($entry)
}

$index = [pscustomobject]@{
  schema = "funesterie.semantic-file-index.v1"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  repoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
  fileCount = $indexed.Count
  files = $indexed.ToArray()
}

$jsonPath = Join-Path $runDir "semantic-index.json"
Write-Utf8File -Path $jsonPath -Content (($index | ConvertTo-Json -Depth 12) + "`n")

$md = New-Object System.Text.StringBuilder
[void]$md.AppendLine("# Semantic File Index $timestamp")
[void]$md.AppendLine("")
[void]$md.AppendLine("Repo: $RepoRoot")
[void]$md.AppendLine("Files indexed: $($indexed.Count)")
[void]$md.AppendLine("")

foreach ($file in $indexed | Sort-Object path) {
  [void]$md.AppendLine("## $($file.path)")
  [void]$md.AppendLine("")
  [void]$md.AppendLine("- Language: $($file.language)")
  [void]$md.AppendLine("- Size: $($file.bytes) bytes, $($file.lines) lines")
  if ($file.tags.Count -gt 0) {
    [void]$md.AppendLine("- Tags: $($file.tags -join ', ')")
  }
  [void]$md.AppendLine("")
  $tick = [char]96
  foreach ($anchor in ($file.anchors | Select-Object -First 80)) {
    [void]$md.AppendLine("- $tick$($file.path):$($anchor.line)$tick [$($anchor.kind)] $($anchor.name) - $($anchor.snippet)")
  }
  if ($file.anchors.Count -gt 80) {
    [void]$md.AppendLine("- ... $($file.anchors.Count - 80) more anchors omitted from Markdown; see JSON.")
  }
  [void]$md.AppendLine("")
}

$mdPath = Join-Path $runDir "semantic-index.md"
Write-Utf8File -Path $mdPath -Content $md.ToString()

Write-Host "Semantic index written to: $runDir"
Write-Host "JSON: $jsonPath"
Write-Host "MD: $mdPath"
