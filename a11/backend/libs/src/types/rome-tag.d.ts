// ROME-TAG: 0xF98BD8

declare module '@rome/rome-tag' {
  export type RomeIndex = Record<string, any>;
  export function makeRomeTagRecord(input: { type: string; path: string; tag?: string }): { path: string; type: string; tag?: string };
  export function normalizeRomePath(p: string): string;
}
