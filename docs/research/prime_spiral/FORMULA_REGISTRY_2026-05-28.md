# Prime Spiral Formula Registry - 2026-05-28

Status: first reviewed registry from OCR + visible screenshots. This is a
research notebook, not a proof. Entries marked `custom_op` need operator
definitions before implementation. Entries marked `experimental_mapping` are
allowed for audio/control experiments, not mathematical claims.

## Corpus Inputs

- Inventory: 891 images
- OCR: 886 images
- Review queue: 172 prioritized entries
- Local OCR/tag outputs:
  - `.codex-tmp/prime-spiral-ocr`
  - `.codex-tmp/prime-spiral-tags.rome.json`
  - `.codex-tmp/prime-spiral-review-queue.json`
- Public research album to index: `https://www.amazon.fr/photos/share/JwzZH4k4e2OnxYjGskOvUnfX2rFNQPGx4R1VPJrd6t2`

## Rule Of Interpretation

Do not treat every screenshot as true. The corpus contains tries, retries,
failures, OCR noise, and later corrections. A formula can enter code only when
it has:

1. A source image.
2. A family tag.
3. A maturity tag.
4. A defined operator table if it uses `op`, `op_sym`, or `Sym`.
5. A numerical test target if it predicts primes or zeta-zero values.

## Relation Matrix Rule

The research is also a matrix / graph compression problem:

```text
observations x operations -> candidate links
```

Two directions must be tracked:

1. Forward: observations imply or suggest a link.
2. Reverse: a known link is treated as a target, then we search which images,
   constants, formulas, or operator paths could generate it.

Every link must carry a status:

| Status | Meaning |
|--------|---------|
| observed | directly visible in a screenshot or extracted formula |
| inferred | explains several observations but still needs tests |
| invented | useful compression hypothesis; mark clearly |
| falsified | tested and failed; keep to avoid retry loops |

Do not erase failed links. They are part of the inverse provenance map.

## Concrete Candidates

### C1 - Prime Candidate Curve

Source: `2026-03-29_06-21-10_000.png`

Status: testable heuristic. Initial literal test failed as a primality
detector, but the curve remains usable as an audio/visual periodic control.

```text
theta(n) = 2*pi*n / 40.0005
M(n) = 0.292 + mg * sin(theta(n))
B(n) = |M(n) - M(n-1)| + |M(n+1) - M(n)|
R(n) = |cos(theta(n)) - 0.292|
S(n) = B(n) / (R(n) + mg)
```

Claim to test: `n` is a prime candidate when `S(n)` is a local maximum.

Implementation path:

- Generate `S(n)` for `n <= 10000`.
- Compare local maxima against actual primes.
- Track precision, recall, false positives, and gap-position behavior.
- If poor, keep it as an audio-control curve only.

Initial test:

```powershell
.\scripts\research\Test-PrimeCandidateCurve.ps1 -Limit 10000 -Top 50
```

Result:

```text
primes            : 1229
local maxima      : 499
maxima prime hits : 0
precision         : 0.00%
recall            : 0.00%
top precision     : 0.00%
```

The top maxima land on multiples of about 40 (`40, 80, 120, ...`), so the
literal maximum rule is not a prime detector. Keep this formula in the
`audio_mapping` bucket unless a later corrected screenshot changes the rule
from "local maximum" to another phase/gap condition.

### C2 - Stable Dimension Chain

Source: `2026-03-22_20-36-30_000.png`

Status: custom dimensional ladder, partially OCR-confirmed.

```text
D1(n) = n + 1
D2(n) = ((2*D1(n) + 1)^2 * D1(n)) / D1(n)
      = (2n + 3)^2
D3(n) = D2(n) * (1 / D2(n)) / D1(n)
D5(n) = log_{D3(n)}(D3(n) * exp(D3(n))) + 1 / D1(n)
D7(n) = log_{D5(n)}(ln(D5(n) * D1(n)) / (D3(n) * ln(D2(n))))
D8(n) = D1(n) / D7(n)
```

Known snippet values mention:

```text
n=2 -> D1=3, D2=49
n=3 -> D1=4, D2=81
n=5 -> D1=6, D2=169
```

Implementation path:

- Recreate with safe guards for invalid logarithm bases and domains.
- Use this as a bounded control generator only after normalization.
- Do not claim it generates primes.

### C3 - M-Dual Opposite Chain

Source: `2026-03-22_19-50-03_000.png`

Status: custom inversion chain, OCR incomplete.

Readable pieces:

