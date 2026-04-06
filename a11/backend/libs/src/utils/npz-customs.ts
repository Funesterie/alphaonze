// ROME-TAG: 0x91FBE1

import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as alias from './alias.js';
const logger = alias.importUtil('@utils/logger') || alias.importUtil('./logger') || console;

export type ModuleDescriptor = {
  name: string;
  pkg?: string;
  cwd: string;
  requiredEnv?: string[];
  requiredFiles?: string[];
  requiredPorts?: number[];
};

export type CustomsIssue = {
  level: 'info' | 'warning' | 'block';
  code: string;
  message: string;
};

export type CustomsReport = {
  module: string;
  issues: CustomsIssue[];
};

export type CustomsScanner = (mod: ModuleDescriptor) => Promise<CustomsIssue[]>;

export const MODULES: ModuleDescriptor[] = [
  { name: 'freeland', pkg: '@funeste38/freeland', cwd: process.cwd(), requiredEnv: ['FREELAND_DB_URL'], requiredFiles: ['freeland.config.json'] },
  { name: 'bat', pkg: '@funeste38/bat', cwd: process.cwd(), requiredEnv: ['BAT_TOKEN'], requiredFiles: ['bat.config.json'] },
];

export const envScanner: CustomsScanner = async (mod) => {
  const issues: CustomsIssue[] = [];
  const required = mod.requiredEnv || [];
  for (const key of required) {
    if (!process.env[key]) {
      issues.push({ level: 'block', code: 'MISSING_ENV', message: `Missing env var: ${key}` });
    }
  }
  return issues;
};

export const fileScanner: CustomsScanner = async (mod) => {
  const issues: CustomsIssue[] = [];
  const required = mod.requiredFiles || [];
  for (const rel of required) {
    const full = path.join(mod.cwd, rel);
    if (!fs.existsSync(full)) {
      issues.push({ level: 'warning', code: 'MISSING_FILE', message: `Config file not found: ${rel}` });
    }
  }
  return issues;
};

function checkPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    server.listen(port, '127.0.0.1');
  });
}

export const portScanner: CustomsScanner = async (mod) => {
  const issues: CustomsIssue[] = [];
  const ports = mod.requiredPorts || [];
  for (const port of ports) {
    if (await checkPortInUse(port)) {
      issues.push({ level: 'block', code: 'PORT_IN_USE', message: `Port ${port} already in use` });
    }
  }
  return issues;
};

const SCANNERS: CustomsScanner[] = [envScanner, fileScanner, portScanner];

export async function runCustomsCheck(mod: ModuleDescriptor): Promise<CustomsReport> {
  const issues: CustomsIssue[] = [];
  for (const scanner of SCANNERS) {
    try {
      const res = await scanner(mod);
      if (res && res.length) issues.push(...res);
    } catch (err) {
      logger.warn(`customs: scanner error for ${mod.name} ${err}`);
    }
  }

  if (issues.length === 0) {
    logger.info(`[NPZ][CUSTOMS][PASS] ${mod.name} - all clear`);
  } else {
    for (const issue of issues) {
      const tag = issue.level.toUpperCase();
      if (issue.level === 'block') logger.warn(`[NPZ][CUSTOMS][${tag}] ${mod.name} - ${issue.message}`);
      else logger.info(`[NPZ][CUSTOMS][${tag}] ${mod.name} - ${issue.message}`);
    }
  }

  return { module: mod.name, issues };
}

export function hasBlockingIssues(report: CustomsReport): boolean {
  return report.issues.some((i) => i.level === 'block');
}

export default {
  MODULES,
  runCustomsCheck,
  hasBlockingIssues,
};
