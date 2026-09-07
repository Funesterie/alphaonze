'use strict';

const path = require('node:path');
const {
  appendEngineCommand,
  createEngineCommand,
} = require('@nossen/mcp-engine-bridge');

function resolveAgentBusRoot(env = process.env) {
  return path.resolve(String(env.AGENT_STATE_DIR || env.FUNESTERIE_AGENT_BUS_DIR || './agent-bus'));
}

function queueVivyEngineCommand(input = {}, options = {}) {
  const root = path.resolve(options.root || resolveAgentBusRoot(options.env || process.env));
  const command = createEngineCommand({
    ...input,
    issuer: input.issuer || 'vivy',
  }, options);
  const file = path.join(root, 'engine-commands.jsonl');
  appendEngineCommand(file, command, { root });
  return {
    accepted: true,
    commandId: command.id,
    target: command.target,
    action: command.action,
    expiresAt: command.expiresAt,
  };
}

function getEngineBridgePaths(options = {}) {
  const root = path.resolve(options.root || resolveAgentBusRoot(options.env || process.env));
  return {
    root,
    commands: path.join(root, 'engine-commands.jsonl'),
    results: path.join(root, 'engine-results.jsonl'),
  };
}

module.exports = {
  getEngineBridgePaths,
  queueVivyEngineCommand,
  resolveAgentBusRoot,
};
