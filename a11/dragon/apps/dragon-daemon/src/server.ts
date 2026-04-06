import express, {
  type NextFunction,
  type Request,
  type Response
} from "express";

import type {
  DragonDaemonPolicyPatch,
  DragonDaemonStatus
} from "@funeste38/dragon-contracts";

import {
  buildSystemSnapshot,
  getDragonDaemonStatus,
  loadDragonManifest,
  loadDragonDaemonPolicy,
  patchDragonDaemonPolicy,
  resolveDragonManifestPath,
  runDragonDaemonCycle
} from "@funeste38/dragon-upstream";

const port = Number(process.env.PORT ?? process.env.DRAGON_DAEMON_PORT ?? 4700);

const intents = [
  {
    id: "scan",
    route: "/api/scan",
    description: "Rescan canonical Dragon sources and summarize ecosystem readiness."
  },
  {
    id: "guard-status",
    route: "/api/daemon/status",
    description: "Expose the autonomous Dragon guard status, desired state and recent recoveries."
  },
  {
    id: "guard-policy",
    route: "/api/daemon/policy",
    description: "Update the desired state and auto-recovery policy for core Dragon services."
  },
  {
    id: "guard-cycle",
    route: "/api/daemon/cycle",
    description: "Force an immediate daemon reconciliation cycle."
  },
  {
    id: "targets",
    route: "/api/control-plane/targets",
    description: "List the chosen upstream targets for Dragon services."
  }
];

async function main(): Promise<void> {
  const manifestPath = await resolveDragonManifestPath();
  const app = express();
  let currentStatus = await getDragonDaemonStatus(manifestPath);
  let currentPolicy = await loadDragonDaemonPolicy(manifestPath);
  let cycleTimer: NodeJS.Timeout | undefined;
  let cycleInFlight: Promise<DragonDaemonStatus> | null = null;

  function scheduleNextCycle(): void {
    if (cycleTimer) {
      clearTimeout(cycleTimer);
    }

    cycleTimer = setTimeout(() => {
      void runCycle("auto").catch((error) => {
        console.error("[dragon-daemon] cycle failed", error);
        scheduleNextCycle();
      });
    }, currentPolicy.pollIntervalMs);
  }

  async function runCycle(origin: "auto" | "manual" = "auto"): Promise<DragonDaemonStatus> {
    if (cycleInFlight) {
      return await cycleInFlight;
    }

    cycleInFlight = (async () => {
      currentStatus = await runDragonDaemonCycle(origin, manifestPath);
      currentPolicy = await loadDragonDaemonPolicy(manifestPath);
      scheduleNextCycle();
      return currentStatus;
    })();

    try {
      return await cycleInFlight;
    } finally {
      cycleInFlight = null;
    }
  }

  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      service: "dragon-daemon",
      status: "ok",
      port,
      manifestPath,
      guard: {
        enabled: currentStatus.enabled,
        pollIntervalMs: currentStatus.pollIntervalMs,
        cycleCount: currentStatus.cycleCount,
        lastCycleAt: currentStatus.lastCycleAt ?? null
      },
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api/control-plane", async (_req, res, next) => {
    try {
      const snapshot = await buildSystemSnapshot(manifestPath);
      res.json({
        service: "dragon-daemon",
        phase: "phase-2-autonomous-guard",
        summary: snapshot.summary,
        intents,
        daemon: currentStatus,
        responsibilities: [
          "desired-state supervision",
          "ecosystem probing",
          "auto-recovery for qflush/A11/Cerbere",
          "future orchestration policy routing"
        ]
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/scan", async (_req, res, next) => {
    try {
      res.json(await buildSystemSnapshot(manifestPath));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/control-plane/targets", async (_req, res, next) => {
    try {
      const manifest = await loadDragonManifest(manifestPath);
      res.json({
        generatedAt: new Date().toISOString(),
        targets: manifest.target_stack
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/daemon/status", async (_req, res, next) => {
    try {
      currentStatus = await getDragonDaemonStatus(manifestPath);
      res.json(currentStatus);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/daemon/cycle", async (_req, res, next) => {
    try {
      res.json(await runCycle("manual"));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/daemon/policy", async (req, res, next) => {
    try {
      currentPolicy = await patchDragonDaemonPolicy(req.body as DragonDaemonPolicyPatch, manifestPath);
      currentStatus = await getDragonDaemonStatus(manifestPath);
      scheduleNextCycle();
      res.json({
        policy: currentPolicy,
        status: currentStatus
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      service: "dragon-daemon",
      status: "error",
      message
    });
  });

  app.listen(port, () => {
    console.log(`[dragon-daemon] listening on http://127.0.0.1:${port}`);
  });

  currentStatus = await runCycle("manual");
}

void main();
