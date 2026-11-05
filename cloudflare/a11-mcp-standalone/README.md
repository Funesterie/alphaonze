# A11 standalone MCP: safe bootstrap

This is a **minimal MCP skeleton**, not a replacement for A11/Vivy/Neo4j. It has no tools and does not yet connect to Google Drive or OneDrive. It does not proxy requests to the offline PC.

## Deployment (not performed)
1. Review the code and run `npx wrangler deploy --dry-run --config cloudflare/a11-mcp-standalone/wrangler.jsonc`.
2. In Cloudflare, configure the secret `MCP_BEARER_TOKEN` with a strong random value (never commit it).
3. Deploy explicitly using Wrangler from the repository root.
4. Check `GET /health` (public) and authenticated `POST /mcp` initialize, tools/list and ping.
5. Only after authenticated tests, plan a custom hostname and connector OAuth compatibility.

## Boundaries
- No routes or DNS records changed.
- No GitHub Actions auto-deployment.
- No Cloudflare account credentials or Drive credentials in source.
- MCP Bearer is a bootstrap guard, **not** a complete OAuth integration for ChatGPT MCP connectors.
- No durable storage, Drive sync, or production availability guarantees.
- Keep the existing `mcp.funesterie.me` tunnel untouched until an independently validated replacement exists.
