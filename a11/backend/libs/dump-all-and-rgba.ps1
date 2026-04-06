param(
  [string]$Root = 'D:\funesterie\a11\a11qflushrailway',
  [string]$OutText = 'D:\funesterie\a11\qflush-code-dump.txt',
  [string]$OutRaw = 'D:\funesterie\a11\qflush-code-dump.raw',
  [string]$OutPng = 'D:\funesterie\a11\qflush-code-dump.png',
  [int]$ImageWidth = 1024,
  [int]$MaxFileSizeMB = 0  # 0 = no size limit (was 5)
)

Write-Host "=== QFLUSH DUMP START ==="
Write-Host ("Root          : " + $Root)
Write-Host ("OutText       : " + $OutText)
Write-Host ("OutRaw        : " + $OutRaw)
Write-Host ("OutPng        : " + $OutPng)
Write-Host ("ImageWidth    : " + $ImageWidth)
Write-Host ("MaxFileSizeMB : " + $MaxFileSizeMB)
Write-Host ""

if (-not (Test-Path -Path $Root)) {
  Write-Error "Root path '$Root' not found."
  exit 2
}

foreach ($p in @($OutText, $OutRaw, $OutPng)) {
  if (Test-Path $p) {
    Write-Host ("Removing previous output: " + $p)
    Remove-Item $p -Force -ErrorAction SilentlyContinue
  }
}

$utf8NoBOM = New-Object System.Text.UTF8Encoding($false)
$fs = $null
$sw = $null

$textExtensions = @(
  '.ts', '.tsx', '.js', '.cjs', '.mjs',
  '.json', '.json5', '.yml', '.yaml', '.toml', '.md',
  '.ps1', '.psm1', '.psd1',
  '.xml', '.txt', '.sh', '.bat',
  '.c', '.cpp', '.h', '.hpp',
  '.map', '.lock'
)

$excludePatterns = @(
  '\node_modules\',
  '\dist\',
  '\out\',
  '\.git\',
  '\coverage\',
  '\.vscode\',
  '\.idea\',
  '\.vs\',
  '\.qflush\cache\'
)

