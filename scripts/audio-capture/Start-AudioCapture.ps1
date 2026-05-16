<#
.SYNOPSIS
  Funesterie Audio Capture - WASAPI Loopback + Micro G935
  Capture audio sortie (loopback) et micro en chunks WAV pour Vivy/STT.
.PARAMETER ListDevices
  Liste les devices audio disponibles via ffmpeg
.PARAMETER MicOnly
  Capture uniquement le micro
.PARAMETER LoopbackOnly
  Capture uniquement le loopback
#>
param(
    [string]$FfmpegPath = "D:\projets\Flowframes\FlowframesData\pkgs\av\ffmpeg.exe",
    [string]$OutputDir = "D:\agent-bus\audio-capture\chunks",
    [string]$ProfilePath = "D:\agent-bus\qflush-source-profile.json",
    [string]$MicDevice,
    [string]$LoopbackDevice,
    [int]$ChunkSeconds = 5,
    [switch]$MicOnly,
    [switch]$LoopbackOnly,
    [switch]$ListDevices,
    [switch]$Json
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null }

if ($ListDevices) {
    $devices = & $FfmpegPath -list_devices true -f dshow -i dummy 2>&1
    if ($Json) {
        [pscustomobject]@{
            ok = $true
            ffmpegPath = $FfmpegPath
            raw = ($devices -join "`n")
        } | ConvertTo-Json -Depth 4
    } else {
        Write-Host "`n=== Devices audio disponibles ===" -ForegroundColor Cyan
        $devices | ForEach-Object { Write-Host "  $_" }
    }
    return
}

function Get-ProfileAudio {
    if (-not (Test-Path -LiteralPath $ProfilePath)) { return $null }
    try {
        $profile = Get-Content -Raw -LiteralPath $ProfilePath | ConvertFrom-Json
        return $profile.audio
    } catch {
        return $null
    }
}

function Get-LoopbackDevice {
    if ($LoopbackDevice) { return $LoopbackDevice }
    $profileAudio = Get-ProfileAudio
    if ($profileAudio -and $profileAudio.loopbackDevice) { return [string]$profileAudio.loopbackDevice }
    $output = & $FfmpegPath -list_devices true -f dshow -i dummy 2>&1
    foreach ($line in $output) {
        if ($line -match '"(virtual-audio-capturer)"') { return $Matches[1] }
        if ($line -match '"(Mixage st|Stereo Mix|CABLE Output)"') { return $Matches[1] }
    }
    return "Mixage stereo (Realtek(R) Audio)"
}

function Get-MicDevice {
    if ($MicDevice) { return $MicDevice }
    $profileAudio = Get-ProfileAudio
    if ($profileAudio -and $profileAudio.micDevice) { return [string]$profileAudio.micDevice }
    $output = & $FfmpegPath -list_devices true -f dshow -i dummy 2>&1
    foreach ($line in $output) {
        if ($line -match '"(Microphone.*G935|Microphone.*G933|Microphone.*Logitech)"') { return $Matches[1] }
    }
    return "Microphone (2- Logitech G935/G933s Gaming Headset)"
}

function Write-AudioCaptureStatus {
    param([object[]]$Processes, [string]$Loopback, [string]$Mic)
    $statusPath = Join-Path (Split-Path -Parent $OutputDir) "audio-capture-status.json"
    $status = [pscustomobject]@{
        schema = "funesterie.audio-capture-status.v1"
        updatedAt = (Get-Date).ToUniversalTime().ToString("o")
        outputDir = $OutputDir
        profilePath = $ProfilePath
        loopbackDevice = $Loopback
        micDevice = $Mic
        chunkSeconds = $ChunkSeconds
        pids = @($Processes | Where-Object { $_ } | ForEach-Object { $_.Id })
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $statusPath) | Out-Null
    $status | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statusPath -Encoding UTF8
}

