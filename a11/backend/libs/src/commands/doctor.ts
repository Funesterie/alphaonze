import { logger } from '../utils/logger.js';
import { detectModules } from '../utils/detect.js';
import { httpProbe } from '../utils/health.js';
import { SERVICE_MAP } from '../utils/paths.js';
import { ensurePackageInstalled } from '../utils/exec.js';

type DoctorModule = {
  installed?: boolean;
  running?: boolean;
  path?: string | null;
  bin?: string | null;
};

type DoctorChecks = {
  daemon: boolean;
  mcp: boolean;
  sources: boolean;
  capture: boolean;
  inputBridge: boolean;
  elevenLabs: boolean;
  rvc: boolean;
  personaVivy: boolean;
  d40: boolean;
  suno: boolean;
  xttsFallbackEnabled: boolean;
};

export function buildDoctorReport(input: {
  nodeVersion: string;
  modules: Record<string, DoctorModule>;
  checks: DoctorChecks;
}) {
  const voiceFallback = !input.checks.elevenLabs
    && input.checks.rvc
    && input.checks.xttsFallbackEnabled;
  const voiceReady = input.checks.elevenLabs
    && input.checks.rvc
    && input.checks.personaVivy;
  const requiredChecks = [
    input.checks.daemon,
    input.checks.mcp,
    input.checks.sources,
    input.checks.capture,
    input.checks.inputBridge,
    input.checks.personaVivy,
    input.checks.d40,
  ];
  return {
    ok: requiredChecks.every(Boolean) && voiceReady && !voiceFallback,
    problem: voiceFallback
      ? 'voice_route_fallback'
      : (!voiceReady ? 'voice_route_unavailable' : null),
    expected: 'elevenlabs-rvc-persona',
    actual: voiceFallback ? 'xtts-rvc' : (voiceReady ? 'elevenlabs-rvc-persona' : 'unavailable'),
    where: 'composition.production',
    fix: voiceFallback
      ? 'Check ElevenLabs configuration or the composition voice route mapping.'
      : (!voiceReady ? 'Load the ElevenLabs, RVC, and Vivy persona configuration before starting composition.' : null),
    nodeVersion: input.nodeVersion,
    modules: input.modules,
    checks: input.checks,
  };
}

function envPresent(...names: string[]) {
  return names.some((name) => Boolean(String(process.env[name] || '').trim()));
}

function envEnabled(name: string) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || '').trim());
}

export async function probeDoctorEndpoint(
  url: string,
  probe: (target: string, timeout?: number) => Promise<boolean> = httpProbe,
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs = 1200
) {
  if (!/^https:/i.test(url)) return probe(url, timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function runDoctor(argv: string[] = []) {
  const fix = argv.includes('--fix') || argv.includes('-f');
  const json = argv.includes('--json');

  if (!json) logger.info('qflush: running doctor checks...');
  const detected = await detectModules();
  if (!json) {
    for (const k of Object.keys(detected)) {
      const v = detected[k];
      logger.info(`${k}: installed=${v.installed} running=${v.running} path=${v.path || 'n/a'}`);
      if (v.bin && v.path) {
        logger.info(`  bin: ${v.bin}`);
      }
    }
  }

  const daemonUrl = String(process.env.QFLUSH_URL || process.env.QFLUSH_DAEMON_URL || 'http://127.0.0.1:3000').trim();
  const mcpUrl = String(process.env.QFLUSH_MCP_URL || process.env.A11_MCP_URL || 'https://mcp.funesterie.me/health').trim();
  const [daemon, mcp] = await Promise.all([
    probeDoctorEndpoint(daemonUrl, httpProbe, globalThis.fetch, 800),
    probeDoctorEndpoint(mcpUrl, httpProbe, globalThis.fetch, 1200),
  ]);
  const report = buildDoctorReport({
    nodeVersion: process.version,
    modules: detected,
    checks: {
      daemon,
      mcp,
      sources: envPresent('QFLUSH_DESKTOP_CONTROL_SCRIPT', 'AGENT_STATE_DIR') || process.platform === 'win32',
      capture: envPresent('QFLUSH_DESKTOP_CONTROL_SCRIPT') || process.platform === 'win32',
      inputBridge: envPresent('QFLUSH_DESKTOP_CONTROL_SCRIPT') || process.platform === 'win32',
      elevenLabs: envPresent('VIVY_ELEVENLABS_API_KEY', 'A11_ELEVENLABS_API_KEY', 'ELEVENLABS_API_KEY', 'XI_API_KEY'),
      rvc: envPresent('A11_VOICE_XTTS_RVC_URL', 'A11_XTTS_RVC_URL', 'A11_VOICE_CONVERSION_URL'),
      personaVivy: envPresent('A11_VIVY_VOICE_REFERENCE', 'VIVY_VOICE_REFERENCE', 'A11_VOICE_REFERENCE_DIR'),
      d40: envPresent('A11_D40_URL', 'D40_URL', 'A11_API_URL'),
      suno: envPresent('VIVY_SUNO_API_KEY', 'SUNO_API_KEY'),
      xttsFallbackEnabled: envEnabled('A11_TTS_ALLOW_XTTS_RVC_AUTO'),
    },
  });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    logger.info(`Node version: ${process.version}`);
    logger.info(`QFlush daemon reachable: ${daemon}`);
    logger.info(`MCP endpoint reachable: ${mcp}`);
    logger.info(`Voice route: requested=${report.expected} actual=${report.actual}`);
    if (report.problem) logger.warn(`${report.problem}: ${report.fix}`);
  }

  if (fix) {
    logger.info('Doctor fix: attempting to install missing Funeste38 packages...');
    for (const name of Object.keys(SERVICE_MAP)) {
      const pkg = SERVICE_MAP[name].pkg;
      const detectedInfo = detected[name];
      if (!detectedInfo || !detectedInfo.installed) {
        logger.info(`Installing ${pkg} for service ${name}...`);
        const ok = ensurePackageInstalled(pkg);
        if (ok) logger.success(`Installed ${pkg}`);
        else logger.warn(`Failed to install ${pkg}`);
      } else {
        logger.info(`${pkg} already installed`);
      }
    }
  }

  if (!json) logger.info('Doctor checks complete');
  return report;
}