function Normalize-PathForMatch([string]$p) {
  return ($p -replace '/','\').ToLowerInvariant()
}

function Test-ExcludedPath([string]$fullPath) {
  $np = Normalize-PathForMatch $fullPath
  foreach ($pat in $excludePatterns) {
    if ($np -like ("*" + ($pat -replace '/','\').ToLowerInvariant() + "*")) {
      return $true
    }
  }
  return $false
}

try {
  try {
    $fs = [System.IO.File]::Open(
      $OutText,
      [System.IO.FileMode]::Create,
      [System.IO.FileAccess]::Write,
      [System.IO.FileShare]::Read
    )
    $sw = New-Object System.IO.StreamWriter($fs, $utf8NoBOM)
  } catch {
    Write-Error ("Failed to create output text stream: " + $_.Exception.Message)
    throw
  }

  $now = (Get-Date).ToString("o")
  $sw.WriteLine("qflush code dump generated: " + $now)
  $sw.WriteLine()

  Write-Host ("Scanning files under: " + $Root)
  # Include only desired paths/files to reduce dump size (keep important sources and metadata)
  $filesAll = Get-ChildItem -Path $Root -Recurse -File -Force -ErrorAction SilentlyContinue | Sort-Object FullName

  $files = foreach ($f in $filesAll) {
    $p = Normalize-PathForMatch $f.FullName
    $ext = [System.IO.Path]::GetExtension($f.FullName).ToLowerInvariant()

    # Keep rules (whitelist): src/**, package.json & locks, scripts/*.ps1, .github/workflows/**, .qflush/**/*.json, cortex/** or packets
    if ($p -like "*\src\*") { $f; continue }
    if ($p -like "*\.github\workflows\*") { $f; continue }
    if ($p -like "*\\.qflush\\*" -and $ext -eq '.json') { $f; continue }
    if ($p -like "*\cortex\*" -or $p -like "*\packets\*") { $f; continue }
    if ($p -like "*\scripts\*" -and $ext -eq '.ps1') { $f; continue }
    $name = [System.IO.Path]::GetFileName($f.FullName).ToLowerInvariant()
    if ($name -in @('package.json','package-lock.json','yarn.lock','pnpm-lock.yaml')) { $f; continue }

    # Otherwise skip (exclude logs, snapshots, vitest output, tsbuildinfo, maps, node cache, png, assets, binaries)
    continue
  }

  Write-Host ("Found " + $files.Count + " files after whitelist filter.")
  Write-Host ""

  foreach ($f in $files) {
    try {
      $rel = $f.FullName
      if ($rel.StartsWith($Root, [System.StringComparison]::InvariantCultureIgnoreCase)) {
        $rel = $rel.Substring($Root.Length).TrimStart('\','/')
      }

      # Skip PNG files: we don't include existing PNGs in the text dump
      $ext = [System.IO.Path]::GetExtension($f.FullName).ToLowerInvariant()
      if ($ext -eq '.png') {
        Write-Host ("Skipping PNG file from text dump: " + $rel)
        continue
      }

      Write-Host ("Dumping file: " + $rel)

      $sep = '=' * 28
      $sw.WriteLine($sep)
      $sw.WriteLine("FILE: " + $rel)
      $sw.WriteLine($sep)
      $sw.WriteLine($sep)

      $isDts = $f.Name -match '\.d\.ts$'
      $isTextExt = $isDts -or ($textExtensions -contains $ext)

      if ($isTextExt) {
        $ln = 1
        $readOK = $false
        try {
          foreach ($line in Get-Content -LiteralPath $f.FullName -Encoding UTF8 -ErrorAction Stop) {
            $prefix = $ln.ToString().PadLeft(6) + ": "
            $sw.WriteLine($prefix + $line)
            $ln++
          }
          $readOK = $true
        } catch {
          try {
            foreach ($line in Get-Content -LiteralPath $f.FullName -ErrorAction Stop) {
              $prefix = $ln.ToString().PadLeft(6) + ": "
              $sw.WriteLine($prefix + $line)
              $ln++
            }
            $readOK = $true
          } catch {
            $readOK = $false
          }
        }

        if (-not $readOK) {
          # replaced full binary dump with a short marker to keep dump small
          $sw.WriteLine("[BINARY FILE SKIPPED - " + $f.Length + " bytes] (text read failed)")
        }
      } else {
        # skip binary file contents to reduce dump size
        $sw.WriteLine("[BINARY FILE SKIPPED - " + $f.Length + " bytes]")
      }

      $sw.WriteLine()
      $sw.WriteLine()
      $sw.Flush()
    } catch {
      $err = $_.Exception.Message
      if ($sw -ne $null) {
        $sw.WriteLine("[ERROR] Failed to include file: " + $f.FullName)
        $sw.WriteLine("Reason: " + $err)
        $sw.WriteLine()
        $sw.WriteLine()
        $sw.Flush()
      }
      Write-Warning ("Failed to dump file: " + $f.FullName + " -> " + $err)
    }
  }

  $completed = (Get-Date -Format o)
  $sw.WriteLine("Completed: " + $completed)
  $sw.Flush()
  Write-Host ("Text dump completed at: " + $completed)
}
finally {
  if ($sw -ne $null) { $sw.Close() }
  if ($fs -ne $null) { $fs.Close() }
}

Write-Host ""
Write-Host "=== BUILD OC8-BROTLI PNG FROM TEXT DUMP ==="

try {
  if (-not (Test-Path $OutText)) {
    Write-Warning ("Text dump not found at " + $OutText + ", aborting PNG generation.")
    return
  }

  # Read text dump bytes (UTF8 no BOM)
  $textBytes = [System.IO.File]::ReadAllBytes($OutText)

  # Compress with Brotli
  $msIn = New-Object System.IO.MemoryStream
  $msIn.Write($textBytes, 0, $textBytes.Length)
  $msIn.Seek(0, 'Begin') | Out-Null

  $msOut = New-Object System.IO.MemoryStream
  $brotli = New-Object System.IO.Compression.BrotliStream($msOut, [System.IO.Compression.CompressionLevel]::Optimal, $true)
  $msIn.CopyTo($brotli)
  $brotli.Close()
  $compressed = $msOut.ToArray()
  $msIn.Close()
  $msOut.Close()

  # Build OC8 header: ASCII "OC8" + version byte (1) + 4 bytes little-endian payload length
  $hdr = [System.Text.Encoding]::ASCII.GetBytes("OC8")
  $ver = [byte]1
  $lenBytes = [System.BitConverter]::GetBytes([int]$compressed.Length)
  if (-not [BitConverter]::IsLittleEndian) { [Array]::Reverse($lenBytes) }

  $payload = New-Object System.Byte[] ($hdr.Length + 1 + $lenBytes.Length + $compressed.Length)
  [Array]::Copy($hdr, 0, $payload, 0, $hdr.Length)
  $payload[$hdr.Length] = $ver
  [Array]::Copy($lenBytes, 0, $payload, $hdr.Length + 1, $lenBytes.Length)
  [Array]::Copy($compressed, 0, $payload, $hdr.Length + 1 + $lenBytes.Length, $compressed.Length)

  # Map payload bytes into RGBA pixels (4 bytes per pixel)
  $pad = (4 - ($payload.Length % 4)) % 4
  if ($pad -gt 0) {
    $payload = $payload + (New-Object byte[] $pad)
  }

  $pixelCount = [int]($payload.Length / 4)
  $width = [int]$ImageWidth
  if ($width -le 0) { $width = 1024 }
  $height = [int][Math]::Ceiling($pixelCount / $width)

  Write-Host ("OC8 payload bytes: " + $payload.Length + " -> image " + $width + "x" + $height + " (pixels=" + $pixelCount + ")")

  # Create a single PNG containing full OC8 payload
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $rect = New-Object System.Drawing.Rectangle(0,0,$width,$height)
    $bmpData = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, $bmp.PixelFormat)
    $stride = $bmpData.Stride
    $ptr = $bmpData.Scan0

    $totalBytes = $stride * $height
    $raw = New-Object byte[] $totalBytes
    for ($i = 0; $i -lt $pixelCount; $i++) {
      $srcIndex = $i * 4
      $dstIndex = $i * 4
      $r = $payload[$srcIndex + 0]
      $g = $payload[$srcIndex + 1]
      $b = $payload[$srcIndex + 2]
      $a = $payload[$srcIndex + 3]
      $raw[$dstIndex + 0] = $b
      $raw[$dstIndex + 1] = $g
      $raw[$dstIndex + 2] = $r
      $raw[$dstIndex + 3] = $a
    }

    for ($row = 0; $row -lt $height; $row++) {
      $srcOff = $row * $width * 4
      $dstOff = $row * $stride
      [System.Buffer]::BlockCopy($raw, $srcOff, $raw, $dstOff, $width * 4)
    }

    [System.Runtime.InteropServices.Marshal]::Copy($raw, 0, $ptr, $totalBytes)
    $bmp.UnlockBits($bmpData)

    $bmp.Save($OutPng, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host ("✅ OC8-Brotli PNG written to: " + $OutPng + " (" + $width + "x" + $height + ")")
  } finally {
    if ($bmp -ne $null) { $bmp.Dispose() }
  }
} catch {
  Write-Warning ("Failed to create OC8 PNG: " + $_.Exception.Message)
 }

 Write-Host ("Text dump written to: " + $OutText)
 Write-Host "=== QFLUSH DUMP END ==="
