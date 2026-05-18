/**
 * A11Host API Routes - VS integration + Headless backend mode
 * - Avec VSIX : utilise le bridge A11HostApi.cs
 * - Sans VSIX : fallback sur un "headless host" (fs + shell) côté backend
 */

const path = require('node:path');
const fs = require('node:fs/promises');
const childProcess = require('node:child_process');
const util = require('node:util');
const {
  assertShellAllowed,
  getShellAllowlistEntries,
  getShellAllowlistSummary,
  getShellToolName,
} = require('../lib/safe-shell.cjs');

const execAsync = util.promisify(childProcess.exec);
const execFileAsync = util.promisify(childProcess.execFile);

// =========================
// BRIDGES & CONFIG
// =========================

// Bridge VSIX (injecté par la WebView)
let a11HostBridge = null;

// Config headless (peut être override depuis server.cjs)
let headlessConfig = {
  workspaceRoot: process.env.A11_WORKSPACE_ROOT || process.cwd(),
  buildCommand: process.env.A11_BUILD_COMMAND || null, // ex: "dotnet build" ou "npm run build"
  shellCwd: process.env.A11_SHELL_CWD || null
};

const PROTECTED_PATH_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.env',
  '.a11_backups',
  '.qflush',
  '.qflush'
]);

const SAFE_MODE = String(process.env.A11_SAFE_MODE ?? 'true').toLowerCase() !== 'false';

function hasDeleteConfirmation(input = {}) {
  const token = String(input.confirm || input.confirmation || '').trim();
  return input.confirmDelete === true && token === 'DELETE';
}

function isProtectedPath(targetPath) {
  const normalized = path.resolve(String(targetPath || '')).toLowerCase();
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts.some((segment) => PROTECTED_PATH_SEGMENTS.has(segment));
}

function assertDeleteAllowed(targetPath, input = {}) {
  console.log('[A11 ACTION]', {
    action: 'delete',
    path: targetPath,
    user: input.user || input.requestedBy || 'unknown',
    timestamp: Date.now()
  });
  if (SAFE_MODE) {
    throw new Error('DeleteFile refused: SAFE_MODE is enabled');
  }
  if (!hasDeleteConfirmation(input)) {
    throw new Error('DeleteFile refused: explicit confirmation required (confirmDelete=true and confirm="DELETE")');
  }
  if (isProtectedPath(targetPath)) {
    throw new Error(`DeleteFile refused on protected path: ${targetPath}`);
  }
}

/**
 * Initialize A11Host bridge (called by VSIX when available)
 */
function setA11HostBridge(bridge) {
  a11HostBridge = bridge;
  console.log('[A11Host] Bridge initialized (VSIX mode)');
}

/**
 * Configure headless mode (optional, depuis server.cjs)
 */
function setHeadlessConfig(cfg = {}) {
  headlessConfig = {
    ...headlessConfig,
    ...cfg
  };
  console.log('[A11Host] Headless config updated:', headlessConfig);
}

const SHELL_TOOL_PROBE_TTL_MS = 30_000;
let cachedShellRuntime = {
  expiresAt: 0,
  value: null,
};

function normalizeShellOutput(stdout, stderr) {
  return [String(stdout || '').trim(), String(stderr || '').trim()]
    .filter(Boolean)
    .join('\n')
    .trim();
}

function looksLikeMissingExecutable(message) {
  const normalized = String(message || '').toLowerCase();
  return (
    normalized.includes('not found') ||
    normalized.includes('is not recognized as an internal or external command') ||
    normalized.includes('command not found') ||
    normalized.includes('enoent')
  );
}

function buildShellUnavailableMessage(command, stderr) {
  const tool = getShellToolName(command) || String(command || '').trim().split(/\s+/)[0] || 'outil';
  return `La commande "${tool}" n'est pas disponible sur ce runtime A11 pour le moment.`;
}

