QFLUSH / FUNESTERIE — Copilot Context (short)

- Project: @funeste38/qflush
- Version: 3.1.2
- Purpose: Orchestrator for Funesterie (start/stop/purge/inspect) + daemon exposing NPZ & ROME endpoints
- Key commands: `qflush start|kill|purge|inspect|config|rome:links`
- Daemon endpoints: `/npz/checksum/*`, `/npz/rome-index`, `/npz/rome-links*`
- Dev: `npm run build`, `npm test` (vitest)
- Notes: Redis optional; disable in dev via `QFLUSH_ENABLE_REDIS=0`.
