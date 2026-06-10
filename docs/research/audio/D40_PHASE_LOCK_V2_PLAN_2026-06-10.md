# D40 Phase-Lock V2 Plan

Date: 2026-06-10

## V1 Saved

The working V1 overlay is preserved by Git tag:

```text
funesterie-d40-v1-overlay-20260610
```

V1 remains a dry-first protected overlay:

- dry signal stays dominant;
- two low-gain pitch-shifted layers are added;
- D40 shapes the cyclic envelope;
- output format follows the source format by default.

## Constant Roles

| Name | Value | Role |
| --- | ---: | --- |
| `D40_SOURCE_DENSITY` | `0.292` | central resonance density / pivot zone |
| `D40_SOURCE_N` | `40.0005` | experimental source cycle |
| `D40_TARGET_N` | `40` | normalized target cycle |
| `D40 value` | `0.2919963500456244` | `0.292 * 40 / 40.0005` |
| `PIVOT_RESIDUAL_OLD` | `0.000055193627332139616` | old pivot residual, not `mg_phase` |
| `AUDIO_PIVOT_GAIN_FACTOR` | `1.1039277402701244` | V1 overlay gain factor derived from the old pivot residual |
| `MG_PHASE` | `0.001554497790530303` | real phase residue candidate for V2 |
| `T_LINEAR` | `0.3695` | linearized smoothing reference |
| `ONE_OVER_E` | `0.36787944117144233` | dissipation comparison, not equal to `T_LINEAR` |

## V2 Goal

Move from a static protected overlay to a measured phase-lock workflow:

1. decode while preserving source format intent;
2. optionally isolate voice band or use stems;
3. analyze `f0(t)`, instantaneous phase, band energy, and transients frame by frame;
4. drive D40 as a cyclic density envelope;
5. apply `MG_PHASE` as a micro phase correction, not as a gain factor;
6. use `T_LINEAR` or `1/e` as smoothing/dissipation modes;
7. keep dry-first protect mix;
8. export in a source-compatible format;
9. require A/B and phase metrics before making V2 default.

## Current V2 Implementation

The first V2 code path is analysis-only and exposed separately from V1:

- `GET /api/double-harmonic/v2/status` returns the V2 constants and phase-lock plan.
- `POST /api/double-harmonic/v2/analyze` accepts one bounded audio upload and returns measured frame data.
- The analyzer decodes a temporary mono PCM stream, estimates `f0` with autocorrelation, estimates local phase around `f0`, measures coarse band energy, detects transient jumps, and samples the D40 envelope per frame.
- Temporary analysis files are deleted after the request.
- No V2 processing route is default yet.

The analysis payload is the contract for the next processing step. It should let the processor align the high/low overlay layers to the measured frame phase instead of applying a fixed overlay blindly.

## Guardrails

- Do not rename `PIVOT_RESIDUAL_OLD` back to `mg`.
- Do not use `MG_PHASE` as a simple gain multiplier.
- Do not make V2 the default until LUFS-matched A/B, mono correlation, phase error, and transient drift metrics pass.
- Keep `/api/double-harmonic/process` as V1 until V2 has measurable wins.
