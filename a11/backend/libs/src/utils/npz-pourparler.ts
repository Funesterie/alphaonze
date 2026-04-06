// ROME-TAG: 0x94B7C0

import * as crypto from 'crypto';

type Message = { id: string; role: 'user' | 'assistant' | 'system'; text: string; t: number };

type Session = { id: string; messages: Message[]; createdAt: number };

const SESSIONS: Map<string, Session> = new Map();

function id() { return Math.random().toString(36).slice(2,10); }

export function startSession(systemPrompt = ''): Session {
  const sid = 's_' + id();
  const s: Session = { id: sid, messages: [], createdAt: Date.now() };
  if (systemPrompt) s.messages.push({ id: 'm_' + id(), role: 'system', text: systemPrompt, t: Date.now() });
  SESSIONS.set(sid, s);
  return s;
}

export function sendMessage(sessionId: string, role: 'user' | 'assistant' | 'system', text: string) {
  const s = SESSIONS.get(sessionId);
  if (!s) throw new Error('session not found');
  const m: Message = { id: 'm_' + id(), role, text, t: Date.now() };
  s.messages.push(m);
  return m;
}

export function getHistory(sessionId: string) {
  const s = SESSIONS.get(sessionId);
  if (!s) return [] as Message[];
  return s.messages.slice();
}

export function endSession(sessionId: string) {
  return SESSIONS.delete(sessionId);
}

// --- New: ASCII 4-byte encoding + colorize helpers ---

function md5First4BytesHex(ch: string): string {
  // return first 4 bytes (8 hex chars) of md5 of the char
  const h = crypto.createHash('md5').update(ch).digest('hex');
  return h.slice(0, 8);
}

export function encodeAscii4(text: string): { ch: string; hex4: string }[] {
  const out: { ch: string; hex4: string }[] = [];
  for (const ch of text) {
    out.push({ ch, hex4: md5First4BytesHex(ch) });
  }
  return out;
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return { r, g, b };
}

function byteToColor(b: number) {
  // map single byte [0..255] to a color by expanding into RGB via simple transform
  const r = (b * 3) % 256;
  const g = (b * 7) % 256;
  const b2 = (b * 13) % 256;
  return { r, g, b: b2 };
}

export function colorizeAscii4(text: string): string {
  // returns ANSI colored string: for each char produce a colored block based on its 4-byte hex
  const parts: string[] = [];
  for (const ch of text) {
    const hex4 = md5First4BytesHex(ch); // 8 hex chars
    // split into 4 bytes
    const bytes: number[] = [];
    for (let i = 0; i < 8; i += 2) bytes.push(parseInt(hex4.slice(i, i+2), 16));
    // pick a representative color from bytes
    const col = byteToColor(bytes[0]);
    const ansi = `\x1b[48;2;${col.r};${col.g};${col.b}m\x1b[38;2;0;0;0m ${ch} \x1b[0m`;
    parts.push(ansi);
  }
  return parts.join('');
}

export default { startSession, sendMessage, getHistory, endSession, encodeAscii4, colorizeAscii4 };