```text
D1_opp(n) = S(n) / n = (n + 1) / 2
D2_opp(n) = D2(n) / (2*S(n) + 1)
D3_opp(n) = D3(n) / (3*S(n)^? * (1 / D?(n)))
```

Interpretation: an opposite or finite-return version of the dimension chain.

Implementation path:

- Needs manual visual confirmation before code.
- Candidate for a "mirror" mode paired with C2.

### C4 - Symmetric Stabilization Functional

Source: `2026-03-11_20-38-58_000.png`

Status: mathematically sensible pattern, OCR incomplete.

```text
F = sum_{i<j} [(T(L_i) - T(L_j))^2 + ...]
```

Claim: equilibrium happens when transformed layers match:

```text
T(L_1) = T(L_2) = ...
```

Implementation path:

- Useful as a loss/score, not as a prime formula.
- Can score whether multiple control curves are synchronized.

### C5 - Zone Factor Gate

Source: oral/user correction, 2026-06-04.

Status: experimental proxy only. This records the hypothesis that the binary
gate `q(n)` may depend on the local zone of `n`, not only on `n` itself.

```text
Z_7# = 2*3*5*7 = 210
Z_7! = 7!      = 5040
zone_index = floor(n / Z)
local_n    = n mod Z
q_Z(n)     = closure(local_n, zone_index, mg_phase)
```

Implementation path:

- Test both `Z_7#=210` and `Z_7!=5040`.
- Keep them separate until the real zone operator is defined.
- Record derivative and primitive of `q(n)`, not only the selected points.
- Do not claim a prime rule; this is a resonance/zone candidate.

## Custom OP Algebra

### O1 - Cross Around M

Sources:

- `c:/Users/Djeff/Desktop/prems/3d5f90fc-ba22-48ce-8c08-2ce04939f2f9.jpg`
- `c:/Users/Djeff/Desktop/prems/7e0beccb-55d0-4add-a69c-5e7c42eb4655.jpg`
- `c:/Users/Djeff/Desktop/prems/9f2f807e-e429-4d3b-9632-e3b5d99ab092.jpg`
- `c:/Users/Djeff/Desktop/prems/d72868ac-7228-488f-a0c7-68517916024f.jpg`
- `c:/Users/Djeff/Desktop/prems/fff248b7-46be-42fd-9ab9-80dbc4552bf1.jpg`

Core states:

```text
{ +M, -M, +iM, -iM }
```

Closure alphabet observed:

```text
{ i, -i, -1, 1, M }
```

Sign inversion:

```text
+M  -> -M
-M  -> +M
+iM -> -iM
-iM -> +iM
```

Real-axis symmetry:

```text
(-M / M) op_sym (+M / M) = 1
```

Imaginary-axis symmetry:

```text
(-iM / M) op_sym (+iM / M) = 1
```

Important: `op_sym` is not standard multiplication. It is a custom closure
operator. Define its table before using these equations in code.

Research implementation:

```text
a11/backend/apps/voice-module/app/prime_spiral_morph.py --op-table
scripts/research/Test-SymetrieOpTable.ps1
docs/research/prime_spiral/SYMETRIE_OP_TABLE_2026-05-29.md
```

Status after 2026-05-29: `mul` and `op_sym` tables are implemented and tested
as research code. The separate custom `op` equations that output `M` remain
recorded observations until their resolver is independently defined.

### O2 - Corrected Real OP Outputs

Source: `d72868ac-7228-488f-a0c7-68517916024f.jpg`

OCR/visual form:

```text
(-M_r / M_r) op (-M_i / M_i) = -1
( M_r / M_r) op ( M_i / M_i) = -1
(-M_r / M_r) op ( M_i / M_i) = M
( M_r / M_r) op (-M_i / M_i) = M
```

Output set:

```text
{ -1, -1, M, M }
```

Status: retry/correction. Keep separate from O1 until the OP table is fixed.

### O3 - Corrected Imaginary OP Outputs

Source: `d47b4c8a-744f-4190-9a10-52e69e9cae52.jpg`

OCR/visual form:

```text
(-M_r /  M_i) op (-M_r / -M_i) =  i
( M_r /  M_i) op ( M_r / -M_i) = -i
(-M_r / -M_i) op (-M_r /  M_i) = -i
( M_r / -M_i) op ( M_r /  M_i) =  i
```

Output set:

```text
{ i, -i, -i, i }
```

Status: retry/correction. Useful for building the imaginary half of the OP
table.

### O4 - Missing Closure Equations

Source: `fff248b7-46be-42fd-9ab9-80dbc4552bf1.jpg`

```text
-(M_r / M_i) op (M_r / -M_i) = 1
(M_r / M_i) op -(-M_i / M_r) = 1
```

