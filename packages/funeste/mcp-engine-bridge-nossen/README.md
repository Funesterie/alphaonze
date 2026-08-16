# @funeste/mcp-engine-bridge-nossen

Private Funesterie adapter for `@nossen/mcp-engine-bridge`.

It queues Vivy-originated Unity/Unreal intent envelopes into the authenticated agent-bus directory. The adapter does not execute editor commands itself and does not expose editor ports.

Files:

- `engine-commands.jsonl`: Finland/orchestrator -> workstation;
- `engine-results.jsonl`: workstation -> Finland.

The local editor adapter remains responsible for mapping fixed intents to allowlisted MCP tools and for enforcing project/resource boundaries.
