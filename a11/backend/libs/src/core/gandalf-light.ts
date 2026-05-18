export interface WhiteLightEvent {
  event: string;
  payload?: unknown;
  at: string;
}

const trace: WhiteLightEvent[] = [];

export function whiteLight(event: string, payload?: unknown): WhiteLightEvent {
  const entry = { event, payload, at: new Date().toISOString() };
  trace.push(entry);
  if (process.env.QFLUSH_WHITE_LIGHT === '1') {
    console.error(`[white-light] ${event}`, JSON.stringify(payload ?? {}));
  }
  return entry;
}

export function getWhiteLightTrace(): WhiteLightEvent[] {
  return [...trace];
}

export function clearWhiteLightTrace(): void {
  trace.length = 0;
}

