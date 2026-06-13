# Funesterie D40 - V8 Pivot 1024 / 0.292

Date: 2026-06-13

## Decision

V8 Pivot is promoted as the listening-validated V8 branch after the RADWIMPS comparison:

- V8 Fermeture stayed better than V8 Plus e2 on the full k3 render.
- The next candidate pack showed the cleanest numerical lock at exact `1024` and exact pivot `0.292`.
- User validation: "je valide la version V8 pivot".

## Active Pair

```text
grainLow  = 0.3694286611319218
grainHigh = 1.3532064389096996
product   = 0.4999132429615061
pivot     = 0.292
slots     = 1024
```

## Formula

The branch keeps the V8 centered `mg_phase` closure and changes only the grain pair.

```text
product1024 = 100 / (1024 * mg_phase * (40.0005 * pi))
deltaPivot  = grainHigh - grainLow = 0.9837777777777778
pivot       = 0.292 + 18 * (0.9837777777777778 - deltaPivot)
```

Solving `low * high = product1024` and `high - low = deltaPivot` gives the active pair above.

## Public Surface

- Backend status: `GET /api/double-harmonic/v8pivot/status`
- Backend process: `POST /api/double-harmonic/v8pivot/process`
- Vivy Studio label: `V8 Pivot`

V8 Fermeture and V8 Plus e2 remain available for comparison.
