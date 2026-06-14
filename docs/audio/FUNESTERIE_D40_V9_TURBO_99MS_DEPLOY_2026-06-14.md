# Funesterie D40 - V9 Turbo 99 ms

Date: 2026-06-14

V9 Turbo promotes the listening path after the V8 Pivot dynamic-treble tests.

## Listening Decision

- Base validated by ear: `hybrid vocal-safe`.
- User correction: the weight transitions still felt too slow.
- Final decision: `99 ms` is the exact transition value to publish.

## Signal Chain

- Grain pair: V8 Pivot, unchanged.
  - `grainLow = 0.3694286611319218`
  - `grainHigh = 1.3532064389096996`
  - product target: `100/(1024*mg_phase*(40.0005*pi))`
- Phase closure: centered `mg_phase` increments on `1024` slots, unchanged.
- Render mode: dry-first, no EQ, no limiter, no final gain.
- Turbo change: high and low overlays receive separate dynamic envelopes.
- Dynamic frame: `99 ms`.
- Voice/instrument rule: stable sustained zones lean toward the `air` profile; denser transient zones lean toward the `open` profile.

## Public Surface

- Backend status: `GET /api/double-harmonic/v9turbo/status`
- Backend process: `POST /api/double-harmonic/v9turbo/process`
- Vivy Studio label: `V9 Turbo`
- Default Vivy D40 mode: `V9 Turbo`, k3.

## Safety

V8 Pivot remains available. V8 Fermeture and V8 Plus e2 remain available as comparison branches.
