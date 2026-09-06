import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildDoctorReport, probeDoctorEndpoint } from "../commands/doctor.js";

describe("qflush CLI and doctor", () => {
  it("publishes qflush and qf through the shebang CLI wrapper", () => {
    const packageRoot = path.resolve(__dirname, "../..");
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
    const cli = fs.readFileSync(path.join(packageRoot, "src", "cli.ts"), "utf8");

    expect(pkg.bin).toEqual({
      qflush: "dist/cli.js",
      qf: "dist/cli.js",
    });
    expect(cli.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  it("builds a secret-safe diagnostic with explicit voice fallback state", () => {
    const report = buildDoctorReport({
      nodeVersion: "v22.0.0",
      modules: {
        qflush: { installed: true, running: true, path: "D:/qflush" },
      },
      checks: {
        daemon: true,
        mcp: true,
        sources: true,
        capture: true,
        inputBridge: true,
        elevenLabs: false,
        rvc: true,
        personaVivy: true,
        d40: true,
        suno: true,
        xttsFallbackEnabled: true,
      },
    });

    expect(report.ok).toBe(false);
    expect(report.problem).toBe("voice_route_fallback");
    expect(report.expected).toBe("elevenlabs-rvc-persona");
    expect(report.actual).toBe("xtts-rvc");
    expect(report.where).toBe("composition.production");
    expect(JSON.stringify(report)).not.toMatch(/token_value|secret_value/i);
  });

  it("probes HTTPS doctor endpoints without passing them to the HTTP-only probe", async () => {
    const httpProbe = vi.fn(async () => true);
    const fetchImpl = vi.fn(async () => ({ ok: true }));

    await expect(probeDoctorEndpoint("https://mcp.funesterie.me/health", httpProbe, fetchImpl))
      .resolves.toBe(true);
    expect(httpProbe).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://mcp.funesterie.me/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("reports unavailable voice wiring instead of returning a null problem", () => {
    const report = buildDoctorReport({
      nodeVersion: "v22.0.0",
      modules: {},
      checks: {
        daemon: true,
        mcp: true,
        sources: true,
        capture: true,
        inputBridge: true,
        elevenLabs: false,
        rvc: false,
        personaVivy: false,
        d40: false,
        suno: false,
        xttsFallbackEnabled: false,
      },
    });

    expect(report.ok).toBe(false);
    expect(report.problem).toBe("voice_route_unavailable");
    expect(report.fix).toMatch(/ElevenLabs.*RVC.*Vivy/i);
  });
});
