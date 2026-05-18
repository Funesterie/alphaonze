export {};

declare module '*.css';

declare global {
  interface Window {
    funesterie?: {
      bootstrap: () => Promise<DesktopSnapshot>;
      setProfile: (profileId: string) => Promise<DesktopSnapshot>;
      listTools: () => Promise<unknown>;
      callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
      chat: (message: string) => Promise<{ provider?: string; model?: string; text?: string; error?: string }>;
      checkUpdates: () => Promise<unknown>;
      downloadUpdate: () => Promise<unknown>;
      openExternal: (url: string) => Promise<boolean>;
    };
  }

  interface DesktopProfile {
    id: string;
    machineLabel: string;
    ownerName: string;
    shortName: string;
    role: string;
    machineHints?: string[];
    assistantName: string;
    capabilityMode: string;
    enabledModules: string[];
    tokenFilePath?: string;
    mcpUrl?: string;
    mcpUrls?: string[];
  }

  interface DesktopSnapshot {
    appVersion: string;
    profile: DesktopProfile;
    mcp: {
      connected: boolean;
      toolCount: number | null;
      tokenFilePath?: string | null;
      activeUrl?: string | null;
      endpoints?: Array<{ url?: string; kind?: string; ok?: boolean; at?: string; error?: string; count?: number }>;
      lastHealthCheck?: { ok?: boolean; at?: string; error?: string; activeUrl?: string; endpoints?: Array<{ url?: string; kind?: string; ok?: boolean; at?: string; error?: string; count?: number }> } | null;
    };
    llm: {
      activeProvider?: string;
      hardware?: {
        ramGB?: number;
        freeRamGB?: number;
        cpuCount?: number;
        recommendedModel?: string;
        preferCloud?: boolean;
      };
      providers?: Record<string, { available?: boolean; latencyMs?: number | null; lastCheck?: string | null }>;
    } | null;
    update: {
      manifestUrl?: string | null;
      available?: unknown;
    };
    system: {
      hostname: string;
      platform: string;
      cpuCount: number;
      memoryTotal: number;
      memoryUsed: number;
      memoryFree: number;
    };
  }
}
