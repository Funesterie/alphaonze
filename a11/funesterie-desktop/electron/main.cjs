'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');

const DEFAULT_PROFILE_ID = 'pc1-djeff';
const KNOWN_PROFILE_IDS = new Set(['pc1-djeff', 'pc2-maxence']);

let mainWindow = null;
let runtime = null;
let currentProfile = null;

function expandPath(input) {
  if (!input) return input;
  return String(input)
    .replace(/%USERPROFILE%/gi, process.env.USERPROFILE || '')
    .replace(/%APPDATA%/gi, process.env.APPDATA || '')
    .replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA || '');
}

function profileDir() {
  return path.join(app.getAppPath(), 'profiles');
}

function normalizeProfileId(profileId) {
  const value = String(profileId || '').trim().toLowerCase();
  return KNOWN_PROFILE_IDS.has(value) ? value : DEFAULT_PROFILE_ID;
}

function profileSelectionFile() {
  return path.join(app.getPath('userData'), 'profile-selection.json');
}

function readSavedProfileId() {
  try {
    const file = profileSelectionFile();
    if (!fs.existsSync(file)) return '';
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return normalizeProfileId(parsed?.profileId);
  } catch {
    return '';
  }
}

function readProfileMetadata(profileId) {
  try {
    const file = path.join(profileDir(), `${normalizeProfileId(profileId)}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function saveProfileId(profileId) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(profileSelectionFile(), JSON.stringify({
      profileId: normalizeProfileId(profileId),
      savedAt: new Date().toISOString()
    }, null, 2));
  } catch {
    // Profile persistence is a convenience; runtime must keep working without it.
  }
}

function detectMachineProfileId() {
  const fingerprint = [
    os.hostname(),
    process.env.COMPUTERNAME,
    process.env.USERNAME,
    process.env.USERPROFILE
  ].filter(Boolean).join(' ').toLowerCase();

  for (const profileId of KNOWN_PROFILE_IDS) {
    const profile = readProfileMetadata(profileId);
    const hints = [
      ...(Array.isArray(profile?.machineHints) ? profile.machineHints : []),
      ...(Array.isArray(profile?.hostHints) ? profile.hostHints : []),
      ...(Array.isArray(profile?.userHints) ? profile.userHints : [])
    ].map((value) => String(value).trim().toLowerCase()).filter(Boolean);
    if (hints.some((hint) => hint && fingerprint.includes(hint))) return profileId;
  }

  if (/\bpc2\b/.test(fingerprint) || fingerprint.includes('maxence')) return 'pc2-maxence';
  if (/\bpc1\b/.test(fingerprint) || fingerprint.includes('djeff') || fingerprint.includes('jeffrey')) return 'pc1-djeff';
  return '';
}

function resolveInitialProfileId() {
  const explicitProfile = process.env.FUNESTERIE_PROFILE_ID || process.env.FUNESTERIE_PROFILE;
  if (explicitProfile) return normalizeProfileId(explicitProfile);
  return detectMachineProfileId() || readSavedProfileId() || DEFAULT_PROFILE_ID;
}

function loadProfile(profileId = resolveInitialProfileId()) {
  const resolvedProfileId = normalizeProfileId(profileId);
  const file = path.join(profileDir(), `${resolvedProfileId}.json`);
  const raw = fs.readFileSync(file, 'utf8');
  const profile = JSON.parse(raw);
  profile.tokenFilePath = resolveTokenFile(profile);
  return profile;
}

function resolveTokenFile(profile) {
  const candidates = profile.tokenFileCandidates || [];
  for (const candidate of candidates) {
    const expanded = expandPath(candidate);
    if (expanded && fs.existsSync(expanded)) return expanded;
  }
  const first = candidates[0] ? expandPath(candidates[0]) : path.join(app.getPath('userData'), 'mcp-token.txt');
  return first;
}

function desktopRuntimeDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'desktop-runtime');
  return path.resolve(__dirname, '..', '..', 'backend', 'apps', 'server', 'src', 'desktop');
}

function requireDesktopModule(file, exportName) {
  const modPath = path.join(desktopRuntimeDir(), file);
  const mod = require(modPath);
  return mod[exportName];
}

function createRuntime(profile) {
  if (runtime) {
    try { runtime.mcpBridge?.stop?.(); } catch {}
    try { runtime.router?.stop?.(); } catch {}
    try { runtime.updater?.stop?.(); } catch {}
  }

  const McpBridge = requireDesktopModule('mcp-bridge.cjs', 'McpBridge');
  const AutoUpdater = requireDesktopModule('auto-updater.cjs', 'AutoUpdater');
  const LlmFallbackRouter = requireDesktopModule('llm-fallback-router.cjs', 'LlmFallbackRouter');

  const mcpBridge = new McpBridge({
    mcpUrl: profile.mcpUrl,
    mcpUrls: profile.mcpUrls,
    tokenFilePath: profile.tokenFilePath
  });
  const updater = new AutoUpdater({
    version: app.getVersion(),
    downloadDir: path.join(app.getPath('userData'), 'updates')
  });
  const router = new LlmFallbackRouter({});

  mcpBridge.start().catch(() => {});
  updater.start();
  router.start();

  runtime = { mcpBridge, updater, router };
  return runtime;
}

async function runtimeSnapshot() {
  const memoryTotal = os.totalmem();
  const memoryFree = os.freemem();
  const memoryUsed = memoryTotal - memoryFree;
  let toolCount = null;
  let mcpHealth = runtime?.mcpBridge?.lastHealthCheck || null;

  try {
    const listed = await runtime.mcpBridge.listTools();
    const tools = listed?.result?.tools || listed?.tools || [];
    toolCount = Array.isArray(tools) ? tools.length : null;
  } catch {}

  return {
    appVersion: app.getVersion(),
    profile: currentProfile,
    mcp: {
      connected: Boolean(runtime?.mcpBridge?.connected),
      lastHealthCheck: mcpHealth,
      toolCount,
      activeUrl: runtime?.mcpBridge?.activeMcpUrl || currentProfile?.mcpUrl || null,
      endpoints: mcpHealth?.endpoints || [],
      tokenFilePath: currentProfile?.tokenFilePath || null
    },
    llm: runtime?.router?.getStatus?.() || null,
    update: {
      manifestUrl: runtime?.updater?.updateManifestUrl || null,
      available: runtime?.updater?.updateAvailable || null
    },
    system: {
      hostname: os.hostname(),
      platform: os.platform(),
      cpuCount: os.cpus().length,
      memoryTotal,
      memoryUsed,
      memoryFree
    }
  };
}

async function createWindow() {
  currentProfile = loadProfile();
  createRuntime(currentProfile);

  mainWindow = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    title: 'Funesterie Desktop',
    backgroundColor: '#050510',
    icon: path.join(app.getAppPath(), 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devServer = process.env.FUNESTERIE_DESKTOP_DEV_SERVER;
  if (devServer) {
    await mainWindow.loadURL(devServer);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }
}

ipcMain.handle('funesterie:bootstrap', async () => runtimeSnapshot());

ipcMain.handle('funesterie:set-profile', async (_event, profileId) => {
  const resolvedProfileId = normalizeProfileId(profileId);
  saveProfileId(resolvedProfileId);
  currentProfile = loadProfile(resolvedProfileId);
  createRuntime(currentProfile);
  return runtimeSnapshot();
});

ipcMain.handle('funesterie:list-tools', async () => {
  try {
    return await runtime.mcpBridge.listTools();
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('funesterie:call-tool', async (_event, payload) => {
  try {
    return await runtime.mcpBridge.callTool(payload.name, payload.args || {});
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('funesterie:chat', async (_event, message) => {
  const systemPrompt = currentProfile?.systemPrompt || '';
  const result = await runtime.router.chat(message, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message }
    ]
  });
  return result;
});

ipcMain.handle('funesterie:check-updates', async () => {
  try {
    return await runtime.updater.checkForUpdate();
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('funesterie:download-update', async () => {
  try {
    return await runtime.updater.downloadAndInstall();
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('funesterie:open-external', async (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try { runtime?.mcpBridge?.stop?.(); } catch {}
  try { runtime?.router?.stop?.(); } catch {}
  try { runtime?.updater?.stop?.(); } catch {}
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