Claimed complete output set:

```text
{ i, -i, -1, 1, M }
```

Status: retry. Needs manual operator normalization.

## Prime-Dimension Ladder

Sources:

- `85733499-6aac-4097-acbb-e6a5792723f2.jpg`
- `aca4581b-df4a-4bbb-83cd-377ade2e1be0.jpg`
- `c4a901e4-0b69-435c-9a88-9736f42615ee.jpg`

Dimension primes:

```text
1, 2, 3, 5, 7
```

Interpretation:

```text
1 -> imaginary root
2 -> root + inversion
3 -> log exponential
5 -> nested ln/log
7 -> global symmetry
```

OCR/visual structure:

```text
1d = sqrt(-i)
2d = negative/root-inversion transform of 2^(1d)
3d = log_-3(exp(3^(2d + 1)))
5d = -ln_-5(-log_5(exp((3d)^(2d + 1))))
7d = Sym(1d, 2d, 3d, 5d) = 1
```

Status: conceptually central, not ready for numeric use until branch handling
for complex roots/logs is specified.

## Spiral And Projection Families

### S1 - Phi/J Logarithmic Spiral

Sources: multiple March 20 screenshots and OCR tags.

```text
z_n = n(phi - j*i) * e^(i log n)
R = sqrt(phi^2 + j^2)
theta(n) = log n + arg(phi - j*i)
```

Interpretation:

- radius grows approximately with `n`
- phase turns logarithmically
- this is safe to use as a smooth DSP control curve after normalization

### S2 - Modular Diagonal Projection

Sources: March 20 screenshots and `RESEARCH_PLAN_2026-05-28.md`.

```text
P(n) = |n(+/-phi +/- j)| mod 1
```

Interpretation:

- produces diagonal bands / grid behavior
- good for visualization and audio modulation
- not a primality test by itself

### S3 - Gap Law

```text
delta_theta = log(n + 1) - log(n)
delta_theta ~= 1/n
```

Interpretation:

- phase increments shrink with `n`
- useful for slowing modulation over longer sequences

## Riemann / Audio Experimental Mappings

### R1 - 40.0005 / 40.001 Chirp

Sources:

- `2026-03-16_18-06-28_000.png`
- `2026-03-16_19-41-56_000.png`
- `2026-03-16_19-48-30_000.png`
- `2026-03-16_19-46-35_000.png`

Typical forms:

```text
t_k ~= sqrt(40.001*pi*k) * 1.265 + corrections
```

or:

```text
t_k = (1/e)*sqrt(40*pi*k)
    + 1/2*ln(t_k * 18*|c7|)
    + 0.0005*(...)
```

Status: experimental_mapping. Some screenshots are tagged retry/fail. Do not
publish as zeta-zero prediction until compared numerically against known
zeros.

Audio-safe interpretation:

- Use as a chirp/envelope generator.
- Do not describe as "solves Riemann".
- Compare against real zeta zeros only in an analysis notebook.

### R2 - Constants

Observed constants:

```text
T_linear = 0.3 + 0.06 + 0.009 + 0.0005 = 0.3695
T_spectral = T_linear + epsilon_1 + epsilon_2 + ...
Q_hyper = a + b*i + c*j + d*k + e*l + f*m
epsilon_r = real_projection(F_r(Q_hyper))
0.292
1.265
c7 ~= 0.029202
phi - pi/2 ~= 0.0472376
40.0005*pi
```

Status:

- `T_linear`, `0.292`, and `1.265` recur often.
- Historical screenshots sometimes call `0.3695` "mg"; corrected reading:
  it is a linearized/truncated spectral coefficient, not `mg_phase`.
- The more exact coefficient may be an asymptotic/perturbative expansion
  (`0.3695...`, possibly `0.369479...` after deeper corrections).
- Hypothesis: later epsilon terms may come from hypercomplex projections over
  five research axes `i,j,k,l,m`, in a form like `a+b*i+c*j+d*k+e*l+f*m`.
  This is not yet a locked algebra; define projection/norm/multiplication table
  before using it as a formula.
- Some derivations are explicitly failed or corrected later.
- Store constants with provenance; avoid hardcoding unexplained meanings.

## Known Failures / Do Not Reuse Directly

### F1 - 0.0005 Breaks Some Regularities

Source: `2026-03-17_09-28-09_000.png`

Observation: a `0.0005` correction was flagged as suspicious because it breaks
some divisions by 5, phi, or other expected regularities. Keep it as an
empirical phase residual only.

