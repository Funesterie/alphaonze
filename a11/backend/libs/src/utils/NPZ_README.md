# NPZ Joker (Gotham Customs) v2.0

NPZ ("Joker") is the internal resolver/router used by qflush to start modules and proxy requests across multiple lanes (primary/backup). It provides:

- Gate-based resolver for binaries/modules: GREEN (local bin), YELLOW (module), DLX (npx), FAIL
- HTTP proxy router with T0/T1/T2 flow: try primary, fallback, then replay primary with extra header
- Douane (customs) checks before starting modules (env, files, ports)
- Request tracking with `npz_id` and optional Redis store
- Circuit breaker per-host per-lane and adaptive preferred lane ordering
- Prometheus metrics and an admin API

## v2.0 changes

- Namespaced keys and metrics via `NPZ_NAMESPACE` to avoid cross-app conflicts
- Redis-backed store optional via `REDIS_URL`
- Prometheus metrics and `/metrics` endpoint
- Admin endpoints protected by `NPZ_ADMIN_TOKEN`
- NPZ integrated as primary resolver for `qflush start` and as middleware in the daemon

Usage

- Middleware: `npzMiddleware()` to proxy requests via `/proxy` route
- Admin: `/npz/inspect/:id`, `/npz/lanes`, `/npz/preferred/:host`, `/npz/circuit/:host` (protected by `NPZ_ADMIN_TOKEN` header or `?token=`)
- Metrics: `/metrics` endpoint

Environment

- `REDIS_URL` to enable Redis-backed store
- `NPZ_ADMIN_TOKEN` to protect admin endpoints
- `qflushD_PORT` to set the daemon port

Files of interest

- `src/utils/npz.ts` - Joker resolver
- `src/utils/npz-router.ts` - HTTP router with lanes and circuit breaker
- `src/utils/npz-customs.ts` - customs scanners
- `src/utils/npz-middleware.ts` - Express middleware for proxying and tracking
- `src/utils/npz-store.ts` - unified store (file or redis)
- `src/utils/npz-store-redis.ts` - Redis-backed store
- `src/utils/npz-metrics.ts` - /metrics middleware
- `src/utils/npz-admin.ts` - admin endpoints

Example

Start the daemon:

```
REDIS_URL=redis://127.0.0.1:6379 NPZ_ADMIN_TOKEN=secret node dist/daemon/qflushd.js
```

Proxy a request (example):

```
curl -v http://localhost:4500/proxy/api/health



