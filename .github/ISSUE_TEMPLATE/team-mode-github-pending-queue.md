---
name: "Team mode: GitHub pending queue"
about: "Central checklist for major pending merges & MCP integration in Team Mode"
title: "Team mode: GitHub pending queue"
labels: ["team", "pending-queue", "tracking"]
---

# Team mode: GitHub pending queue

Central checklist for merges and MCP features. See docs in `docs/FUNESTERIE_AGENT_ROSTER.md` and `.kiro/agents/team-orchestrator.md`.

## Checklist

- [ ] Merge #22
- [ ] Verify Railway redeploy
- [ ] Test /health
- [ ] Test /api/auth/agent-token with secure admin token
- [ ] Merge #4 #6 #7 #8 from GitHub UI with workflow scope
- [ ] Hold #11 until Vite/plugin ESM issue is fixed
- [ ] Evaluate #2 #9 #16 in a frontend toolchain branch

---
**A11 MCP context:**
- Canonical MCP: `a11/backend/apps/server/tools/mcp/a11-mcp-server.cjs`
- Important tools:
    - a11_health
    - a11_identity_route
    - a11_route_map
    - a11_mcp_dimension_status
- Path: D:\projets\funesterie\a11\backend\apps\server\tools\mcp\a11-mcp-server.cjs
---
MCP integration and agent auth is tracked here as an anchor for Copilot and maintainers.
