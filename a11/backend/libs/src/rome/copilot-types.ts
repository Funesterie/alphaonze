// ROME-TAG: 0x9FE624

export interface CopilotConfig {
  enabled: boolean;
  telemetryVersion: number;
  webhookUrl?: string;
  hmacSecretEnv?: string; // name of env var that contains secret
  transports: Array<'webhook'|'sse'|'file'>;
  filePath?: string;
  allowedData?: string[];
  samplingRate?: number;
  maxPayloadSize?: number;
}

export interface EngineState {
  rules: any[];
  indexSummary: { count: number; byType: Record<string, number> };
  runningServices?: string[];
  config?: any;
}

export interface RuleEvent {
  rule: string;
  path?: string;
  matchContext?: any;
  actions?: any[];
  result?: any;
  timestamp?: string;
}

export interface Diagnostic {
  severity: 'error'|'warning'|'info';
  source: string;
  message: string;
  location?: { file?: string; line?: number };
  timestamp?: string;
}

export type TelemetryEvent = { type: string; telemetryVersion: number; repo?: string; branch?: string; commit?: string; timestamp: string; payload: any };
