# A11 Cloudflare / R2 Status

Last checked: 2026-05-14T06:55:00+02:00

## Working

- Cloudflare account id is available from the local operator token file.
- The main Cloudflare API token can access account metadata.
- The main Cloudflare API token can see zone `funesterie.me`.
- The main Cloudflare API token can read and write DNS records for `funesterie.me`.
- The main Cloudflare API token can see R2 bucket `a11-files`.
- R2 custom domain is configured as `files.funesterie.me`.
- A11/MCP runtime already has S3-compatible R2 credentials in local env files.
- Public R2 uploads are already working through the MCP generated bucket tools.
- DNS records were created for `vivy.funesterie.me` and `music.funesterie.me`.
- The Hetzner Cloudflare tunnel config now routes both hostnames to the Kaen44/Vivy web surface.
- `https://vivy.funesterie.me/health`, `https://music.funesterie.me/health`, and `https://vivy.funesterie.me/api/vivy/alexa/song` return healthy responses.
- The MCP R2 credentials were resynced from the working A11 backend profile.
- Authenticated `https://mcp.funesterie.me/mcp` can now write, head, list, and read objects under allowed prefixes.
- A11 prod server-side MCP access can call `generated_bucket_*` tools through its token-backed relay.
- Public no-auth A11/K44/Vivy MCP relays intentionally do not expose R2 write tools.

## Not Working Yet

- The token labelled `Dns` in the local operator token file is rejected by Cloudflare.
- `api.funesterie.me`, `sd.funesterie.me`, and `cerbere.funesterie.me` are documented as local Windows tunnel hostnames. They should not be pointed at the Hetzner Kaen44 tunnel unless the backend routing plan changes.
- A valid local Windows Cloudflare tunnel must be running before those local hostnames can be made healthy.

## Token Notes

Do not commit tokens. Keep the operator token file local only.
