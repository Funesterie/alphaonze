import path from "node:path";

import type {
  CanonicalSource,
  DragonActionExecution,
  DragonIntegrationAction,
  DragonIntegrationCatalog,
  DragonIntegrationTarget,
  DragonManifest,
  HealthState,
  UpstreamProbe
} from "@funeste38/dragon-contracts";

import {
  A11_PORT,
  CERBERE_PORT,
  MAX_WAIT_START_MS,
  MAX_WAIT_STOP_MS,
  clearManagedServiceState,
  findListeningProcessId,
  pathExists,
  readManagedServiceState,
  runNpmScript,
  runProjectCommand,
  runTaskKill,
  sleep,
  spawnDetachedNodeProcess,
  writeManagedServiceState
} from "./state.js";
import {
  buildSystemSnapshot,
  fetchJson,
  findBackingSourceByTarget,
  findCanonicalSourceByTarget,
  getBaseUrlFromHealthUrl,
  getCerbereScriptPath,
  loadDragonManifest,
  probeCanonicalSource,
  probeCerbereSource,
  resolveDragonManifestPath,
  waitForCanonicalSourceHealth
} from "./snapshot.js";

const INTEGRATION_ACTIONS: DragonIntegrationAction[] = [
  {
    id: "dragon.recover-core",
    target: "dragon",
    kind: "workflow",
    label: "Dragon Recover Core",
    description: "Recover qflush, A11 and Cerbere, then verify the runtime chain."
  },
  {
    id: "dragon.boot-stack",
    target: "dragon",
    kind: "workflow",
    label: "Dragon Boot Stack",
    description: "Build qflush, start qflush, then bring up A11 and Cerbere."
  },
  {
    id: "dragon.snapshot-all",
    target: "dragon",
    kind: "workflow",
    label: "Dragon Snapshot All",
    description: "Capture qflush, A11 and Cerbere runtime state through one workflow."
  },
  {
    id: "qflush.health",
    target: "qflush",
    kind: "http",
    label: "Qflush Health",
    description: "Probe the qflush daemon health endpoint."
  },
  {
    id: "qflush.rome-index",
    target: "qflush",
    kind: "http",
    label: "Qflush Rome Index",
    description: "Fetch the live Rome index exposed by qflush."
  },
  {
    id: "qflush.rome-links",
    target: "qflush",
    kind: "command",
    label: "Qflush Rome Links",
    description: "Rebuild the Rome links inventory through qflush."
  },
  {
    id: "qflush.status",
    target: "qflush",
    kind: "command",
    label: "Qflush Status",
    description: "Run the qflush daemon status command."
  },
  {
    id: "qflush.build",
    target: "qflush",
    kind: "command",
    label: "Qflush Build",
    description: "Rebuild qflush dist artifacts from source."
  },
  {
    id: "qflush.start",
    target: "qflush",
    kind: "command",
    label: "Qflush Start",
    description: "Spawn the qflush daemon in detached mode."
  },
  {
    id: "qflush.stop",
    target: "qflush",
    kind: "command",
    label: "Qflush Stop",
    description: "Stop the qflush daemon."
  },
  {
    id: "qflush.restart",
    target: "qflush",
    kind: "workflow",
    label: "Qflush Restart",
    description: "Restart the qflush daemon and wait for readiness."
  },
  {
    id: "a11.health",
    target: "a11",
    kind: "http",
    label: "A11 Health",
    description: "Probe the primary A11 backend health endpoint."
  },
  {
    id: "a11.start",
    target: "a11",
    kind: "command",
    label: "A11 Start",
    description: "Start the A11 backend in detached mode."
  },
  {
    id: "a11.stop",
    target: "a11",
    kind: "command",
    label: "A11 Stop",
    description: "Stop the A11 backend process managed by Dragon."
  },
  {
    id: "a11.restart",
    target: "a11",
    kind: "workflow",
    label: "A11 Restart",
    description: "Restart the A11 backend and wait for readiness."
  },
  {
    id: "a11.memo-list",
    target: "a11",
    kind: "http",
    label: "A11 Memo Index",
    description: "Fetch the persisted A11 memo index."
  },
  {
    id: "a11.llm-stats",
    target: "a11",
    kind: "http",
    label: "A11 LLM Stats",
    description: "Fetch the current A11 LLM router statistics."
  },
  {
    id: "a11.memo-snapshot-qflush",
    target: "a11",
    kind: "http",
    label: "A11 Memo Snapshot",
    description: "Ask A11 to persist a fresh qflush snapshot memo."
  },
  {
    id: "cerbere.health",
    target: "cerbere",
    kind: "http",
    label: "Cerbere Health",
    description: "Probe the Cerbere LLM router health endpoint."
  },
  {
    id: "cerbere.stats",
    target: "cerbere",
    kind: "http",
    label: "Cerbere Stats",
    description: "Fetch the Cerbere router statistics directly."
  },
  {
    id: "cerbere.start",
    target: "cerbere",
    kind: "command",
    label: "Cerbere Start",
    description: "Start the Cerbere router in detached mode."
  },
  {
    id: "cerbere.stop",
    target: "cerbere",
    kind: "command",
    label: "Cerbere Stop",
    description: "Stop the Cerbere process managed by Dragon."
  },
  {
    id: "cerbere.restart",
    target: "cerbere",
    kind: "workflow",
    label: "Cerbere Restart",
    description: "Restart the Cerbere router and wait for readiness."
  }
];

