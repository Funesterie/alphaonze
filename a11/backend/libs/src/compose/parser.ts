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

const COMPOSE_CANDIDATES = [
  'qflush.fcl',
  'qflush.yml',
  'qflush.yaml',
  'funesterie.fcl',
  'funesterie.yml',
  'funesterie.yaml',
];

function findComposeFile(file?: string): string | null {
  if (file) return fs.existsSync(file) ? file : null;
  return COMPOSE_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || null;
}

function fclToCompose(file: string): ComposeFile | null {
  const fcl = readFCL(file);
  if (!fcl || !fcl.service) return null;
  const modules: Record<string, ModuleDef> = {};
  for (const k of Object.keys(fcl.service)) {
    const s = fcl.service[k];
    modules[k] = { path: s.path, port: s.port, token: s.token, env: s.env };
  }
  return { modules };
}

export function readCompose(file?: string): ComposeFile | null {
  try {
    const composeFile = findComposeFile(file);
    if (!composeFile) return null;
    if (/\.fcl$/i.test(composeFile)) return fclToCompose(composeFile);
    const raw = fs.readFileSync(composeFile, 'utf8');
    const doc = yaml.load(raw) as any;
    if (!doc || !doc.modules) return null;
    return { modules: doc.modules } as ComposeFile;
  } catch (err) {
    return null;
  }
}
