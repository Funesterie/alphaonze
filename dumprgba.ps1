param(
    [string]$Root = "D:\A11",
    [string]$OutText = "D:\A11-dump.txt",
    [string]$OutPng = "D:\A11-dump-oc8.png",
    [int]$ImageWidth = 1024,
    [int]$MaxHeight = 4096,

    # Exclusions (par défaut : éviter les énormes dossiers inutiles)
    [string[]]$ExcludeDirs = @(
        "node_modules", ".git", ".vs", ".vscode",
        "dist", "build", "out", ".next", ".nuxt",
        "bin", "obj", ".cache", ".turbo",
        ".qflush", ".qflash", "logs", "log", "tmp", "temp"
    ),

    # Filtre extensions (vide = tout prendre)
    [string[]]$IncludeExtensions = @(
        ".js",".cjs",".mjs",".ts",".tsx",".json",".yml",".yaml",".md",
        ".ps1",".cmd",".bat",
        ".cs",".csproj",".sln",".props",".targets",
        ".html",".css",".scss",
        ".env",".env.example",".gitignore",".npmrc"
    )
)

Write-Host "=== A11 DUMP START ==="
Write-Host "Root: $Root"

if (-not (Test-Path $Root)) {
    throw "Root path does not exist: $Root"
}

# Remove old outputs
foreach ($p in @($OutText)) {
    if (Test-Path $p) { Remove-Item $p -Force -ErrorAction SilentlyContinue }
}
$pngFiles = Get-ChildItem -Path (Split-Path $OutPng) -Filter "A11-dump-oc8-*.png" -ErrorAction SilentlyContinue
foreach ($png in $pngFiles) { Remove-Item $png.FullName -Force -ErrorAction SilentlyContinue }

function Should-ExcludePath([string]$fullPath) {
    foreach ($d in $ExcludeDirs) {
        $escaped = [Regex]::Escape($d)
        if ($fullPath -match "\\$escaped(\\|$)") { return $true }
    }
    return $false
}

# Collect files (filtered)
$all = Get-ChildItem -Path $Root -Recurse -File -Force -ErrorAction SilentlyContinue
$files = @()

foreach ($f in $all) {
    if (Should-ExcludePath $f.FullName) { continue }

    if ($IncludeExtensions.Count -gt 0) {
        $ext = [System.IO.Path]::GetExtension($f.Name)
        # cas spécial : fichiers sans extension (.env, .gitignore, etc.)
        if ([string]::IsNullOrWhiteSpace($ext)) {
            if ($IncludeExtensions -notcontains $f.Name) { continue }
        } else {
            if ($IncludeExtensions -notcontains $ext) { continue }
        }
    }

    $files += $f
}

$files = $files | Sort-Object FullName
Write-Host "Found $($files.Count) files"

# Concaténation textuelle
$buffer = New-Object System.Collections.Generic.List[string]
foreach ($file in $files) {
    try {
        $buffer.Add("`n=== FILE: $($file.FullName) ===`n")
        # UTF8 safe read; fallback raw if needed
        try {
            $buffer.Add((Get-Content $file.FullName -Raw -ErrorAction Stop))
        } catch {
            $buffer.Add((Get-Content $file.FullName -ErrorAction Stop) -join "`n")
        }
    } catch {
        $buffer.Add("`n=== FILE: $($file.FullName) ===`n[READ ERROR] $_`n")
        Write-Host "Error reading $($file.FullName): $_"
    }
}
Set-Content -Path $OutText -Value $buffer -Encoding UTF8
Write-Host "Text dump written to: $OutText"

# Lecture des bytes du dump
$textBytes = [System.IO.File]::ReadAllBytes($OutText)

# Compression Gzip
$msIn = New-Object System.IO.MemoryStream
$msIn.Write($textBytes, 0, $textBytes.Length)
$msIn.Seek(0, 'Begin') | Out-Null
$msOut = New-Object System.IO.MemoryStream
$gzip = New-Object System.IO.Compression.GzipStream($msOut, [System.IO.Compression.CompressionLevel]::Optimal)
$msIn.CopyTo($gzip)
$gzip.Close()
$compressed = $msOut.ToArray()
$msIn.Close()
$msOut.Close()

# Calcul SHA-256 du payload compressé
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$hash = $sha256.ComputeHash($compressed)

