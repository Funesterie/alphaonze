# Prime Spiral Audio Morph - Research Handoff

Status: experimental research notes, not production voice routing.

This captures the formulas from Djeff's prime-number screenshots and turns
them into a safe implementation target for Codex/Claude. Treat this as a DSP
control system, not as a proof of the Riemann hypothesis.

## Captured Model

Core radius:

```text
z0 = phi - j*i
R = sqrt(phi^2 + j^2)
theta0 = arg(phi - j*i)
```

Generative spiral:

```text
z_n = n(phi - j*i)e^(i log n)
r(n) = nR
theta(n) = log n + theta0
```

Symmetric orientations:

```text
z_n = n(+/-phi +/- j*i)e^(i log n)
```

OP cross around M:

```text
M, -M, +iM, -iM
op_sym(-M/M, +M/M) = 1
op_sym(-iM/M, +iM/M) = 1
complete local alphabet = { i, -i, -1, 1, M }
```

Prime-dimension operation ladder:

```text
1d = sqrt(-i)
2d = root + inversion layer
3d = exp/log layer
5d = nested ln/log layer
7d = Sym(1d, 2d, 3d, 5d) = 1
```

Modular projection:

```text
P(n) = |n(+/-phi +/- j)| mod 1
```

Gap law:

```text
delta_theta = log(n + 1) - log(n)
delta_theta ~= 1/n for large n
```

Resonance condition:

```text
theta(n) = 2*pi*k
log n + theta0 = 2*pi*k
n = exp(2*pi*k - theta0)
```

Spectral note:

```text
40.0005*pi / (2*pi) = 20.00025 Hz
```

That lands almost exactly at the lower human hearing threshold. Use it as a
base modulation/resonance constant, not as a hard mathematical claim.

## Implementation Added

Python module:

```text
a11/backend/apps/voice-module/app/prime_spiral_morph.py
```

Tests:

```text
a11/backend/apps/voice-module/tests/test_prime_spiral_morph.py
a11/backend/apps/voice-module/tests/test_prime_spiral_endpoint.py
a11/backend/apps/voice-module/tests/test_prime_spiral_wav_script.py
```

Research endpoint:

```text
POST /research/prime-spiral/control
```

What it exposes:

- `spiral_point(n)`: complex point from the logarithmic spiral.
- `projection_linear(n)`: diagonal modular network value.
- `projection_radius(n)`: radius modulo 1.
- `phase_gap(n)`: local gap law.
- `resonance_index(k)`: resonance position.
- `riemann_like_chirp(k)`: empirical sqrt chirp using `40.0005*pi`.
- `mode_signal(n, mode=...)`: normalized control signal for one formula family.
- `op_symmetry_score(n)`: four-orientation sign coherence.
- `op_closure_score(n)`: multi-operation imaginary closure; code form of
  "-i^2 = 1 across exp/log/ln/inversion/conjugation layers".
- `op_algebra_score(n)`: OP cross closure around `M`; code form of the
  screenshots where opposed real/imaginary ratios balance back to `1`.
- `prime_dimension_score(n)`: bounded `1,2,3,5,7` operation ladder control.
- `control_curve(length)`: bounded linear gain curve for streaming DSP tests.
- `spectral_weights(bins)`: small EQ/formant weights for later experiments.
- Endpoint response fields: `curve`, `weights`, optional `features`, and
  `guardrails`. It is marked `researchOnly: true`.

Available modes:

```text
phi_j_spiral
riemann_chirp
modular_grid
gap_law
resonance
op_symmetry
op_closure
op_algebra
prime_dimensions
hybrid
```

## Audio Usage Plan

Use the module only as a control signal generator at first:

1. Generate `control_curve()` per audio chunk.
2. Apply it as a very small gain/formant modulation, for example +/-3 dB max.
3. Use `spectral_weights()` as a per-bin EQ envelope after STFT/WORLD analysis.
4. Keep dry/wet mix below 20% until artifacts are measured.
5. Never replace the TTS/voice provider path before WAV roundtrip tests pass.

Implemented first integration point:

```text
voice-module Python service -> optional research endpoint
POST /research/prime-spiral/control
```

Input:

```json
{ "length": 512, "phi": 1.618033988749895, "j": 1.0, "orientation": "right" }
```

Output:

```json
{ "curve": [1.0, 1.03, 0.98] }
```

Local WAV A/B script:

```powershell
python .\a11\backend\apps\voice-module\scripts\apply_prime_spiral_morph.py `
  input.wav `
  output-prime-spiral.wav `
  --mode op_algebra `
  --dry-wet 0.18
```

## OCR / Corpus Instructions

The local folders currently contain:

```text
C:\Users\Djeff\Downloads\AmazonPhotos
E:\maths
```

Before trusting the 529-photo Amazon share, prefer local copies. Do not commit
private screenshots by default. Extract formulas into text notes only.

If OCR is needed, install Tesseract first, then run a bounded extractor into a
local ignored folder:

```powershell
.\scripts\research\Extract-PrimeSpiralOcr.ps1 `
  -InputDir "C:\Users\Djeff\Downloads\AmazonPhotos" `
  -OutputDir "D:\projets\funesterie\.codex-tmp\prime-spiral-ocr"
```

Image inventory:

```powershell
.\scripts\research\Build-PrimeSpiralImageInventory.ps1
```

Latest local inventory observed 877 files: 846 PNG, 26 JPEG, 5 HEIC.

## Guardrails

- Do not claim this proves Riemann or generates primes.
- Do not wire it into production TTS without a feature flag.
- Do not publish user screenshots or raw OCR containing unrelated private data.
- Keep all modulation bounded and reversible.
- Add WAV before/after measurements before any merge into the voice route.
