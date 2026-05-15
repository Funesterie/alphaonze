# Kaen44 Cloudflared Tunnel Runbook - 2026-05-13

## Live State

Kaen44 public traffic is routed through a dedicated Cloudflare Tunnel running on the Hetzner host.

- Tunnel name: `kaen44-hetzner`
- Tunnel id: `7a6fa064-9c6f-477f-865a-131240ce5f5e`
- Hetzner host: `deploy@62.238.43.32`
- Tunnel container: `kaen44-cloudflared`
- Tunnel config directory on Hetzner: `/home/deploy/cloudflared-kaen44`
- Versioned compose file: `a11/backend/apps/server/docker-compose.kaen44-cloudflared.yml`
- Versioned config template: `a11/backend/apps/server/cloudflared/kaen44-hetzner-config.example.yml`

No credential JSON, cert, token, or secret value should be committed.

## Routed Hostnames

These hostnames route to the tunnel and then to Caddy on Hetzner:

- `kaen44-hetzner-test.funesterie.me`
- `k44.funesterie.me`
- `kaen44.funesterie.me`
- `funesterie.me`
- `www.funesterie.me`

The tunnel forwards to `http://127.0.0.1:80` on Hetzner and uses `httpHostHeader` so Caddy selects the Kaen44 virtual host.

## Deploy Or Repair

On Hetzner, keep these files in `/home/deploy/cloudflared-kaen44`:

- `config.yml`
- `7a6fa064-9c6f-477f-865a-131240ce5f5e.json`
- `docker-compose.yml`

Start or refresh the tunnel:

```bash
cd /home/deploy/cloudflared-kaen44
docker compose -f docker-compose.yml up -d
```

Check status:

```bash
docker ps --filter name=kaen44-cloudflared
docker logs --tail 80 kaen44-cloudflared
cloudflared tunnel info kaen44-hetzner
```

## DNS Routes

If DNS routes need to be recreated from an authenticated workstation:

```bash
cloudflared tunnel route dns --overwrite-dns kaen44-hetzner kaen44-hetzner-test.funesterie.me
cloudflared tunnel route dns --overwrite-dns kaen44-hetzner k44.funesterie.me
cloudflared tunnel route dns --overwrite-dns kaen44-hetzner kaen44.funesterie.me
cloudflared tunnel route dns --overwrite-dns kaen44-hetzner funesterie.me
cloudflared tunnel route dns --overwrite-dns kaen44-hetzner www.funesterie.me
```

## Smoke Checks

Expected:

```bash
cd a11/backend/apps/server
npm run smoke:kaen44
KAEN44_ORIGIN_BASE=http://62.238.43.32 npm run smoke:kaen44
```

Equivalent manual checks:

```bash
curl -fsS https://k44.funesterie.me/health
curl -fsS https://k44.funesterie.me/api/llm/stats
curl -fsS https://kaen44.funesterie.me/api/llm/stats
curl -fsS https://funesterie.me/api/llm/stats
curl -fsS https://www.funesterie.me/api/llm/stats
```

The stats response should be Cerbere JSON and response headers should include `via: 1.1 Caddy`.

## Rollback

To stop the dedicated tunnel without deleting DNS:

```bash
docker rm -f kaen44-cloudflared
```

To route `k44` through Render temporarily, point the relevant Cloudflare DNS/Worker/Origin Rule to:

```text
https://kaen44-api.onrender.com
```

Render fallback is verified independently and uses Together AI through the OpenAI-compatible client path.
