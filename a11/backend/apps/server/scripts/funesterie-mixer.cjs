#!/usr/bin/env node
'use strict';

const {
  buildMarkdown,
  buildMixerRoute,
  buildMixerStatus,
  writeMixerArtifacts,
} = require('../lib/funesterie-mixer.cjs');

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    command: 'status',
    request: '',
    topN: 12,
    json: false,
    markdown: false,
    write: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (['status', 'route', 'plan', 'write'].includes(item)) {
      args.command = item;
    } else if (item === '--json') {
      args.json = true;
    } else if (item === '--markdown' || item === '--md') {
      args.markdown = true;
    } else if (item === '--write') {
      args.write = true;
    } else if (item === '--request' || item === '--query' || item === '--q') {
      args.request = String(argv[index + 1] || '');
      index += 1;
    } else if (item.startsWith('--request=')) {
      args.request = item.slice('--request='.length);
    } else if (item.startsWith('--query=')) {
      args.request = item.slice('--query='.length);
    } else if (item === '--top' || item === '--topN') {
      args.topN = Number(argv[index + 1] || 12);
      index += 1;
    } else if (item.startsWith('--top=')) {
      args.topN = Number(item.slice('--top='.length));
    }
  }

  return args;
}

function publicStatus(status) {
  return {
    ok: status.ok,
    schema: status.schema,
    id: status.id,
    name: status.name,
    generatedAt: status.generatedAt,
    runtimeRoot: status.runtimeRoot,
    summary: status.summary,
    defaultRoute: {
      intent: status.defaultRoute.intent,
      selection: status.defaultRoute.selection,
    },
    scoring: status.scoring,
    mcpContract: status.mcpContract,
  };
}

async function main() {
  const args = parseArgs();
  const route = buildMixerRoute({
    request: args.request,
    topN: args.topN,
  });

  if (args.command === 'write' || args.write) {
    const artifacts = await writeMixerArtifacts(route);
    console.log(JSON.stringify({
      ok: route.ok,
      generatedAt: route.generatedAt,
      artifacts,
      summary: route.summary,
      selection: route.selection,
    }, null, 2));
    process.exitCode = route.ok ? 0 : 1;
    return;
  }

  if (args.command === 'route' || args.command === 'plan') {
    if (args.markdown) {
      console.log(buildMarkdown(route));
    } else {
      console.log(JSON.stringify(route, null, 2));
    }
    process.exitCode = route.ok ? 0 : 1;
    return;
  }

  const status = buildMixerStatus({
    request: args.request,
    topN: args.topN,
  });

  if (args.markdown) {
    console.log(buildMarkdown(status));
  } else {
    console.log(JSON.stringify(args.json ? status : publicStatus(status), null, 2));
  }
  process.exitCode = status.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(`[FunesterieMixer] ${error?.message || error}`);
  process.exit(1);
});