function buildWorkflowResult(
  actionId: string,
  target: DragonIntegrationTarget,
  steps: DragonActionExecution[],
  detail: string,
  data?: unknown
): DragonActionExecution {
  return {
    actionId,
    target,
    ok: steps.every((step) => step.ok),
    ranAt: new Date().toISOString(),
    detail,
    steps,
    data
  };
}

async function executeHttpAction(
  actionId: string,
  target: Exclude<DragonIntegrationTarget, "dragon">,
  probe: UpstreamProbe
): Promise<DragonActionExecution> {
  if (actionId.endsWith(".health")) {
    return {
      actionId,
      target,
      ok: probe.healthState === "available",
      ranAt: new Date().toISOString(),
      detail: probe.healthDetail,
      resolvedUrl: probe.healthUrl
    };
  }

  const baseUrl = getBaseUrlFromHealthUrl(probe.healthUrl);
  if (!baseUrl) {
    return {
      actionId,
      target,
      ok: false,
      ranAt: new Date().toISOString(),
      detail: "Base URL is not available",
      resolvedUrl: probe.healthUrl
    };
  }

  let resolvedUrl = "";
  let init: RequestInit | undefined;

  if (actionId === "qflush.rome-index") {
    resolvedUrl = `${baseUrl}/npz/rome-index`;
  } else if (actionId === "a11.memo-list") {
    resolvedUrl = `${baseUrl}/api/a11/memo/all`;
  } else if (actionId === "a11.llm-stats") {
    resolvedUrl = `${baseUrl}/api/llm/stats`;
  } else if (actionId === "a11.memo-snapshot-qflush") {
    resolvedUrl = `${baseUrl}/api/a11/memo/snapshot/qflush`;
    init = { method: "POST" };
  } else if (actionId === "cerbere.stats") {
    resolvedUrl = `${baseUrl}/api/stats`;
  } else {
    return {
      actionId,
      target,
      ok: false,
      ranAt: new Date().toISOString(),
      detail: "Unsupported HTTP action",
      resolvedUrl: probe.healthUrl
    };
  }

  const response = await fetchJson(resolvedUrl, init);
  return {
    actionId,
    target,
    ok: response.ok,
    ranAt: new Date().toISOString(),
    detail: response.detail,
    resolvedUrl,
    data: response.data
  };
}