function Start-LoopbackCapture {
    $device = Get-LoopbackDevice
    Write-Host "[LOOPBACK] Device: $device" -ForegroundColor Green
    $dir = "$OutputDir\loopback"
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $ts = Get-Date -Format "yyyyMMdd_HHmmss"
    $pattern = "$dir\loopback_${ts}_%03d.wav"
    $ffArgs = "-f dshow -i `"audio=$device`" -ac 2 -ar 16000 -acodec pcm_s16le -f segment -segment_time $ChunkSeconds -reset_timestamps 1 -y `"$pattern`""
    return Start-Process -FilePath $FfmpegPath -ArgumentList $ffArgs -PassThru -WindowStyle Hidden
}

function Start-MicCapture {
    $device = Get-MicDevice
    Write-Host "[MICRO] Device: $device" -ForegroundColor Cyan
    $dir = "$OutputDir\mic"
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $ts = Get-Date -Format "yyyyMMdd_HHmmss"
    $pattern = "$dir\mic_${ts}_%03d.wav"
    $ffArgs = "-f dshow -i `"audio=$device`" -ac 1 -ar 16000 -acodec pcm_s16le -f segment -segment_time $ChunkSeconds -reset_timestamps 1 -y `"$pattern`""
    return Start-Process -FilePath $FfmpegPath -ArgumentList $ffArgs -PassThru -WindowStyle Hidden
}

Write-Host @"

  +==========================================+
  |   FUNESTERIE AUDIO CAPTURE v1.0.0       |
  |   Loopback + Micro -> Vivy/STT          |
  +==========================================+

"@ -ForegroundColor Magenta

$procs = @()
try {
    $selectedLoopback = if (-not $MicOnly) { Get-LoopbackDevice } else { $null }
    $selectedMic = if (-not $LoopbackOnly) { Get-MicDevice } else { $null }
    if (-not $MicOnly) { $loopProc = Start-LoopbackCapture; $procs += $loopProc }
    if (-not $LoopbackOnly) { $micProc = Start-MicCapture; $procs += $micProc }
    Write-AudioCaptureStatus -Processes $procs -Loopback $selectedLoopback -Mic $selectedMic
    
    Write-Host "[OK] Capture demarree. Ctrl+C pour arreter." -ForegroundColor Green
    Write-Host "[INFO] Chunks WAV: $OutputDir" -ForegroundColor Gray
    
    $lastDefault = $null
    while ($true) {
        Start-Sleep -Seconds 10
        # Nettoyer vieux chunks > 2 min
        $cutoff = (Get-Date).AddMinutes(-2)
        Get-ChildItem $OutputDir -Filter "*.wav" -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -lt $cutoff } | Remove-Item -Force -ErrorAction SilentlyContinue
        # Restart si mort
        if ($loopProc -and $loopProc.HasExited) {
            Write-Host "[RESTART] Loopback..." -ForegroundColor Yellow
            $loopProc = Start-LoopbackCapture
            $procs = @($loopProc, $micProc) | Where-Object { $_ }
            Write-AudioCaptureStatus -Processes $procs -Loopback (Get-LoopbackDevice) -Mic (Get-MicDevice)
        }
        if ($micProc -and $micProc.HasExited) {
            Write-Host "[RESTART] Micro..." -ForegroundColor Yellow
            $micProc = Start-MicCapture
            $procs = @($loopProc, $micProc) | Where-Object { $_ }
            Write-AudioCaptureStatus -Processes $procs -Loopback (Get-LoopbackDevice) -Mic (Get-MicDevice)
        }
        # Detect device change
        $cur = (Get-CimInstance Win32_SoundDevice | Where-Object { $_.Status -eq "OK" } | Select-Object -First 1).Name
        if ($lastDefault -and $cur -ne $lastDefault) {
            Write-Host "[DEVICE CHANGE] $lastDefault -> $cur" -ForegroundColor Yellow
            if ($loopProc -and -not $loopProc.HasExited) { Stop-Process -Id $loopProc.Id -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 200 }
            $loopProc = Start-LoopbackCapture
            $procs = @($loopProc, $micProc) | Where-Object { $_ }
            Write-AudioCaptureStatus -Processes $procs -Loopback (Get-LoopbackDevice) -Mic (Get-MicDevice)
        }
        $lastDefault = $cur
    }
} finally {
    Write-Host "`n[STOP] Arret..." -ForegroundColor Red
    foreach ($p in $procs) { if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
    Write-Host "[DONE]" -ForegroundColor Green
}