### F2 - Bad Zeta-Zero Prediction Around 20n / 20.0005n

Source: `2026-03-18_03-38-20_000.png`

Observation: one simplified formula predicted a first zero around `76.52`,
far from the real first non-trivial zeta zero near `14.1347`. Treat this path
as failed for zeta-zero prediction.

### F3 - Historical Constant Drift

Source: `2026-03-22_13-54-01_000.png`

Observation: the screenshot itself warns about "vraies valeurs, pas
approximations". This indicates earlier constants were rough. Always attach
the source and version when using constants.

### F4 - C1 Local Maxima Are Periodic, Not Prime-Selective

Source: local test from `scripts/research/Test-PrimeCandidateCurve.ps1`

Observation: with historical `T_linear=0.3695`, `pivot=0.292`, and `period=40.0005`, the local
maxima are regular periodic peaks around multiples of 40 and hit no primes
under `10000`. Do not use the literal C1 rule as a primality detector.

### F5 - q(n) Binary Resonance Gate

Source: local test from `scripts/research/Test-PrimeSpiralQn.py`

Definition:

```text
q(n)=1 -> selected / resonant candidate
q(n)=0 -> not selected
```

Score families tested:

- old C1 high-score gate
- `40.0005π/c7` modular residual
- `40.0005/c7` modular residual
- `T_linear` residual
- `mg_phase` residual
- `target_0005π` residual
- cross-unit `π/2` residual
- flat `R_a + R_a = 2R_a` preload residual
- bounded addition cascade `unit(z + phi + jhi*i)` from `z0=i`
- bounded multiplication cascade `unit(z * (c7 + mg_phase*i))` from `z0=i`
- bounded cascade `unit(exp(z))` from `z0=i`
- bounded cascade `unit(i^z)` from `z0=i`
- bounded log/ln cascade `unit(log(1+z))` from `z0=i`
- bounded `ln -> division` cascade `unit(z/(1+ln(1+z)))` from `z0=i`
- bounded inverse/division cascade `unit(1/(1+z))` from `z0=i`
- bounded full op round `add -> multiply -> exp -> log/ln -> divide -> invert`
- cross-star phase cascade with `R_a` preload

Results:

| Limit | Best family | Precision topK | Lift vs prime density |
|-------|-------------|----------------|-----------------------|
| 10 000 | `cascade_add_unit` | 0.1627 | 1.324 |
| 100 000 | `cascade_add_unit` | 0.1232 | 1.285 |
| 1 000 000 | `cascade_add_unit` | 0.0981 | 1.250 |

Observation: `q(n)` can be kept as a weak resonance gate, but none of the
tested families is a reliable prime detector. The local maximum rule already
failed completely. Revision 2026-06-04: applying the cascade principle to all
operations, not only `exp`, improves the topK lift. The best current signal is
`cascade_add_unit`, with `cascade_ops_round_unit` close behind. However, the
primitive remains poor, so this is a ranking signal, not a cumulative law.

Discrete calculus:

```text
Dq(n)=q(n)-q(n-1)
Pq(n)=Σ_{k<=n} q(k)
```

At `n <= 1 000 000`, current best by topK lift `cascade_add_unit` gives:

```text
Dq rising prime precision ≈ 0.0000
Pq mean absolute error vs π(n) ≈ 34469
```

By contrast, `old_c1_high` has weaker topK lift (`≈1.065`) but much better
primitive error (`≈1701`). This means the new all-op cascade is better at
ranking isolated candidates, while the older curve follows the global counting
shape better.

Cascade observation: `unit(exp(z))` and `unit(i^z)` are weak or actively bad
under the current scoring. The useful next test is a formally defined
Funesterie `op` table, especially the candidate branch `ln -> division`.

## Module Policy

Allowed now:

- Use `S1`, `S2`, `S3`, and `C1` as normalized experimental control curves.
- Use `q(n)` only as a `researchOnly` resonance gate.
- Use `R1` as an audio chirp, not as a proof.
- Use `C4` as a synchronization score.

Blocked until defined:

- OP algebra in production. The research table exists, but the custom `op`
  resolver is still not mature enough for production math claims.
- `Sym(...) = 1` as a numeric identity.
- Prime-dimension ladder as anything more than symbolic exploration.
- Publication claims involving prime generation or Riemann.

Next implementation step:

1. Add `formula_registry.json` generated from this file or the OCR queue.
2. Extend `q(n)` tests with OP-derived score families once `op` is defined.
3. Extend the OP table into a custom `op` resolver and falsify it against the
   retry/fail OCR lane.
4. Only then wire OP modes into the audio module.
