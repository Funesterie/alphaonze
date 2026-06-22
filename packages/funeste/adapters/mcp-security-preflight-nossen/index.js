"use strict";

const publicModule = require("@nossen/mcp-security-preflight");

const workspace = Object.freeze({
  name: "funeste",
  privatePackage: "@funeste/mcp-security-preflight-nossen",
  publicPackage: "@nossen/mcp-security-preflight",
  publicVersion: "0.1.2",
  defaultEndpoint: "https://mcp.funesterie.me/mcp",
  healthEndpoint: "https://mcp.funesterie.me/health",
  publicProfiles: Object.freeze({
    chatgpt: "https://mcp.funesterie.me/chatgpt/mcp",
    gemini: "https://mcp.funesterie.me/gemini/mcp",
    claude: "https://mcp.funesterie.me/claude/mcp",
    grok: "https://mcp.funesterie.me/grok/mcp"
  })
});

function createFunesteClient(options = {}) {
  return publicModule.createMcpClient({
    ...options,
    endpoint: options.endpoint || workspace.defaultEndpoint
  });
}

function describePrivate() {
  return { ...publicModule.describe(), workspace };
}

module.exports = {
  ...publicModule,
  workspace,
  createFunesteClient,
  describePrivate
};
