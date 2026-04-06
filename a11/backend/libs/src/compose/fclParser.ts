import * as fs from 'fs';

function parseValue(raw: string): any {
  const v = raw.trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    // simple list parser
    const inside = v.slice(1, -1).trim();
    if (!inside) return [];
    return inside.split(',').map(x => x.trim().replace(/^"|"$/g, ''));
  }
  if (/^\d+$/.test(v)) return Number(v);
  return v.replace(/^"|"$/g, '');
}

export function readFCL(file = 'funesterie.fcl') {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const lines = raw.split(/\r?\n/);
    const out: any = { project: {}, env: {}, service: {}, pipeline: {} };
    let current: { section?: string, name?: string } = {};
    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;
      if (line.startsWith('@')) {
        const parts = line.split(/\t|\s+/).filter(Boolean);
        const sec = parts[0].slice(1);
        const name = parts[1] || undefined;
        current = { section: sec, name };
        if (name) {
          if (!out[sec]) out[sec] = {};
          out[sec][name] = out[sec][name] || {};
        }
        continue;
      }
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const val = parseValue(line.slice(eq + 1));
      if (current.section) {
        if (current.name) {
          out[current.section][current.name][key] = val;
        } else {
          out[current.section][key] = val;
        }
      }
    }
    return out;
  } catch (err) {
    return null;
  }
}
