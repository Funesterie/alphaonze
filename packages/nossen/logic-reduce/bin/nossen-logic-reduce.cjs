#!/usr/bin/env node
'use strict';

const { formatReducedPlan, logicReduce } = require('../src/index.cjs');

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return '';
  return args[index + 1] || '';
}

function usage() {
  return [
    'Usage:',
    '  nossen-logic-reduce --steps "A + timeout retry + verify + C"',
    '  nossen-logic-reduce --objective "Fix route" --steps "scan + patch + test"',
    '  nossen-logic-reduce --json --steps "A + failed detour + B"'
  ].join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const objective = valueAfter(args, '--objective');
  const explicitSteps = valueAfter(args, '--steps');
  const steps = explicitSteps || args.filter((arg) => !arg.startsWith('--')).join(' ');

  if (!steps) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const result = logicReduce(steps, { objective });
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(formatReducedPlan(result));
  }
}

main();
