#!/usr/bin/env node
'use strict';

const {
  assembleChopper,
  buildChopperStatus,
  buildMarkdown,
  writeChopperArtifacts,
} = require('../lib/westside-chopper.cjs');

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    command: 'status',
    json: false,
    markdown: false,
    write: false,
    noRefresh: false,
  };

  for (const item of argv) {
    if (item === 'status' || item === 'plan' || item === 'doctor' || item === 'assemble' || item === 'rumble' || item === 'recipes') {
      args.command = item;
    } else if (item === '--json') {
      args.json = true;
    } else if (item === '--markdown' || item === '--md') {
      args.markdown = true;
    } else if (item === '--write') {
      args.write = true;
    } else if (item === '--no-refresh') {
      args.noRefresh = true;
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
    gates: status.gates,
    lanes: status.lanes,
    rumbleBalls: status.rumbleBalls,
    rumbleCombinations: status.rumbleCombinations,
    recipes: status.recipes.map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      ready: recipe.ready,
      status: recipe.status,
      combinationName: recipe.combinationName,
      commands: recipe.commands,
    })),
    doctor: {
      ok: status.doctor.ok,
      status: status.doctor.status,
      score: status.doctor.score,
      summary: status.doctor.summary,
    },
    actionPlan: status.actionPlan,
    modules: status.modules.map((moduleInfo) => ({
      id: moduleInfo.id,
      lane: moduleInfo.lane,
      installed: moduleInfo.installed,
      required: moduleInfo.required,
      version: moduleInfo.version,
      warnings: moduleInfo.warnings,
      guardrails: moduleInfo.guardrails || [],
    })),
  };
}

async function main() {
  const args = parseArgs();

  if (args.command === 'assemble') {
    const result = await assembleChopper({
      write: true,
      refreshIndex: !args.noRefresh,
    });
    console.log(JSON.stringify({
      ok: result.ok,
      generatedAt: result.generatedAt,
      artifacts: result.artifacts,
      summary: result.status.summary,
      steps: result.steps.map((step) => ({
        id: step.id,
        ok: step.result?.ok,
        status: step.result?.status ?? null,
      })),
    }, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  const status = buildChopperStatus();

  if (args.write || args.command === 'doctor') {
    const artifacts = await writeChopperArtifacts(status);
    if (args.command === 'doctor') {
      console.log(JSON.stringify({
        ok: status.ok,
        artifacts,
        summary: status.summary,
        doctor: status.doctor,
        requiredMissing: status.gates.requiredMissing,
        warnings: status.modules
          .filter((moduleInfo) => moduleInfo.warnings.length)
          .map((moduleInfo) => ({ id: moduleInfo.id, warnings: moduleInfo.warnings })),
        guardrails: status.modules
          .filter((moduleInfo) => moduleInfo.guardrails?.length)
          .map((moduleInfo) => ({ id: moduleInfo.id, guardrails: moduleInfo.guardrails })),
      }, null, 2));
      process.exitCode = status.ok ? 0 : 1;
      return;
    }
  }

  if (args.markdown) {
    console.log(buildMarkdown(status));
    process.exitCode = status.ok ? 0 : 1;
    return;
  }

  if (args.command === 'plan') {
    console.log(JSON.stringify({
      ok: status.ok,
      generatedAt: status.generatedAt,
      actionPlan: status.actionPlan,
      mcpContract: status.mcpContract,
    }, null, 2));
    process.exitCode = status.ok ? 0 : 1;
    return;
  }

  if (args.command === 'rumble') {
    console.log(JSON.stringify({
      ok: status.ok,
      generatedAt: status.generatedAt,
      summary: {
        rumbleBalls: status.summary.rumbleBalls,
        rumbleCombinations: status.summary.rumbleCombinations,
        rumbleReady: status.summary.rumbleReady,
      },
      rumbleBalls: status.rumbleBalls,
      rumbleCombinations: status.rumbleCombinations,
    }, null, 2));
    process.exitCode = status.ok ? 0 : 1;
    return;
  }

  if (args.command === 'recipes') {
    console.log(JSON.stringify({
      ok: status.ok,
      generatedAt: status.generatedAt,
      summary: {
        recipes: status.summary.rumbleRecipes,
        ready: status.summary.rumbleRecipesReady,
        doctorStatus: status.summary.doctorStatus,
        doctorScore: status.summary.doctorScore,
      },
      recipes: status.recipes,
    }, null, 2));
    process.exitCode = status.ok ? 0 : 1;
    return;
  }

  console.log(JSON.stringify(args.json ? status : publicStatus(status), null, 2));
  process.exitCode = status.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(`[WestSideChopper] ${error?.message || error}`);
  process.exit(1);
});
