A11 MCP Server

This MCP server exposes a local A-11 AI running on http://127.0.0.1:3000 to GitHub Copilot via MCP (STDIN/STDOUT transport).

Quick start
1. Install dependencies: `npm install`
2. Start the server: `npm start`

Environment variables
- `A11_API_URL` - override the A-11 HTTP endpoint (default: `http://127.0.0.1:3000/v1/chat/completions`)
- `A11_MODEL` - model name to request (default: `a11-phi3`)

Logging
Logs are written to `logs/a11-mcp.log` in JSON-lines format.

Tools exposed
- `a11_chat` - general chat
- `a11_code` - code-focused assistant (accepts `filepath` and `snippet`)
- `a11_system` - send system-level prompts (persona, debug)

Copilot Desktop settings example
See `settings-example.json` for how to register the server with Copilot Desktop.

Inspector
Use the MCP inspector to test your server:

```
npx @modelcontextprotocol/inspector node index.js
```

Notes
- This is a JS ESM implementation. We can port to TypeScript on request.
- Adjust endpoints if your A-11 server differs (ports, streaming, auth).
