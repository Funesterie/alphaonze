# A11 Deployment Topology

## Domain Ownership

- `funesterie.me` is managed on Cloudflare.
- `funesterie.pro` is not managed in the connected Cloudflare account.
- `api.funesterie.pro` currently resolves to Railway.
- `a11.funesterie.pro` is the public frontend hostname.

## Public vs Local Domains

Use the domains with one clear responsibility each:

- `a11.funesterie.pro`
  Public frontend on Netlify.
- `api.funesterie.pro`
  Public A11 API on Railway.
- `files.funesterie.me`
  Public Cloudflare R2 file hostname.
- `api.funesterie.me`
  Local Windows backend tunnel on port `3000`.
- `cerbere.funesterie.me`
  Local Cerbere tunnel on port `4545`.
- `sd.funesterie.me`
  Local backend image proxy on port `3000`.

Do not point the LLM router to `api.funesterie.pro` or `api.funesterie.me`.

## Runtime Topology

Public web flow:

1. Browser -> `a11.funesterie.pro`
2. Frontend -> `api.funesterie.pro`
3. Railway backend -> `cerbere.funesterie.me`
4. Cerbere local -> local GGUF on `127.0.0.1:8080`

Public image flow:

1. Browser -> `a11.funesterie.pro`
2. Frontend -> `api.funesterie.pro`
3. Railway backend -> `sd.funesterie.me/api/tools/generate_sd`
4. Local backend -> vendored SD helper in `apps/server/tools/sd`
5. Local Python runtime -> `llm/scripts/venv`

Production image policy:

- Railway is `proxy-only` for SD image generation.
- Railway must use `A11_SD_PROXY_URL` with the full route `https://sd.funesterie.me/api/tools/generate_sd`.
- Railway should keep `A11_SD_ALLOW_LOCAL_FALLBACK=false`.
- Railway must not define Windows-only local runtime paths such as `SD_SCRIPT_PATH` or `SD_PYTHON_PATH`.
- `A11_VISION_BASE_URL` is reserved for remote vision/OCR and must not be reused for SD generation.

Local maintenance flow:

1. Browser / tools -> `api.funesterie.me`
2. Local backend -> local services on Windows

## Railway Backend Variables

Set these on `a11backend` when using the local GGUF through Cerbere:

```env
PUBLIC_API_URL=https://api.funesterie.pro
BACKEND=local
LLM_ROUTER_URL=https://cerbere.funesterie.me
A11_ALLOW_PUBLIC_TUNNEL_LLM=1
A11_SD_PROXY_URL=https://sd.funesterie.me/api/tools/generate_sd
A11_SD_ALLOW_LOCAL_FALLBACK=false
```

Keep these empty on Railway proxy-only deployments:

```env
SD_SCRIPT_PATH=
SD_PYTHON_PATH=
```

Keep these empty unless you intentionally expose the raw llama server:

```env
LOCAL_LLM_URL=
LLAMA_BASE=
```

## Frontend Variables

Public frontend should use only the API bases:

```env
VITE_A11_API_BASE_URL=https://api.funesterie.pro
VITE_A11_ONLINE_API_BASE_URL=https://api.funesterie.pro
VITE_A11_LOCAL_API_BASE_URL=https://api.funesterie.me
VITE_LLM_ROUTER_URL=
```

## Cloudflare Tunnel Ingress

Recommended local config:

```yaml
ingress:
  - hostname: sd.funesterie.me
    service: http://localhost:3000
  - hostname: api.funesterie.me
    service: http://localhost:3000
  - hostname: cerbere.funesterie.me
    service: http://localhost:4545
  - service: http_status:404
```

## Notes

- `cerbere.funesterie.me` should be the only hostname exposed for the LLM path.
- `sd.funesterie.me` should be the only hostname exposed for tunneled image generation.
- The public SD route is `POST https://sd.funesterie.me/api/tools/generate_sd`.
- `https://sd.funesterie.me/health` is the tunnel/service health check, not the generation route.
- Exposing `llama-server` directly is optional and should stay off unless you really need it.
- Keep `llm` for heavy local assets only: GGUF files, `llama.cpp`, local Python venvs, and other machine-local runtimes.
- Keep lightweight backend-owned scripts inside `backend/apps/server`.
- Do not copy Windows absolute paths into Railway variables.
- The current Cloudflare tunnel in the connected account uses remote config. If you want the local `config.yml` to be the source of truth, restart `cloudflared` with the named tunnel and config file instead of the token-only process.