function normalizeShellExecutionResult(command, cwd, rawResult) {
  if (rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)) {
    const stdout = String(rawResult.stdout || '');
    const stderr = String(rawResult.stderr || '');
    const exitCode =
      Number.isFinite(rawResult.exitCode) ? Number(rawResult.exitCode) :
      rawResult.ok === false ? -1 : 0;
    const unavailable =
      rawResult.unavailable === true ||
      (exitCode === 127) ||
      looksLikeMissingExecutable(stderr || rawResult.message || '');
    const output = String(rawResult.output || normalizeShellOutput(stdout, stderr));
    const message = String(
      rawResult.message ||
      (unavailable ? buildShellUnavailableMessage(command, stderr) : '')
    ).trim();

    return {
      ok: rawResult.ok !== false,
      command: String(rawResult.command || command || '').trim(),
      cwd: String(rawResult.cwd || cwd || '').trim() || null,
      exitCode,
      stdout,
      stderr,
      output,
      unavailable,
      message: message || null,
    };
  }

  const output = String(rawResult || '').trim();
  return {
    ok: true,
    command: String(command || '').trim(),
    cwd: String(cwd || '').trim() || null,
    exitCode: 0,
    stdout: output,
    stderr: '',
    output,
    unavailable: false,
    message: null,
  };
}

async function probeShellTool(tool) {
  const binary = String(tool || '').trim();
  if (!binary) return false;

  try {
    if (process.platform === 'win32') {
      await execFileAsync('where', [binary], { windowsHide: true });
    } else {
      await execFileAsync('sh', ['-lc', `command -v ${binary}`]);
    }
    return true;
  } catch {
    return false;
  }
}

async function getHeadlessShellRuntime() {
  const now = Date.now();
  if (cachedShellRuntime.value && cachedShellRuntime.expiresAt > now) {
    return cachedShellRuntime.value;
  }

  const entries = getShellAllowlistEntries();
  const toolsToProbe = Array.from(new Set(entries.map((entry) => entry.tool).filter(Boolean)));
  const toolPairs = await Promise.all(
    toolsToProbe.map(async (tool) => [tool, await probeShellTool(tool)])
  );
  const tools = Object.fromEntries(toolPairs);
  const unavailableTools = Object.entries(tools)
    .filter(([, available]) => !available)
    .map(([tool]) => tool);
  const unavailableExamples = entries
    .filter((entry) => entry.tool && tools[entry.tool] === false)
    .map((entry) => entry.example);

  const value = {
    source: 'headless',
    platform: process.platform,
    probed: true,
    tools,
    unavailableTools,
    unavailableExamples,
  };

  cachedShellRuntime = {
    expiresAt: now + SHELL_TOOL_PROBE_TTL_MS,
    value,
  };
  return value;
}

// =========================
// HEADLESS HOST
// =========================

const headlessHost = {
  /**
   * Workspace root : en headless, c'est soit A11_WORKSPACE_ROOT soit process.cwd()
   */
  async GetWorkspaceRoot() {
    return headlessConfig.workspaceRoot || process.cwd();
  },

  /**
   * DeleteFile : suppression directe côté FS
   */
  async DeleteFile(absPath, options = {}) {
    assertDeleteAllowed(absPath, options);
    await fs.unlink(absPath);
    return true;
  },

  /**
   * RenameFile : renommage côté FS
   */
  async RenameFile(oldPath, newPath) {
    await fs.rename(oldPath, newPath);
    return true;
  },

  /**
   * ExecuteShell : exécution d'une commande dans le workspace
   */
  async ExecuteShell(command) {
    assertShellAllowed(command, 'ExecuteShell');

    const cwd =
      headlessConfig.shellCwd ||
      headlessConfig.workspaceRoot ||
      process.cwd();

    try {
      const { stdout, stderr } = await execAsync(command, { cwd });
      return normalizeShellExecutionResult(command, cwd, {
        ok: true,
        command,
        cwd,
        exitCode: 0,
        stdout,
        stderr,
      });
    } catch (err) {
      return normalizeShellExecutionResult(command, cwd, {
        ok: false,
        command,
        cwd,
        exitCode: Number.isFinite(err?.code) ? Number(err.code) : -1,
        stdout: err?.stdout || '',
        stderr: err?.stderr || err?.message || '',
        unavailable: looksLikeMissingExecutable(err?.stderr || err?.message || ''),
        message: looksLikeMissingExecutable(err?.stderr || err?.message || '')
          ? buildShellUnavailableMessage(command, err?.stderr || err?.message || '')
          : null,
      });
    }
  },

  /**
   * BuildSolution : on exécute A11_BUILD_COMMAND si défini
   * (ex: "dotnet build", "npm run build", etc.)
   */
  async BuildSolution() {
    const buildCommand =
      headlessConfig.buildCommand ||
      process.env.A11_BUILD_COMMAND;

    if (!buildCommand) {
      throw new Error(
        'Headless BuildSolution: no A11_BUILD_COMMAND configured'
      );
    }

    const cwd =
      headlessConfig.shellCwd ||
      headlessConfig.workspaceRoot ||
      process.cwd();

    await execAsync(buildCommand, { cwd });
    return true;
  }

  // NOTE:
  // Les méthodes de type "éditeur" (InsertAtCursor, ReplaceSelection,
  // GetActiveDocument, etc.) ne sont pas implémentables proprement en
  // headless, donc on les laisse non définies ici.
};

