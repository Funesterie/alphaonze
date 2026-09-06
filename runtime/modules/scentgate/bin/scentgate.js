#!/usr/bin/env node
import { createScentGateCapsule, describeScentGate, renderScentGateCapsule } from '../index.js';

function parseArgs(argv) {
  const input = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [flag, inline] = token.split('=', 2);
    const hasInline = inline !== undefined;
    const value = hasInline ? inline : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');

    switch (flag) {
      case '--mission':
        input.mission = value;
        break;
      case '--alias':
        input.alias = [...(Array.isArray(input.alias) ? input.alias : []), value];
        break;
      case '--hint':
      case '--corpus-hint':
        input.corpusHints = [...(Array.isArray(input.corpusHints) ? input.corpusHints : []), value];
        break;
      case '--sha':
      case '--sha-ref':
        input.shaRefs = [...(Array.isArray(input.shaRefs) ? input.shaRefs : []), value];
        break;
      case '--lane':
        input.laneHints = [...(Array.isArray(input.laneHints) ? input.laneHints : []), value];
        break;
      case '--scope':
        input.scope = value;
        break;
      case '--operator':
        input.operator = value;
        break;
      case '--audit-tag':
        input.auditTag = value;
        break;
      case '--ticket':
      case '--ticket-id':
        input.ticketId = value;
        break;
      case '--ttl':
      case '--ttl-minutes':
        input.ttlMinutes = value;
        break;
      case '--max-docs':
        input.maxDocs = value;
        break;
      case '--max-bytes':
        input.maxBytes = value;
        break;
      default:
        break;
    }
  }
  return input;
}

async function readStdinJson() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = chunks.join('').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write([
      'ScentGate Capsule',
      '',
      'Usage:',
      '  scentgate [--mission "..."] [--alias "..."] [--hint "..."] [--sha "..."] [--lane "..."]',
      '',
      'Examples:',
      '  scentgate --mission "multi-corpus investigation" --alias PortalCake --ttl 15',
      '  echo "{\\"mission\\":\\"research\\"}" | scentgate',
      '',
      'Aliases:',
      '  PortalCake, CakeIsReal, CakeIsALie',
      '',
      describeScentGate()
    ].join('\n') + '\n');
    return;
  }

  const cliInput = parseArgs(argv);
  const stdinInput = await readStdinJson();
  const capsule = createScentGateCapsule({ ...(stdinInput || {}), ...cliInput });
  process.stdout.write(renderScentGateCapsule(capsule) + '\n');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
