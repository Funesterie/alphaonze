param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("a11", "kaen44", "vivy")]
  [string]$Persona,

  [Parameter(Mandatory = $true)]
  [string[]]$Source,

  [string]$OutputRoot = "D:\agent-bus\voice\personas",
  [int]$SampleRate = 48000,
  [int]$SegmentSeconds = 12,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$audioExtensions = @(".wav", ".wave", ".mp3", ".flac", ".m4a", ".ogg", ".aac", ".wma", ".webm")
$minimumSeconds = 180
$recommendedSeconds = 600
$artifactNames = @{
  a11 = @{ model = "a11-terminator.pth"; index = "a11-terminator.index" }
  kaen44 = @{ model = "kaen44-donna.pth"; index = "kaen44-donna.index" }
  vivy = @{ model = "vivy.pth"; index = "vivy.index" }
}

function Get-CommandPath {
  param([string]$Name)
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "$Name is required. Install ffmpeg/ffprobe first."
  }
  return $command.Source
}

function Get-FileSha1 {
  param([string]$Path)
  $sha1 = [System.Security.Cryptography.SHA1]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
      $hash = $sha1.ComputeHash($stream)
      return ([BitConverter]::ToString($hash)).Replace("-", "").ToLowerInvariant()
    } finally {
      $stream.Dispose()
    }
  } finally {
    $sha1.Dispose()
  }
}

function Get-AudioDuration {
  param(
    [string]$Ffprobe,
    [string]$Path
  )
  $raw = & $Ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 $Path 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $raw) {
    return 0.0
  }
  $value = 0.0
  if ([double]::TryParse($raw.Trim(), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$value)) {
    return $value
  }
  return 0.0
}

