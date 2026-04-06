import type { RegisteredTool } from "./types";

const tools = new Map<string, RegisteredTool>();

export function registerTool(tool: RegisteredTool) {
  tools.set(tool.name, tool);
}

export function getTool(name: string): RegisteredTool | undefined {
  return tools.get(name);
}

export function listTools() {
  return Array.from(tools.keys());
}
