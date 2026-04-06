import * as fs from 'fs';
import yaml from 'js-yaml';
import { readFCL } from './fclParser.js';

export type ModuleDef = {
  path?: string;
  port?: number;
  token?: string;
  env?: Record<string,string>;
};

export type ComposeFile = {
  modules: Record<string, ModuleDef>;
};

export function readCompose(file = 'funesterie.yml'): ComposeFile | null {
  try {
    if (fs.existsSync('funesterie.fcl')) {
      const fcl = readFCL('funesterie.fcl');
      if (fcl && fcl.service) {
        const modules: Record<string, ModuleDef> = {};
        for (const k of Object.keys(fcl.service)) {
          const s = fcl.service[k];
          modules[k] = { path: s.path, port: s.port, token: s.token, env: s.env };
        }
        return { modules };
      }
    }
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    const doc = yaml.load(raw) as any;
    if (!doc || !doc.modules) return null;
    return { modules: doc.modules } as ComposeFile;
  } catch (err) {
    return null;
  }
}
