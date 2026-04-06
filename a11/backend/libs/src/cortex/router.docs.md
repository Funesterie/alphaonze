Router behavior
================

- Router consults `.qflush/cortex.routes.json` using `routesConfig` helper.
- When `payload.candidates` present, `pickBestRoute(candidates)` picks route by score and enabled flag.
- Handlers for idea names either call apply handlers (NPZ-GRAPH, SAVE-STATE, AUTO-PATCH) or emit events (CORTEX-DRIP, SPYDER-SOUND).

Routes
------
- CORTEX-DRIP -> emit
- NPZ-GRAPH -> executeAction('npz.encode')
- OC8-LANG -> placeholder
- QUANTUM-ROUTER -> uses routesConfig
- SPYDER-SOUND -> emit
- SAVE-STATE -> apply
- AUTO-PATCH -> apply
- SPYDER-VISION -> vision pipeline
- A11-KEY -> CLI a11-key handler
- FUNESTERIE-MAGIE -> emit