async function waitForCerbereHealth(
  manifest: DragonManifest,
  targetState: HealthState,
  timeoutMs: number,
  manifestPath: string,
  intervalMs = 500
): Promise<UpstreamProbe | undefined> {
  const startedAt = Date.now();
  let lastProbe = await probeCerbereSource(manifest, manifestPath);

  while (Date.now() - startedAt < timeoutMs) {
    if (lastProbe?.healthState === targetState) {
      return lastProbe;
    }

    await sleep(intervalMs);
    lastProbe = await probeCerbereSource(manifest, manifestPath);
  }

  return lastProbe;
}

async function executeQflushAction(
  actionId: string,
  source: CanonicalSource,
  manifestPath: string
): Promise<DragonActionExecution> {
  if (actionId === "qflush.status") {
    return await runNpmScript(source.path, "daemon:status", "qflush", actionId);
  }

  if (actionId === "qflush.rome-links") {
    return await runProjectCommand(source.path, "node ./dist/index.js rome:links", "qflush", actionId);
  }

  if (actionId === "qflush.build") {
    return await runNpmScript(source.path, "build", "qflush", actionId);
  }

  if (actionId === "qflush.start") {
    const preflight = await probeCanonicalSource(source, manifestPath);
    if (preflight.healthState === "available") {
      return {
        actionId,
        target: "qflush",
        ok: true,
        ranAt: new Date().toISOString(),
        detail: "Qflush is already reachable.",
        resolvedUrl: preflight.healthUrl
      };
    }

    const result = await runNpmScript(source.path, "daemon:spawn", "qflush", actionId);
    const probe = await waitForCanonicalSourceHealth(source, "available", MAX_WAIT_START_MS, manifestPath);
    return {
      ...result,
      actionId,
      target: "qflush",
      ok: probe.healthState === "available",
      detail:
        probe.healthState === "available"
          ? "Qflush is reachable after start."
          : `${result.detail}. Qflush health after start: ${probe.healthDetail}`,
      resolvedUrl: probe.healthUrl
    };
  }

  if (actionId === "qflush.stop") {
    const preflight = await probeCanonicalSource(source, manifestPath);
    if (preflight.healthState !== "available" && !preflight.processId) {
      return {
        actionId,
        target: "qflush",
        ok: true,
        ranAt: new Date().toISOString(),
        detail: "Qflush is already stopped.",
        resolvedUrl: preflight.healthUrl
      };
    }

    const result = await runNpmScript(source.path, "daemon:stop", "qflush", actionId);
    const probe = await waitForCanonicalSourceHealth(source, "unavailable", MAX_WAIT_STOP_MS, manifestPath);
    return {
      ...result,
      actionId,
      target: "qflush",
      ok: probe.healthState !== "available",
      detail:
        probe.healthState !== "available"
          ? "Stop command completed and qflush is no longer reachable."
          : `${result.detail}. Qflush health after stop: ${probe.healthDetail}`,
      resolvedUrl: probe.healthUrl
    };
  }

  if (actionId === "qflush.restart") {
    const stopResult = await executeQflushAction("qflush.stop", source, manifestPath);
    const startResult = await executeQflushAction("qflush.start", source, manifestPath);
    return buildWorkflowResult(actionId, "qflush", [stopResult, startResult], "Qflush restart workflow completed.", {
      finalProbe: await probeCanonicalSource(source, manifestPath)
    });
  }

  return await executeHttpAction(actionId, "qflush", await probeCanonicalSource(source, manifestPath));
}

