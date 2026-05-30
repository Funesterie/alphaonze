# Prime Spiral Research Plan

Status: active research scaffold.

Goal: develop Djeff's prime-number / complex-spiral ideas into safe,
testable audio and visualization experiments.

## Current Families

1. `phi_j_spiral`
   - Core formula: `z_n = n(phi - j*i)e^(i log n)`.
   - Good for smooth logarithmic phase/radius control.

2. `modular_grid`
   - Projection: `P(n) = |n(+/-phi +/- j)| mod 1`.
   - Good for diagonal band / sieve-like control curves.

3. `gap_law`
   - `delta_theta = log(n + 1) - log(n) ~= 1/n`.
   - Good for decreasing micro-motion over time.

4. `resonance`
   - `log n + theta0 = 2*pi*k`.
   - Good for peak detection and "special positions".

5. `riemann_chirp`
   - Empirical fit: `t_k ~= sqrt(40.0005*pi*k) * 1.265`.
   - Good for chirp-like spectral motion.

6. `op_symmetry`
   - Compute all four orientations: `+phi +j`, `+phi -j`, `-phi +j`, `-phi -j`.
   - Score tends to 1 when all orientations cohere.
   - This is only sign/orientation coherence.

7. `op_closure`
   - Multi-operation closure across imaginary operations.
   - Encodes Djeff's stronger idea: `-i^2 = 1` echoes through exp, log/ln,
     inversion, conjugation, normalization, and other operation levels.
   - Score tends to 1 when the operation ladder balances back to identity.

8. `op_algebra`
   - Captures the cross around `M`: `+M`, `-M`, `+iM`, `-iM`.
   - Uses `op_sym` where opposed ratios close back to identity:
     `op_sym(-M/M, +M/M) = 1` and
     `op_sym(-iM/M, +iM/M) = 1`.
   - Tracks the symbolic alphabet from the screenshots:
     `{ i, -i, -1, 1, M }`.

9. `prime_dimensions`
   - Encodes the prime operation ladder `1, 2, 3, 5, 7`.
   - Interpretation:
     `1 -> imaginary root`,
     `2 -> root + inversion`,
     `3 -> exp/log`,
     `5 -> nested ln/log`,
     `7 -> global symmetry`.
   - Values are normalized after each operation so the result remains usable
     as a bounded DSP control signal.

10. `hybrid`
   - Average of the stable normalized families above.

## First Falsification

The first literal prime-candidate formula from the corpus was tested:

```text
theta(n) = 2*pi*n / 40.0005
M(n) = 0.292 + mg*sin(theta(n))
S(n) = B(n) / (R(n) + mg)
```

Using local maxima of `S(n)` as prime candidates gives 0 prime hits under
`n <= 10000`. The curve is therefore kept as an audio/visual control signal,
not a primality detector.

## Development Stages

Stage A - Corpus
- Inventory local folders without publishing private images.
- OCR only into ignored local folders.
- Extract formulas into markdown manually reviewed by Djeff.
- Build a relation matrix: observations x operations.
- Classify links as observed, inferred, invented, or falsified.
- Run the inverse problem too: when a link is known, search which screenshots,
  constants, or operator paths could have produced it.

Stage B - Audio A/B
- Use `apply_prime_spiral_morph.py` on short WAV files.
- Keep dry/wet <= 20%.
- Compare `hybrid`, `op_symmetry`, `riemann_chirp`, and `modular_grid`.

Stage C - Spectral DSP
- Replace sample gain modulation with STFT bin weights.
- Later evaluate WORLD/phase-vocoder control for voice formants.

Stage D - Package
- Only after listening tests and docs: publish as experimental package.
- Safe wording: "prime-inspired DSP control curves".
- Unsafe wording: "Riemann proof", "prime generator", "solves mathematics".

## Commands

Inventory:

```powershell
.\scripts\research\Build-PrimeSpiralImageInventory.ps1
```

Generate control data:

```powershell
python .\a11\backend\apps\voice-module\app\prime_spiral_morph.py --limit 32 --curve
```

Test the first prime-candidate curve:

```powershell
.\scripts\research\Test-PrimeCandidateCurve.ps1 -Limit 10000 -Top 50
```

Apply A/B WAV morph:

```powershell
python .\a11\backend\apps\voice-module\scripts\apply_prime_spiral_morph.py `
  input.wav `
  output-prime-spiral.wav `
  --mode op_algebra `
  --dry-wet 0.18
```