function collectFunctionNames(target) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
    return [];
  }

  const names = new Set();
  let current = target;
  while (current && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name === 'constructor') continue;
      try {
        if (typeof target[name] === 'function' || typeof current[name] === 'function') {
          names.add(name);
        }
      } catch {
        // Ignore getters/properties that throw.
      }
    }
    current = Object.getPrototypeOf(current);
  }

  return Array.from(names).sort();
}

function getBridgeMethods() {
  return collectFunctionNames(a11HostBridge);
}

function getHeadlessMethods() {
  return collectFunctionNames(headlessHost);
}

function isA11HostMethodAvailable(methodName) {
  return (
    !!(a11HostBridge && typeof a11HostBridge[methodName] === 'function') ||
    typeof headlessHost[methodName] === 'function'
  );
}

function buildCapabilityFlags() {
  return {
    workspaceRoot: isA11HostMethodAvailable('GetWorkspaceRoot'),
    compilationErrors: isA11HostMethodAvailable('GetCompilationErrors'),
    projectStructure: isA11HostMethodAvailable('GetProjectStructure'),
    solutionInfo: isA11HostMethodAvailable('GetSolutionInfo'),
    activeDocument: isA11HostMethodAvailable('GetActiveDocument'),
    currentSelection: isA11HostMethodAvailable('GetCurrentSelection'),
    insertAtCursor: isA11HostMethodAvailable('InsertAtCursor'),
    replaceSelection: isA11HostMethodAvailable('ReplaceSelection'),
    openFile: isA11HostMethodAvailable('OpenFile'),
    gotoLine: isA11HostMethodAvailable('GotoLine'),
    openDocuments: isA11HostMethodAvailable('GetOpenDocuments'),
    buildSolution: isA11HostMethodAvailable('BuildSolution'),
    executeShell: isA11HostMethodAvailable('ExecuteShell'),
    deleteFile: isA11HostMethodAvailable('DeleteFile'),
    renameFile: isA11HostMethodAvailable('RenameFile')
  };
}

async function getA11HostCapabilities() {
  const bridgeMethods = getBridgeMethods();
  const headlessMethods = getHeadlessMethods();
  const activeMethods = Array.from(new Set([...bridgeMethods, ...headlessMethods])).sort();

  let workspaceRoot = null;
  try {
    if (isA11HostMethodAvailable('GetWorkspaceRoot')) {
      workspaceRoot = await callA11Host('GetWorkspaceRoot');
    }
  } catch (error) {
    console.warn('[A11Host] Unable to resolve workspace root for status:', error.message);
  }

  const shellRuntime = a11HostBridge
    ? {
        source: 'vsix',
        platform: process.platform,
        probed: false,
        tools: {},
        unavailableTools: [],
        unavailableExamples: [],
      }
    : await getHeadlessShellRuntime();

  return {
    mode: a11HostBridge ? 'vsix' : 'headless',
    bridgeConnected: !!a11HostBridge,
    safeMode: SAFE_MODE,
    workspaceRoot,
    shellCwd:
      headlessConfig.shellCwd ||
      headlessConfig.workspaceRoot ||
      process.cwd(),
    buildCommand: headlessConfig.buildCommand || process.env.A11_BUILD_COMMAND || null,
    buildCommandConfigured: !!(headlessConfig.buildCommand || process.env.A11_BUILD_COMMAND),
    methods: {
      active: activeMethods,
      bridge: bridgeMethods,
      headless: headlessMethods
    },
    capabilities: buildCapabilityFlags(),
    shellRuntime,
    shellPolicy: {
      whitelisted: true,
      ...getShellAllowlistSummary()
    }
  };
}