async function executeA11Action(
  actionId: string,
  source: CanonicalSource,
  manifestPath: string
): Promise<DragonActionExecution> {
  if (actionId === "a11.start") {
    const preflight = await probeCanonicalSource(source, manifestPath);
    if (preflight.healthState === "available") {
      await writeManagedServiceState(
        "a11",
        {
          target: "a11",
          projectPath: source.path,
          command: [process.execPath, "apps/server/server.cjs"],
          pid: preflight.processId,
          port: preflight.port ?? A11_PORT,
          healthUrl: preflight.healthUrl,
          status: "ready",
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        manifestPath
      );

      return {
        actionId,
        target: "a11",
        ok: true,
        ranAt: new Date().toISOString(),
        detail: "A11 is already reachable.",
        resolvedUrl: preflight.healthUrl
      };
    }

    const startedAt = new Date().toISOString();

    try {
      const pid = await spawnDetachedNodeProcess(
        source.path,
        ["apps/server/server.cjs"],
        path.join(source.path, "logs", "stdout.log"),
        path.join(source.path, "logs", "stderr.log"),
        {
          PORT: String(A11_PORT),
          A11_WORKSPACE_ROOT: source.path,
          SERVE_STATIC: process.env.SERVE_STATIC ?? "false"
        }
      );

      await writeManagedServiceState(
        "a11",
        {
          target: "a11",
          projectPath: source.path,
          command: [process.execPath, "apps/server/server.cjs"],
          pid,
          port: A11_PORT,
          healthUrl: preflight.healthUrl ?? `http://127.0.0.1:${A11_PORT}/health`,
          status: "starting",
          startedAt,
          updatedAt: startedAt
        },
        manifestPath
      );

      const probe = await waitForCanonicalSourceHealth(source, "available", MAX_WAIT_START_MS, manifestPath);
      await writeManagedServiceState(
        "a11",
        {
          target: "a11",
          projectPath: source.path,
          command: [process.execPath, "apps/server/server.cjs"],
          pid: probe.processId ?? pid,
          port: probe.port ?? A11_PORT,
          healthUrl: probe.healthUrl,
          status: probe.healthState === "available" ? "ready" : "failed",
          startedAt,
          updatedAt: new Date().toISOString()
        },
        manifestPath
      );

      return {
        actionId,
        target: "a11",
        ok: probe.healthState === "available",
        ranAt: new Date().toISOString(),
        detail:
          probe.healthState === "available"
            ? `A11 is reachable on ${probe.healthUrl}.`
            : `A11 did not become healthy in time: ${probe.healthDetail}`,
        resolvedUrl: probe.healthUrl
      };
    } catch (error) {
      await writeManagedServiceState(
        "a11",
        {
          target: "a11",
          projectPath: source.path,
          command: [process.execPath, "apps/server/server.cjs"],
          port: A11_PORT,
          healthUrl: preflight.healthUrl ?? `http://127.0.0.1:${A11_PORT}/health`,
          status: "failed",
          startedAt,
          updatedAt: new Date().toISOString()
        },
        manifestPath
      );

      return {
        actionId,
        target: "a11",
        ok: false,
        ranAt: new Date().toISOString(),
        detail: error instanceof Error ? error.message : String(error),
        resolvedUrl: preflight.healthUrl
      };
    }
  }

  if (actionId === "a11.stop") {
    const state = await readManagedServiceState("a11", manifestPath);
    const preflight = await probeCanonicalSource(source, manifestPath);
    const processId = state?.pid ?? preflight.processId ?? (await findListeningProcessId(preflight.port ?? A11_PORT));

    if (!processId) {
      await clearManagedServiceState("a11", manifestPath);
      return {
        actionId,
        target: "a11",
        ok: true,
        ranAt: new Date().toISOString(),
        detail: "A11 is already stopped.",
        resolvedUrl: preflight.healthUrl
      };
    }

    await writeManagedServiceState(
      "a11",
      {
        target: "a11",
        projectPath: source.path,
        command: state?.command ?? [process.execPath, "apps/server/server.cjs"],
        pid: processId,
        port: preflight.port ?? A11_PORT,
        healthUrl: preflight.healthUrl,
        status: "stopping",
        startedAt: state?.startedAt,
        updatedAt: new Date().toISOString()
      },
      manifestPath
    );

    const killResult = await runTaskKill(processId);
    const probe = await waitForCanonicalSourceHealth(source, "unavailable", MAX_WAIT_STOP_MS, manifestPath);

    if (probe.healthState !== "available") {
      await clearManagedServiceState("a11", manifestPath);
      return {
        actionId,
        target: "a11",
        ok: true,
        ranAt: new Date().toISOString(),
        detail: "A11 stopped and is no longer reachable.",
        resolvedUrl: probe.healthUrl,
        stdout: killResult.stdout,
        stderr: killResult.stderr
      };
    }

    return {
      actionId,
      target: "a11",
      ok: false,
      ranAt: new Date().toISOString(),
      detail: `A11 health after stop: ${probe.healthDetail}`,
      resolvedUrl: probe.healthUrl,
      stdout: killResult.stdout,
      stderr: killResult.stderr
    };
  }

  if (actionId === "a11.restart") {
    const stopResult = await executeA11Action("a11.stop", source, manifestPath);
    const startResult = await executeA11Action("a11.start", source, manifestPath);
    return buildWorkflowResult(actionId, "a11", [stopResult, startResult], "A11 restart workflow completed.", {
      finalProbe: await probeCanonicalSource(source, manifestPath)
    });
  }

  return await executeHttpAction(actionId, "a11", await probeCanonicalSource(source, manifestPath));
}

async function executeCerbereAction(
  actionId: string,
  source: CanonicalSource,
  manifest: DragonManifest,
  manifestPath: string
): Promise<DragonActionExecution> {
  const scriptPath = getCerbereScriptPath(source.path);

  if (actionId === "cerbere.start") {
    if (!(await pathExists(scriptPath))) {
      return {
        actionId,
        target: "cerbere",
        ok: false,
        ranAt: new Date().toISOString(),
        detail: `Cerbere script not found: ${scriptPath}`
      };
    }

    const preflight = await probeCerbereSource(manifest, manifestPath);
    if (preflight?.healthState === "available") {
      await writeManagedServiceState(
        "cerbere",
        {
          target: "cerbere",
          projectPath: source.path,
          command: [process.execPath, "apps/server/llm-router.mjs"],
          pid: preflight.processId,
          port: preflight.port ?? CERBERE_PORT,
          healthUrl: preflight.healthUrl,
          status: "ready",
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        manifestPath
      );

      return {
        actionId,
        target: "cerbere",
        ok: true,
        ranAt: new Date().toISOString(),
        detail: "Cerbere is already reachable.",
        resolvedUrl: preflight.healthUrl
      };
    }

    const startedAt = new Date().toISOString();

    try {
      const pid = await spawnDetachedNodeProcess(
        source.path,
        ["apps/server/llm-router.mjs"],
        path.join(source.path, "logs", "cerbere.out.log"),
        path.join(source.path, "logs", "cerbere.err.log"),
        {
          PORT: String(CERBERE_PORT),
          LLM_ROUTER_PORT: String(CERBERE_PORT),
          A11_WORKSPACE_ROOT: source.path
        }
      );

      await writeManagedServiceState(
        "cerbere",
        {
          target: "cerbere",
          projectPath: source.path,
          command: [process.execPath, "apps/server/llm-router.mjs"],
          pid,
          port: CERBERE_PORT,
          healthUrl: preflight?.healthUrl ?? `http://127.0.0.1:${CERBERE_PORT}/health`,
          status: "starting",
          startedAt,
          updatedAt: startedAt
        },
        manifestPath
      );

      const probe = await waitForCerbereHealth(manifest, "available", MAX_WAIT_START_MS, manifestPath);
      await writeManagedServiceState(
        "cerbere",
        {
          target: "cerbere",
          projectPath: source.path,
          command: [process.execPath, "apps/server/llm-router.mjs"],
          pid: probe?.processId ?? pid,
          port: probe?.port ?? CERBERE_PORT,
          healthUrl: probe?.healthUrl ?? `http://127.0.0.1:${CERBERE_PORT}/health`,
          status: probe?.healthState === "available" ? "ready" : "failed",
          startedAt,
          updatedAt: new Date().toISOString()
        },
        manifestPath
      );

      return {
        actionId,
        target: "cerbere",
        ok: probe?.healthState === "available",
        ranAt: new Date().toISOString(),
        detail:
          probe?.healthState === "available"
            ? `Cerbere is reachable on ${probe.healthUrl}.`
            : `Cerbere did not become healthy in time: ${probe?.healthDetail ?? "no probe available"}`,
        resolvedUrl: probe?.healthUrl
      };
    } catch (error) {
      await writeManagedServiceState(
        "cerbere",
        {
          target: "cerbere",
          projectPath: source.path,
          command: [process.execPath, "apps/server/llm-router.mjs"],
          port: CERBERE_PORT,
          healthUrl: preflight?.healthUrl ?? `http://127.0.0.1:${CERBERE_PORT}/health`,
          status: "failed",
          startedAt,
          updatedAt: new Date().toISOString()
        },
        manifestPath
      );

      return {
        actionId,
        target: "cerbere",
        ok: false,
        ranAt: new Date().toISOString(),
        detail: error instanceof Error ? error.message : String(error),
        resolvedUrl: preflight?.healthUrl
      };
    }
  }

  if (actionId === "cerbere.stop") {
    const state = await readManagedServiceState("cerbere", manifestPath);
    const preflight = await probeCerbereSource(manifest, manifestPath);
    const processId =
      state?.pid ?? preflight?.processId ?? (await findListeningProcessId(preflight?.port ?? CERBERE_PORT));

    if (!processId) {
      await clearManagedServiceState("cerbere", manifestPath);
      return {
        actionId,
        target: "cerbere",
        ok: true,
        ranAt: new Date().toISOString(),
        detail: "Cerbere is already stopped.",
        resolvedUrl: preflight?.healthUrl
      };
    }

    await writeManagedServiceState(
      "cerbere",
      {
        target: "cerbere",
        projectPath: source.path,
        command: state?.command ?? [process.execPath, "apps/server/llm-router.mjs"],
        pid: processId,
        port: preflight?.port ?? CERBERE_PORT,
        healthUrl: preflight?.healthUrl,
        status: "stopping",
        startedAt: state?.startedAt,
        updatedAt: new Date().toISOString()
      },
      manifestPath
    );

    const killResult = await runTaskKill(processId);
    const probe = await waitForCerbereHealth(manifest, "unavailable", MAX_WAIT_STOP_MS, manifestPath);

    if (probe?.healthState !== "available") {
      await clearManagedServiceState("cerbere", manifestPath);
      return {
        actionId,
        target: "cerbere",
        ok: true,
        ranAt: new Date().toISOString(),
        detail: "Cerbere stopped and is no longer reachable.",
        resolvedUrl: probe?.healthUrl,
        stdout: killResult.stdout,
        stderr: killResult.stderr
      };
    }

    return {
      actionId,
      target: "cerbere",
      ok: false,
      ranAt: new Date().toISOString(),
      detail: `Cerbere health after stop: ${probe.healthDetail}`,
      resolvedUrl: probe.healthUrl,
      stdout: killResult.stdout,
      stderr: killResult.stderr
    };
  }

  if (actionId === "cerbere.restart") {
    const stopResult = await executeCerbereAction("cerbere.stop", source, manifest, manifestPath);
    const startResult = await executeCerbereAction("cerbere.start", source, manifest, manifestPath);
    return buildWorkflowResult(actionId, "cerbere", [stopResult, startResult], "Cerbere restart workflow completed.", {
      finalProbe: await probeCerbereSource(manifest, manifestPath)
    });
  }

  const probe = await probeCerbereSource(manifest, manifestPath);
  if (!probe) {
    return {
      actionId,
      target: "cerbere",
      ok: false,
      ranAt: new Date().toISOString(),
      detail: "No backing source configured for Cerbere"
    };
  }

  return await executeHttpAction(actionId, "cerbere", probe);
}

async function executeDragonWorkflow(
  actionId: string,
  manifest: DragonManifest,
  manifestPath: string
): Promise<DragonActionExecution> {
  const qflushSource = findCanonicalSourceByTarget(manifest, "qflush");
  const a11Source = findCanonicalSourceByTarget(manifest, "a11");
  const cerbereSource = findBackingSourceByTarget(manifest, "cerbere");

  if (!qflushSource || !a11Source || !cerbereSource) {
    return {
      actionId,
      target: "dragon",
      ok: false,
      ranAt: new Date().toISOString(),
      detail: "Dragon workflows require qflush, A11 and Cerbere backing sources."
    };
  }

  const steps: DragonActionExecution[] = [];

  if (actionId === "dragon.snapshot-all") {
    steps.push(await executeQflushAction("qflush.status", qflushSource, manifestPath));
    steps.push(await executeHttpAction("qflush.rome-index", "qflush", await probeCanonicalSource(qflushSource, manifestPath)));
    steps.push(await executeHttpAction("a11.health", "a11", await probeCanonicalSource(a11Source, manifestPath)));
    steps.push(await executeHttpAction("cerbere.health", "cerbere", (await probeCerbereSource(manifest, manifestPath)) as UpstreamProbe));
    steps.push(await executeHttpAction("cerbere.stats", "cerbere", (await probeCerbereSource(manifest, manifestPath)) as UpstreamProbe));
    steps.push(await executeHttpAction("a11.memo-snapshot-qflush", "a11", await probeCanonicalSource(a11Source, manifestPath)));
    steps.push(await executeHttpAction("a11.memo-list", "a11", await probeCanonicalSource(a11Source, manifestPath)));
    steps.push(await executeHttpAction("a11.llm-stats", "a11", await probeCanonicalSource(a11Source, manifestPath)));
  } else if (actionId === "dragon.boot-stack") {
    steps.push(await executeQflushAction("qflush.build", qflushSource, manifestPath));
    steps.push(await executeQflushAction("qflush.start", qflushSource, manifestPath));
    steps.push(await executeA11Action("a11.start", a11Source, manifestPath));
    steps.push(await executeCerbereAction("cerbere.start", cerbereSource, manifest, manifestPath));
    steps.push(await executeQflushAction("qflush.status", qflushSource, manifestPath));
    steps.push(await executeHttpAction("cerbere.health", "cerbere", (await probeCerbereSource(manifest, manifestPath)) as UpstreamProbe));
    steps.push(await executeHttpAction("a11.health", "a11", await probeCanonicalSource(a11Source, manifestPath)));
    steps.push(await executeHttpAction("a11.llm-stats", "a11", await probeCanonicalSource(a11Source, manifestPath)));
  } else if (actionId === "dragon.recover-core") {
    const beforeQflush = await probeCanonicalSource(qflushSource, manifestPath);
    const beforeA11 = await probeCanonicalSource(a11Source, manifestPath);
    const beforeCerbere = await probeCerbereSource(manifest, manifestPath);

    if (beforeQflush.healthState !== "available") {
      steps.push(await executeQflushAction("qflush.build", qflushSource, manifestPath));
      steps.push(await executeQflushAction("qflush.start", qflushSource, manifestPath));
    } else {
      steps.push(await executeQflushAction("qflush.status", qflushSource, manifestPath));
    }

    steps.push(
      beforeA11.healthState !== "available"
        ? await executeA11Action("a11.start", a11Source, manifestPath)
        : await executeHttpAction("a11.health", "a11", beforeA11)
    );

    steps.push(
      beforeCerbere?.healthState !== "available"
        ? await executeCerbereAction("cerbere.start", cerbereSource, manifest, manifestPath)
        : await executeHttpAction("cerbere.health", "cerbere", beforeCerbere)
    );

    steps.push(await executeHttpAction("qflush.health", "qflush", await probeCanonicalSource(qflushSource, manifestPath)));
    steps.push(await executeHttpAction("a11.health", "a11", await probeCanonicalSource(a11Source, manifestPath)));
    const finalCerbereProbe = await probeCerbereSource(manifest, manifestPath);
    if (finalCerbereProbe) {
      steps.push(await executeHttpAction("cerbere.health", "cerbere", finalCerbereProbe));
    }
    steps.push(await executeHttpAction("a11.llm-stats", "a11", await probeCanonicalSource(a11Source, manifestPath)));

    return buildWorkflowResult(actionId, "dragon", steps, "Dragon recover workflow completed.", {
      before: { qflush: beforeQflush, a11: beforeA11, cerbere: beforeCerbere },
      finalSnapshot: await buildSystemSnapshot(manifestPath)
    });
  } else {
    return {
      actionId,
      target: "dragon",
      ok: false,
      ranAt: new Date().toISOString(),
      detail: "Workflow not implemented"
    };
  }

  return buildWorkflowResult(actionId, "dragon", steps, "Dragon workflow completed.", {
    finalSnapshot: await buildSystemSnapshot(manifestPath)
  });
}

export async function listIntegrationCatalog(manifestPath?: string): Promise<DragonIntegrationCatalog> {
  const resolvedManifestPath = manifestPath ?? (await resolveDragonManifestPath());
  const manifest = await loadDragonManifest(resolvedManifestPath);

  return {
    generatedAt: new Date().toISOString(),
    actions: await Promise.all(
      INTEGRATION_ACTIONS.map(async (action) => {
        if (action.target === "dragon") {
          return { ...action, available: true, path: manifest.workspace };
        }

        if (action.target === "cerbere") {
          const source = findBackingSourceByTarget(manifest, "cerbere");
          const targetPath = source ? getCerbereScriptPath(source.path) : undefined;
          return {
            ...action,
            available: Boolean(targetPath && (await pathExists(targetPath))),
            path: targetPath
          };
        }

        const source = findCanonicalSourceByTarget(manifest, action.target);
        return { ...action, available: Boolean(source?.path), path: source?.path };
      })
    )
  };
}

export async function executeIntegrationAction(
  actionId: string,
  manifestPath?: string
): Promise<DragonActionExecution> {
  const resolvedManifestPath = manifestPath ?? (await resolveDragonManifestPath());
  const manifest = await loadDragonManifest(resolvedManifestPath);
  const action = INTEGRATION_ACTIONS.find((entry) => entry.id === actionId);

  if (!action) {
    return {
      actionId,
      target: "dragon",
      ok: false,
      ranAt: new Date().toISOString(),
      detail: "Unknown action"
    };
  }

  if (action.target === "dragon") {
    return await executeDragonWorkflow(actionId, manifest, resolvedManifestPath);
  }

  if (action.target === "cerbere") {
    const source = findBackingSourceByTarget(manifest, "cerbere");
    if (!source) {
      return {
        actionId,
        target: "cerbere",
        ok: false,
        ranAt: new Date().toISOString(),
        detail: "No backing source configured for cerbere"
      };
    }

    if (!(await pathExists(source.path))) {
      return {
        actionId,
        target: "cerbere",
        ok: false,
        ranAt: new Date().toISOString(),
        detail: `Path not found: ${source.path}`
      };
    }

    return await executeCerbereAction(actionId, source, manifest, resolvedManifestPath);
  }

  const source = findCanonicalSourceByTarget(manifest, action.target);
  if (!source) {
    return {
      actionId,
      target: action.target,
      ok: false,
      ranAt: new Date().toISOString(),
      detail: `No canonical source configured for ${action.target}`
    };
  }

  if (!(await pathExists(source.path))) {
    return {
      actionId,
      target: action.target,
      ok: false,
      ranAt: new Date().toISOString(),
      detail: `Path not found: ${source.path}`
    };
  }

  return action.target === "qflush"
    ? await executeQflushAction(actionId, source, resolvedManifestPath)
    : await executeA11Action(actionId, source, resolvedManifestPath);
}