# OC8 header (avec hash)
$hdr = [System.Text.Encoding]::ASCII.GetBytes("OC8")
$ver = [byte]1
$lenBytes = [System.BitConverter]::GetBytes([int]$compressed.Length)
if (-not [BitConverter]::IsLittleEndian) { [Array]::Reverse($lenBytes) }

# payload = hdr(3) + ver(1) + len(4) + sha256(32) + compressed
$payload = New-Object System.Byte[] ($hdr.Length + 1 + $lenBytes.Length + $hash.Length + $compressed.Length)
[int]$offset = 0
[Array]::Copy($hdr, 0, $payload, $offset, $hdr.Length); $offset += $hdr.Length
$payload[$offset] = $ver; $offset += 1
[Array]::Copy($lenBytes, 0, $payload, $offset, $lenBytes.Length); $offset += $lenBytes.Length
[Array]::Copy($hash, 0, $payload, $offset, $hash.Length); $offset += $hash.Length
[Array]::Copy($compressed, 0, $payload, $offset, $compressed.Length)

# Chunks 128 Mo
$chunkSize = 134217728
$totalLength = $payload.Length
$chunkCount = [Math]::Ceiling($totalLength / $chunkSize)

Add-Type -AssemblyName System.Drawing

for ($i = 0; $i -lt $chunkCount; $i++) {
    $start = $i * $chunkSize
    $end = [Math]::Min($start + $chunkSize, $totalLength)
    if ($start -ge $end) { break }
    $length = $end - $start

    # évite l’opérateur .. qui peut exploser en mémoire sur gros tableaux
    $chunk = New-Object byte[] $length
    [System.Buffer]::BlockCopy($payload, $start, $chunk, 0, $length)

    # Padding 4 octets
    $pad = (4 - ($chunk.Length % 4)) % 4
    if ($pad -gt 0) {
        $chunkPadded = New-Object byte[] ($chunk.Length + $pad)
        [Array]::Copy($chunk, $chunkPadded, $chunk.Length)
        $chunk = $chunkPadded
    }

    $pixelCount = [int]($chunk.Length / 4)
    $width = [int]$ImageWidth
    $height = [int][Math]::Ceiling($pixelCount / $width)
    if ($height -gt $MaxHeight) {
        $height = $MaxHeight
        $width = [int][Math]::Ceiling($pixelCount / $height)
    }

    Write-Host ("PNG $($i+1): " + $width + "x" + $height + " (pixels=" + $pixelCount + ", bytes=" + $chunk.Length + ")")

    $bmp = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $rect = New-Object System.Drawing.Rectangle(0,0,$width,$height)
        $bmpData = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, $bmp.PixelFormat)
        $stride = $bmpData.Stride
        $ptr = $bmpData.Scan0
        $totalBytes = $stride * $height
        $raw = New-Object byte[] $totalBytes

        # Copie RGBA -> BGRA
        for ($j = 0; $j -lt $pixelCount; $j++) {
            $srcIndex = $j * 4
            $dstIndex = $j * 4
            $r = $chunk[$srcIndex + 0]
            $g = $chunk[$srcIndex + 1]
            $b = $chunk[$srcIndex + 2]
            $a = $chunk[$srcIndex + 3]
            $raw[$dstIndex + 0] = $b
            $raw[$dstIndex + 1] = $g
            $raw[$dstIndex + 2] = $r
            $raw[$dstIndex + 3] = $a
        }

        # Stride
        for ($row = 0; $row -lt $height; $row++) {
            $srcOff = $row * $width * 4
            $dstOff = $row * $stride
            [System.Buffer]::BlockCopy($raw, $srcOff, $raw, $dstOff, $width * 4)
        }

        [System.Runtime.InteropServices.Marshal]::Copy($raw, 0, $ptr, $totalBytes)
        $bmp.UnlockBits($bmpData)

        $outPngFile = "{0}-{1}.png" -f ($OutPng -replace ".png$", ""), ($i+1)
        $bmp.Save($outPngFile, [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Host ("✅ PNG written to: " + $outPngFile + " (" + $width + "x" + $height + ")")
    } finally {
        if ($bmp -ne $null) { $bmp.Dispose() }
    }
}

Write-Host "=== A11 DUMP END ==="
