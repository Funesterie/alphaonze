# @nossen/mcp-engine-bridge

A small transport contract for sending bounded commands to a **local** Unity or Unreal adapter.

It deliberately does not expose an editor on the public Internet and it does not execute shell commands. The package only creates, validates and appends command envelopes. A separate local adapter owns the editor-specific MCP/API calls and must maintain its own allowlist.

## Command flow

```text
remote orchestrator
  -> authenticated/reverse tunnel or private bus
  -> engine-commands.jsonl
  -> local Unity/Unreal adapter
  -> editor MCP/API
  -> engine-results.jsonl
```

This pattern is useful when the editor is on a workstation but orchestration runs elsewhere. The workstation remains the execution boundary.

## Supported actions

`status`, `apply`, `open`, `save`, `play`, `stop`, `build`

These names are intents, not executable strings. Adapters must map them to fixed editor operations. Never pass `payload.command`, shell text or arbitrary executable code directly to a process.

## Example

```js
const {
  createEngineCommand,
  appendEngineCommand,
} = require('@nossen/mcp-engine-bridge');

const command = createEngineCommand({
  target: 'unity',
  action: 'status',
  issuer: 'orchestrator',
  correlationId: 'job-123',
});

appendEngineCommand('/private-bus/engine-commands.jsonl', command, {
  root: '/private-bus',
});
```

## Safety contract

- transport only, no shell;
- fixed target and action enums;
- short expiry;
- bounded envelope size;
- bus path must stay inside the configured root;
- private/local adapter decides which projects/resources are writable;
- remote orchestration should use a reverse tunnel or authenticated private bus, not a public editor endpoint;
- results should be correlated by command ID and can be delivered asynchronously.