async function getA11HostStatus() {
  const capabilities = await getA11HostCapabilities();
  return {
    ok: true,
    available: capabilities.methods.active.length > 0,
    bridgeAvailable: capabilities.bridgeConnected,
    headlessAvailable: capabilities.methods.headless.length > 0,
    mode: capabilities.mode,
    safeMode: capabilities.safeMode,
    workspaceRoot: capabilities.workspaceRoot,
    buildCommandConfigured: capabilities.buildCommandConfigured,
    methods: capabilities.methods.active,
    bridgeMethods: capabilities.methods.bridge,
    headlessMethods: capabilities.methods.headless,
    capabilities: capabilities.capabilities,
    shellPolicy: capabilities.shellPolicy,
    shellRuntime: capabilities.shellRuntime,
  };
}

// =========================
// CORE CALL DISPATCH
// =========================

/**
 * Call A11Host method with args
 * - Si VSIX est connecté → appelle le bridge
 * - Sinon → essaie d'utiliser le headlessHost
 */
async function callA11Host(methodName, ...args) {
  // 1) VSIX Bridge présent + méthode dispo → priorité
  if (
    a11HostBridge &&
    typeof a11HostBridge[methodName] === 'function'
  ) {
    try {
      const result = await a11HostBridge[methodName](...args);
      return result;
    } catch (err) {
      console.error(
        `[A11Host] Error calling VSIX ${methodName}:`,
        err.message
      );
      throw err;
    }
  }

  // 2) Sinon, fallback headless si la méthode existe
  if (typeof headlessHost[methodName] === 'function') {
    try {
      const result = await headlessHost[methodName](...args);
      console.log(
        `[A11Host] (headless) ${methodName}(${args
          .map(a => JSON.stringify(a))
          .join(', ')})`
      );
      return result;
    } catch (err) {
      console.error(
        `[A11Host] Error calling headless ${methodName}:`,
        err.message
      );
      throw err;
    }
  }

  // 3) Rien trouvé
  throw new Error(
    `A11Host method not available: ${methodName} (no VSIX and no headless implementation)`
  );
}

// =========================
// PATH VALIDATION
// =========================

/**
 * Validate path is within workspace
 */
function validatePath(targetPath, workspaceRoot) {
  const normalized = path.normalize(targetPath);
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const resolvedPath = path.resolve(normalized);

  if (!resolvedPath.startsWith(resolvedWorkspace)) {
    throw new Error('Path outside workspace');
  }

  return resolvedPath;
}

// =========================
// ROUTES REGISTRATION
// =========================

