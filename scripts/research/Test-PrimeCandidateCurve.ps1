param(
  [int]$Limit = 10000,
  [double]$Mg = 0.3695,
  [double]$Pivot = 0.292,
  [double]$Period = 40.0005,
  [int]$Top = 50,
  [string]$OutputPath = "D:\projets\funesterie\.codex-tmp\prime-candidate-curve-test.json"
)

$ErrorActionPreference = "Stop"

if ($Limit -lt 10) {
  throw "Limit must be >= 10"
}

function Get-IsPrimeTable {
  param([int]$N)

  $isPrime = New-Object bool[] ($N + 1)
  if ($N -ge 2) {
    for ($i = 2; $i -le $N; $i++) {
      $isPrime[$i] = $true
    }

    for ($p = 2; $p * $p -le $N; $p++) {
      if ($isPrime[$p]) {
        for ($m = $p * $p; $m -le $N; $m += $p) {
          $isPrime[$m] = $false
        }
      }
    }
  }
  return $isPrime
}

function Get-MValue {
  param(
    [int]$N,
    [double]$Mg,
    [double]$Pivot,
    [double]$Period
  )

  $theta = 2.0 * [Math]::PI * $N / $Period
  return $Pivot + $Mg * [Math]::Sin($theta)
}

$isPrime = Get-IsPrimeTable -N $Limit
$scores = New-Object double[] ($Limit + 1)

for ($n = 2; $n -lt $Limit; $n++) {
  $theta = 2.0 * [Math]::PI * $n / $Period
  $mPrev = Get-MValue -N ($n - 1) -Mg $Mg -Pivot $Pivot -Period $Period
  $m = Get-MValue -N $n -Mg $Mg -Pivot $Pivot -Period $Period
  $mNext = Get-MValue -N ($n + 1) -Mg $Mg -Pivot $Pivot -Period $Period

  $b = [Math]::Abs($m - $mPrev) + [Math]::Abs($mNext - $m)
  $r = [Math]::Abs([Math]::Cos($theta) - $Pivot)
  $scores[$n] = $b / ($r + $Mg)
}

$candidates = @()
for ($n = 3; $n -lt ($Limit - 1); $n++) {
  if ($scores[$n] -gt $scores[$n - 1] -and $scores[$n] -gt $scores[$n + 1]) {
    $candidates += [pscustomobject]@{
      n = $n
      score = $scores[$n]
      isPrime = $isPrime[$n]
    }
  }
}

$primeCount = 0
for ($n = 2; $n -le $Limit; $n++) {
  if ($isPrime[$n]) { $primeCount++ }
}

$candidatePrimeCount = @($candidates | Where-Object IsPrime).Count
$candidateCount = @($candidates).Count

$topCandidates = $candidates |
  Sort-Object Score -Descending |
  Select-Object -First $Top

$topPrimeCount = @($topCandidates | Where-Object IsPrime).Count

$summary = [pscustomobject]@{
  schema = "funesterie.prime-candidate-curve-test.v1"
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  formula = "theta(n)=2*pi*n/Period; M(n)=Pivot+Mg*sin(theta); S(n)=B(n)/(R(n)+Mg)"
  source = "docs/research/prime_spiral/FORMULA_REGISTRY_2026-05-28.md#c1---prime-candidate-curve"
  parameters = [pscustomobject]@{
    limit = $Limit
    mg = $Mg
    pivot = $Pivot
    period = $Period
    top = $Top
  }
  counts = [pscustomobject]@{
    primes = $primeCount
    candidates = $candidateCount
    candidatePrimes = $candidatePrimeCount
    topCandidates = @($topCandidates).Count
    topCandidatePrimes = $topPrimeCount
  }
  metrics = [pscustomobject]@{
    localMaxPrecision = if ($candidateCount) { $candidatePrimeCount / $candidateCount } else { 0 }
    localMaxRecall = if ($primeCount) { $candidatePrimeCount / $primeCount } else { 0 }
    topPrecision = if (@($topCandidates).Count) { $topPrimeCount / @($topCandidates).Count } else { 0 }
  }
  topCandidates = $topCandidates
}

$outDir = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutputPath -Encoding UTF8

Write-Host "Prime candidate curve test"
Write-Host "  limit             : $Limit"
Write-Host "  primes            : $primeCount"
Write-Host "  local maxima      : $candidateCount"
Write-Host "  maxima prime hits : $candidatePrimeCount"
Write-Host ("  precision         : {0:P2}" -f $summary.metrics.localMaxPrecision)
Write-Host ("  recall            : {0:P2}" -f $summary.metrics.localMaxRecall)
Write-Host ("  top precision     : {0:P2}" -f $summary.metrics.topPrecision)
Write-Host "  output            : $OutputPath"
