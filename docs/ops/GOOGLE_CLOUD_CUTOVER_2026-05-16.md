# Google Cloud Cutover - Funesterie

Status: not cut over yet.

## Current Rule

Keep Google OAuth in test mode while only Jeffrey, family accounts, and internal agents use it.

Publish only when:

- branding is final
- privacy policy and terms are reachable
- authorized origins and redirect URIs are stable
- scopes are justified
- test users cover the required accounts
- demo video is ready if Google requests verification
- backend routes are already healthy in production

## OAuth Notes

Test mode is enough for controlled internal usage with listed test users.

Publishing is needed for broader external users. Sensitive scopes such as Drive file access or YouTube upload can trigger verification requirements. Do not publish with unclear scope justifications.

## Authorized URL Shape

Use public HTTPS only:

- app origin: `https://a11.funesterie.me`
- K44 origin: `https://k44.funesterie.me`
- Cloudflare Access origin only if it is the actual OAuth entrypoint

Avoid:

- localhost
- LAN IPs
- temporary tunnel URLs
- stale `alphaonze` redirects unless still actively used

## Pre-Cutover Checklist

1. Confirm A11/K44/Vivy login works for listed test users.
2. Confirm MCP OAuth is separate from Google OAuth and does not leak bearer tokens.
3. Confirm payment checkout is sandbox-tested before live mode.
4. Confirm media generation routes return public URLs or protected URLs intentionally.
5. Confirm `agent_role_route` is available to route media/audio/client/runtime tasks.
6. Confirm logs do not print Google client secrets, refresh tokens, bearer tokens, or R2 secrets.

## Google Cloud Later

When OAuth and payments are stable, move only the stable workloads first:

- public frontend
- OAuth callback handler
- read-only status endpoints
- media metadata services

Keep heavy GPU/Janus/Ekko runtime on Hetzner or local GPU nodes until the cost model is known.