function registerA11HostRoutes(router) {
  console.log('[Server] Registering A11Host routes (VSIX + headless)...');

  // ========== CODE ANALYSIS ENDPOINTS ==========
  
  // GET /api/v1/vs/compilation-errors
  router.get('/v1/vs/compilation-errors', async (req, res) => {
    try {
      const errors = await callA11Host('GetCompilationErrors');
      const parsed = JSON.parse(errors);
      console.log(`[A11Host] Compilation errors: ${parsed.length} found`);
      res.json({ ok: true, errors: parsed });
    } catch (err) {
      console.error('[A11Host] GetCompilationErrors error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/v1/vs/project-structure
  router.get('/v1/vs/project-structure', async (req, res) => {
    try {
      const structure = await callA11Host('GetProjectStructure');
      const parsed = JSON.parse(structure);
      console.log(`[A11Host] Project structure: ${parsed.projectCount} projects`);
      res.json({ ok: true, ...parsed });
    } catch (err) {
      console.error('[A11Host] GetProjectStructure error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/v1/vs/solution-info
  router.get('/v1/vs/solution-info', async (req, res) => {
    try {
      const info = await callA11Host('GetSolutionInfo');
      const parsed = JSON.parse(info);
      console.log(`[A11Host] Solution: ${parsed.name} (${parsed.projectCount} projects)`);
      res.json({ ok: true, ...parsed });
    } catch (err) {
      console.error('[A11Host] GetSolutionInfo error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/v1/vs/active-document
  router.get('/v1/vs/active-document', async (req, res) => {
    try {
      const doc = await callA11Host('GetActiveDocument');
      const parsed = JSON.parse(doc);
      console.log(`[A11Host] Active document: ${parsed.name} (${parsed.line}:${parsed.column})`);
      res.json({ ok: true, ...parsed });
    } catch (err) {
      console.error('[A11Host] GetActiveDocument error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/v1/vs/current-selection
  router.get('/v1/vs/current-selection', async (req, res) => {
    try {
      const selection = await callA11Host('GetCurrentSelection');
      console.log(`[A11Host] Selection length: ${selection?.length || 0}`);
      res.json({ ok: true, text: selection });
    } catch (err) {
      console.error('[A11Host] GetCurrentSelection error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ========== CODE EDITING ENDPOINTS ==========

  // POST /api/v1/vs/insert-at-cursor
  // Body: { "text": "code to insert" }
  router.post('/v1/vs/insert-at-cursor', async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ ok: false, error: 'missing_text_parameter' });
      }
      
      const success = await callA11Host('InsertAtCursor', text);
      console.log(`[A11Host] InsertAtCursor: ${success ? 'success' : 'failed'}`);
      res.json({ ok: true, success });
    } catch (err) {
      console.error('[A11Host] InsertAtCursor error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/v1/vs/replace-selection
  // Body: { "newText": "replacement code" }
  router.post('/v1/vs/replace-selection', async (req, res) => {
    try {
      const { newText } = req.body;
      if (!newText || typeof newText !== 'string') {
        return res.status(400).json({ ok: false, error: 'missing_newText_parameter' });
      }
      
      const success = await callA11Host('ReplaceSelection', newText);
      console.log(`[A11Host] ReplaceSelection: ${success ? 'success' : 'failed'}`);
      res.json({ ok: true, success });
    } catch (err) {
      console.error('[A11Host] ReplaceSelection error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ========== FILE MANAGEMENT ENDPOINTS ==========

  // DELETE /api/v1/vs/file
  // Body: { "path": "C:\\path\\file.cs" }
  router.delete('/v1/vs/file', async (req, res) => {
    try {
      const { path: filePath } = req.body;
      if (!filePath || typeof filePath !== 'string') {
        return res.status(400).json({ ok: false, error: 'missing_path_parameter' });
      }
      if (!hasDeleteConfirmation(req.body || {})) {
        return res.status(400).json({
          ok: false,
          error: 'missing_delete_confirmation',
          message: 'Explicit confirmation is required (confirmDelete=true and confirm="DELETE").'
        });
      }
      if (SAFE_MODE) {
        return res.status(403).json({
          ok: false,
          error: 'safe_mode_delete_disabled',
          message: 'Delete is disabled while A11_SAFE_MODE is enabled.'
        });
      }
      
      // Get workspace root for validation
      const workspaceRoot = await callA11Host('GetWorkspaceRoot');
      const validatedPath = validatePath(filePath, workspaceRoot);
      if (isProtectedPath(validatedPath)) {
        return res.status(403).json({
          ok: false,
          error: 'protected_path_denied',
          path: validatedPath
        });
      }
      
      const success = await callA11Host('DeleteFile', validatedPath, req.body || {});
      console.log(`[A11Host] DeleteFile: ${validatedPath} - ${success ? 'success' : 'failed'}`);
      res.json({ ok: true, success, path: validatedPath });
    } catch (err) {
      console.error('[A11Host] DeleteFile error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // PUT /api/v1/vs/file/rename
  // Body: { "oldPath": "C:\\old.cs", "newPath": "C:\\new.cs" }
  router.put('/v1/vs/file/rename', async (req, res) => {
    try {
      const { oldPath, newPath } = req.body;
      if (!oldPath || typeof oldPath !== 'string') {
        return res.status(400).json({ ok: false, error: 'missing_oldPath_parameter' });
      }
      if (!newPath || typeof newPath !== 'string') {
        return res.status(400).json({ ok: false, error: 'missing_newPath_parameter' });
      }
      
      // Get workspace root for validation
      const workspaceRoot = await callA11Host('GetWorkspaceRoot');
      const validatedOldPath = validatePath(oldPath, workspaceRoot);
      const validatedNewPath = validatePath(newPath, workspaceRoot);
      
      const success = await callA11Host('RenameFile', validatedOldPath, validatedNewPath);
      console.log(`[A11Host] RenameFile: ${validatedOldPath} -> ${validatedNewPath} - ${success ? 'success' : 'failed'}`);
      res.json({ ok: true, success, oldPath: validatedOldPath, newPath: validatedNewPath });
    } catch (err) {
      console.error('[A11Host] RenameFile error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ========== EXISTING VS METHODS (already available) ==========

  // GET /api/v1/vs/workspace-root
  router.get('/v1/vs/workspace-root', async (req, res) => {
    try {
      const root = await callA11Host('GetWorkspaceRoot');
      console.log(`[A11Host] Workspace root: ${root}`);
      res.json({ ok: true, root });
    } catch (err) {
      console.error('[A11Host] GetWorkspaceRoot error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/v1/vs/open-file
  // Body: { "path": "C:\\path\\file.cs" }
  router.post('/v1/vs/open-file', async (req, res) => {
    try {
      const { path: filePath } = req.body;
      if (!filePath) {
        return res.status(400).json({ ok: false, error: 'missing_path_parameter' });
      }
      
      const success = await callA11Host('OpenFile', filePath);
      console.log(`[A11Host] OpenFile: ${filePath} - ${success ? 'success' : 'failed'}`);
      res.json({ ok: true, success, path: filePath });
    } catch (err) {
      console.error('[A11Host] OpenFile error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/v1/vs/goto-line
  // Body: { "path": "C:\\path\\file.cs", "line": 42 }
  router.post('/v1/vs/goto-line', async (req, res) => {
    try {
      const { path: filePath, line } = req.body;
      if (!filePath || !line) {
        return res.status(400).json({ ok: false, error: 'missing_parameters' });
      }
      
      const success = await callA11Host('GotoLine', filePath, Number(line));
      console.log(`[A11Host] GotoLine: ${filePath}:${line} - ${success ? 'success' : 'failed'}`);
      res.json({ ok: true, success, path: filePath, line: Number(line) });
    } catch (err) {
      console.error('[A11Host] GotoLine error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/v1/vs/build
  router.post('/v1/vs/build', async (req, res) => {
    try {
      const success = await callA11Host('BuildSolution');
      console.log(`[A11Host] BuildSolution: ${success ? 'success' : 'failed'}`);
      res.json({ ok: true, success });
    } catch (err) {
      console.error('[A11Host] BuildSolution error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/v1/vs/open-documents
  router.get('/v1/vs/open-documents', async (req, res) => {
    try {
      const docs = await callA11Host('GetOpenDocuments');
      const parsed = JSON.parse(docs);
      console.log(`[A11Host] Open documents: ${parsed.length}`);
      res.json({ ok: true, documents: parsed });
    } catch (err) {
      console.error('[A11Host] GetOpenDocuments error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/v1/vs/execute-shell
  // Body: { "command": "dotnet --version" }
  router.post('/v1/vs/execute-shell', async (req, res) => {
    try {
      const { command } = req.body;
      if (!command) {
        return res.status(400).json({ ok: false, error: 'missing_command_parameter' });
      }
      try {
        assertShellAllowed(command, 'execute-shell');
      } catch (err) {
        return res.status(400).json({
          ok: false,
          error: 'command_not_allowed',
          message: err.message,
          shellPolicy: getShellAllowlistSummary()
        });
      }
      
      const cwd =
        headlessConfig.shellCwd ||
        headlessConfig.workspaceRoot ||
        process.cwd();
      const shellResult = normalizeShellExecutionResult(
        command,
        cwd,
        await callA11Host('ExecuteShell', command)
      );
      console.log(`[A11Host] ExecuteShell: ${command.substring(0, 50)}...`);
      res.json({
        ok: true,
        ...shellResult,
        shellPolicy: getShellAllowlistSummary(),
      });
    } catch (err) {
      console.error('[A11Host] ExecuteShell error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ========== LLM STATS ENDPOINT ========== 

  // GET /api/llm/stats
  router.get('/llm/stats', async (req, res) => {
    // TODO: Replace with real LLM stats if available
    res.json({
      backend: 'local',
      model: 'gemma4:e4b',
      gpu: true,
      lastTps: 12.3
    });
  });

  // ========== UTILITY ENDPOINTS ==========

  // GET /api/v1/vs/status - Check if A11Host bridge/headless mode is available
  router.get('/v1/vs/status', async (req, res) => {
    try {
      const status = await getA11HostStatus();
      res.json(status);
    } catch (err) {
      console.error('[A11Host] Status error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/v1/vs/capabilities - richer capability snapshot
  router.get('/v1/vs/capabilities', async (req, res) => {
    try {
      const capabilities = await getA11HostCapabilities();
      res.json({ ok: true, ...capabilities });
    } catch (err) {
      console.error('[A11Host] Capabilities error:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  console.log('[Server] ✓ A11Host routes registered (with headless fallback)');
}

module.exports = {
  registerA11HostRoutes,
  setA11HostBridge,
  callA11Host,
  setHeadlessConfig,
  getA11HostStatus,
  getA11HostCapabilities,
  isA11HostMethodAvailable
};
