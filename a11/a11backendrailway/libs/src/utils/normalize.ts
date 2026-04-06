import * as fs from 'fs';

export function stripRomeTagLines(textOrBuffer: string | Buffer): string {
  const txt = Buffer.isBuffer(textOrBuffer) ? textOrBuffer.toString('utf8') : textOrBuffer;
  const lines = txt.split(/\r?\n/);
  const out = lines.filter(l => !/^\s*\/\/\s*ROME-TAG:/i.test(l));
  return out.join('\n');
}

export function stripRomeTagFromFile(filePath: string): string {
  const raw = fs.readFileSync(filePath, 'utf8');
  return stripRomeTagLines(raw);
}

export default { stripRomeTagLines, stripRomeTagFromFile };