function Resolve-AudioSources {
  param([string[]]$Items)
  $files = New-Object System.Collections.Generic.List[System.IO.FileInfo]
  foreach ($item in $Items) {
    $candidateItems = @($item)
    if ($item -like "*,*" -and -not (Test-Path -LiteralPath $item)) {
      $candidateItems = @($item -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }
    foreach ($candidateItem in $candidateItems) {
    $resolvedItems = Resolve-Path -LiteralPath $candidateItem -ErrorAction SilentlyContinue
    foreach ($resolved in $resolvedItems) {
      $info = Get-Item -LiteralPath $resolved.Path
      if ($info.PSIsContainer) {
        Get-ChildItem -LiteralPath $info.FullName -File -Recurse |
          Where-Object { $audioExtensions -contains $_.Extension.ToLowerInvariant() } |
          ForEach-Object { $files.Add($_) }
      } elseif ($audioExtensions -contains $info.Extension.ToLowerInvariant()) {
        $files.Add($info)
      }
    }
    }
  }
  return $files | Sort-Object FullName -Unique
}

function New-SafeName {
  param([System.IO.FileInfo]$File)
  $hash = (Get-FileSha1 -Path $File.FullName).Substring(0, 12)
  $stem = [IO.Path]::GetFileNameWithoutExtension($File.Name)
  $safeStem = ($stem -replace "[^A-Za-z0-9._-]", "_").Trim("_")
  if (-not $safeStem) {
    $safeStem = "audio"
  }
  return "$safeStem-$hash"
}

$ffmpeg = Get-CommandPath ffmpeg
$ffprobe = Get-CommandPath ffprobe
$sourceFiles = @(Resolve-AudioSources -Items $Source)

if ($sourceFiles.Count -eq 0) {
  throw "No audio source found for persona $Persona."
}

$personaRoot = Join-Path $OutputRoot $Persona
$rawDir = Join-Path $personaRoot "raw"
$cleanDir = Join-Path $personaRoot "clean"
$chunksDir = Join-Path $personaRoot "chunks"
$manifestPath = Join-Path $personaRoot "dataset-manifest.json"

New-Item -ItemType Directory -Force -Path $rawDir, $cleanDir, $chunksDir | Out-Null

$sources = New-Object System.Collections.Generic.List[object]
$chunks = New-Object System.Collections.Generic.List[object]

foreach ($file in $sourceFiles) {
  $safeName = New-SafeName -File $file
  $rawTarget = Join-Path $rawDir ($safeName + $file.Extension.ToLowerInvariant())
  $cleanTarget = Join-Path $cleanDir ($safeName + ".wav")
  $chunkPattern = Join-Path $chunksDir ($safeName + "-%03d.wav")

  if ($Force -or -not (Test-Path -LiteralPath $rawTarget)) {
    Copy-Item -LiteralPath $file.FullName -Destination $rawTarget -Force:$Force
  }

  if ($Force -or -not (Test-Path -LiteralPath $cleanTarget)) {
    & $ffmpeg -hide_banner -y -i $file.FullName -ac 1 -ar $SampleRate -af "highpass=f=60,lowpass=f=16000,loudnorm=I=-18:TP=-3:LRA=11" -c:a pcm_s16le $cleanTarget 2>$null
    if ($LASTEXITCODE -ne 0) {
      throw "ffmpeg failed while cleaning $($file.Name)"
    }
  }

  if ($Force) {
    Get-ChildItem -LiteralPath $chunksDir -File -Filter "$safeName-*.wav" -ErrorAction SilentlyContinue |
      Remove-Item -Force
  }

  $existingChunks = @(Get-ChildItem -LiteralPath $chunksDir -File -Filter "$safeName-*.wav" -ErrorAction SilentlyContinue)
  if ($existingChunks.Count -eq 0) {
    & $ffmpeg -hide_banner -y -i $cleanTarget -f segment -segment_time $SegmentSeconds -reset_timestamps 1 -c:a pcm_s16le $chunkPattern 2>$null
    if ($LASTEXITCODE -ne 0) {
      throw "ffmpeg failed while segmenting $($file.Name)"
    }
  }

  $sourceDuration = Get-AudioDuration -Ffprobe $ffprobe -Path $cleanTarget
  $sourceHash = Get-FileSha1 -Path $file.FullName
  $sources.Add([pscustomobject]@{
    originalName = $file.Name
    sha1 = $sourceHash
    bytes = $file.Length
    cleanedFile = [IO.Path]::GetFileName($cleanTarget)
    durationSec = [math]::Round($sourceDuration, 3)
  })

  Get-ChildItem -LiteralPath $chunksDir -File -Filter "$safeName-*.wav" |
    Sort-Object Name |
    ForEach-Object {
      $duration = Get-AudioDuration -Ffprobe $ffprobe -Path $_.FullName
      if ($duration -gt 0.25) {
        $chunks.Add([pscustomobject]@{
          file = $_.Name
          bytes = $_.Length
          durationSec = [math]::Round($duration, 3)
        })
      }
    }
}

$totalDuration = ($chunks | Measure-Object -Property durationSec -Sum).Sum
if (-not $totalDuration) {
  $totalDuration = 0
}

$manifest = [pscustomobject]@{
  schema = "funesterie.rvc-persona-dataset.v1"
  persona = $Persona
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  outputRoot = $personaRoot
  sampleRate = $SampleRate
  segmentSeconds = $SegmentSeconds
  consent = "required-before-training"
  provenance = "local-approved-voice-library-or-user-provided-source"
  sources = $sources
  chunks = $chunks
  stats = [pscustomobject]@{
    sourceCount = $sources.Count
    chunkCount = $chunks.Count
    totalDurationSec = [math]::Round([double]$totalDuration, 3)
    minimumTrainingSec = $minimumSeconds
    recommendedTrainingSec = $recommendedSeconds
    readyForSmokeTraining = ([double]$totalDuration -ge $minimumSeconds)
    readyForBetterTraining = ([double]$totalDuration -ge $recommendedSeconds)
  }
  expectedArtifacts = [pscustomobject]@{
    model = $artifactNames[$Persona].model
    index = $artifactNames[$Persona].index
  }
}

$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host "Dataset persona: $Persona"
Write-Host "Manifest: $manifestPath"
Write-Host "Sources: $($sources.Count)"
Write-Host "Chunks: $($chunks.Count)"
Write-Host "Duration: $([math]::Round([double]$totalDuration, 2)) sec"
Write-Host "Ready smoke training: $($manifest.stats.readyForSmokeTraining)"
Write-Host "Ready better training: $($manifest.stats.readyForBetterTraining)"
