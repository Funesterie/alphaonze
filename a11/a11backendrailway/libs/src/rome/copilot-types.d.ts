// ROME-TAG: 0xD0B108

export interface CopilotConfig {
  enabled: boolean;
  telemetryVersion: number;
  webhookUrl?: string;
  hmacSecretEnv?: string;
  transports: Array<'webhook'|'sse'|'file'>;
  filePath?: string;
  allowedData?: string[];
  samplingRate?: number;
  maxPayloadSize?: number;
}

export interface EngineState { [key: string]: any }
export interface RuleEvent { [key: string]: any }
export interface Diagnostic { [key: string]: any }
export type TelemetryEvent = any;
