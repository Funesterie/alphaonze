/**
 * A11FS Client - TypeScript SDK pour appels API filesystem + VS integration
 * Utilisé par le frontend React pour communiquer avec le backend et le VSIX
 */

// Frontend FS fallback bridge for A11
// Uses host object window.a11fs if available, otherwise falls back to backend REST endpoints.

export interface A11FsResponse<T = any> { ok?: boolean; error?: string; data?: T }
export interface FileReadResponse { path: string; content: string | null; exists: boolean }
export interface FileWriteResponse { ok: boolean; path?: string }

export interface CompilationError { rawLine: string }
export interface ProjectStructure {
  solution: string;
  solutionPath: string;
  projectCount: number;
  projects: Array<{
    name: string;
    path: string;
    kind: string;
    files: string[];
  }>;
}
export interface SolutionInfo { name: string; path: string; projectCount: number; isOpen: boolean }
export interface ActiveDocument { path: string; name: string; line: number; column: number; selectedText: string }

const API_BASE = (import.meta as any).env?.VITE_API_BASE || '/api';

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    credentials: 'include'
  });
  const ct = res.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');
  const payload = isJson ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok || (isJson && payload?.ok === false)) {
    const msg = isJson ? (payload?.error || `HTTP ${res.status}`) : String(payload);
    throw new Error(msg);
  }
  return isJson ? payload : { ok: true, data: payload };
}

type HostFs = {
  writeFile?: (path: string, content: string) => Promise<any>;
  readFile?: (path: string) => Promise<any>;
  exists?: (path: string) => Promise<any>;
  list?: (dir: string) => Promise<any>;
  testDir?: (dir: string) => Promise<any>;
};

type HostVs = {
  GetCompilationErrors?: () => Promise<string>;
  GetProjectStructure?: () => Promise<string>;
  GetSolutionInfo?: () => Promise<string>;
  GetActiveDocument?: () => Promise<string>;
  GetCurrentSelection?: () => Promise<string>;
  InsertAtCursor?: (text: string) => Promise<boolean>;
  ReplaceSelection?: (newText: string) => Promise<boolean>;
  DeleteFile?: (path: string) => Promise<boolean>;
  RenameFile?: (oldPath: string, newPath: string) => Promise<boolean>;
  OpenFile?: (path: string) => Promise<boolean>;
  GotoLine?: (path: string, line: number) => Promise<boolean>;
  BuildSolution?: () => Promise<boolean>;
  GetOpenDocuments?: () => Promise<string>;
  ExecuteShell?: (command: string) => Promise<string>;
  GetWorkspaceRoot?: () => Promise<string>;
};

const hostBridge: HostFs | undefined = (globalThis as any).a11fs;
const hostVs: HostVs | undefined = (globalThis as any).a11host;

// ========== FILESYSTEM METHODS ==========

export async function writeFile(path: string, content: string): Promise<FileWriteResponse> {
  if (hostBridge?.writeFile) {
    return hostBridge.writeFile(path, content);
  }
  const data = await jsonFetch(`${API_BASE}/v1/fs/write`, { method: 'POST', body: JSON.stringify({ path, content }) });
  return data;
}

export async function testDir(dir: string): Promise<{ ok: boolean; report?: string }> {
  if (hostBridge?.testDir) {
    return hostBridge.testDir(dir) as any;
  }
  const data = await jsonFetch(`${API_BASE}/v1/fs/test?dir=${encodeURIComponent(dir)}`);
  return data;
}

export async function fileExists(path: string): Promise<{ ok: boolean; exists: boolean; path?: string }> {
  if (hostBridge?.exists) {
    return hostBridge.exists(path) as any;
  }
  const data = await jsonFetch(`${API_BASE}/v1/fs/exists?path=${encodeURIComponent(path)}`);
  return data;
}

export async function listFiles(dir: string): Promise<{ ok: boolean; items: Array<{ name: string; dir: boolean; file: boolean }> }> {
  if (hostBridge?.list) {
    return hostBridge.list(dir) as any;
  }
  const data = await jsonFetch(`${API_BASE}/v1/fs/list?dir=${encodeURIComponent(dir)}`);
  return data;
}

// ========== CODE ANALYSIS METHODS ==========

export async function getCompilationErrors(): Promise<CompilationError[]> {
  if (hostVs?.GetCompilationErrors) {
    const result = await hostVs.GetCompilationErrors();
    return JSON.parse(result);
  }
  const data = await jsonFetch(`${API_BASE}/v1/vs/compilation-errors`);
  return data.errors || [];
}

export async function getProjectStructure(): Promise<ProjectStructure> {
  if (hostVs?.GetProjectStructure) {
    const result = await hostVs.GetProjectStructure();
    return JSON.parse(result);
  }
  const data = await jsonFetch(`${API_BASE}/v1/vs/project-structure`);
  return data;
}

export async function getSolutionInfo(): Promise<SolutionInfo> {
  if (hostVs?.GetSolutionInfo) {
    const result = await hostVs.GetSolutionInfo();
    return JSON.parse(result);
  }
  const data = await jsonFetch(`${API_BASE}/v1/vs/solution-info`);
  return data;
}

export async function getActiveDocument(): Promise<ActiveDocument> {
  if (hostVs?.GetActiveDocument) {
    const result = await hostVs.GetActiveDocument();
    return JSON.parse(result);
  }
  const data = await jsonFetch(`${API_BASE}/v1/vs/active-document`);
  return data;
}

export async function getCurrentSelection(): Promise<string> {
  if (hostVs?.GetCurrentSelection) {
    return await hostVs.GetCurrentSelection();
  }
  const data = await jsonFetch(`${API_BASE}/v1/vs/current-selection`);
  return data.text || '';
}

// ========== CODE EDITING METHODS ==========

export async function insertAtCursor(text: string): Promise<boolean> {
  if (hostVs?.InsertAtCursor) {
    return await hostVs.InsertAtCursor(text);
  }
  const data = await jsonFetch(`${API_BASE}/v1/vs/insert-at-cursor`, { method: 'POST', body: JSON.stringify({ text }) });
  return data.success || false;
}

export async function replaceSelection(newText: string): Promise<boolean> {
  if (hostVs?.ReplaceSelection) {
    return await hostVs.ReplaceSelection(newText);
  }
  const data = await jsonFetch(`${API_BASE}/v1/vs/replace-selection`, { method: 'POST', body: JSON.stringify({ newText }) });
  return data.success || false;
}

// ========== FILE MANAGEMENT METHODS ==========

export async function deleteFile(path: string): Promise<boolean> {
  if (hostVs?.DeleteFile) {
    return await hostVs.DeleteFile(path);
  }
  const data = await jsonFetch(`${API_BASE}/v1/vs/file`, { method: 'DELETE', body: JSON.stringify({ path }) });
  return data.success || false;
}

export async function renameFile(oldPath: string, newPath: string): Promise<boolean> {
  if (hostVs?.RenameFile) {
    return await hostVs.RenameFile(oldPath, newPath);
  }
  const data = await jsonFetch(`${API_BASE}/v1/vs/file/rename`, { method: 'PUT', body: JSON.stringify({ oldPath, newPath }) });
  return data.success || false;
}

// ========== EXISTING VS METHODS ==========

export async function getWorkspaceRoot(): Promise<string> {
  if (hostVs?.GetWorkspaceRoot) {
    return await hostVs.GetWorkspaceRoot();
  }
  const data = await jsonFetch(`${API_BASE}/v1/vs/workspace-root`);
  return data.root || '';
}

export async function openFile(path: string): Promise<boolean> {
  if (hostVs?.OpenFile) {
    return await hostVs.OpenFile(path);
  }
  const data = await jsonFetch(`${API_BASE}/v1/vs/open-file`, { method: 'POST', body: JSON.stringify({ path }) });
  return data.success || false;
}

export async function gotoLine(path: string, line: number): Promise<boolean> {
  if (hostVs?.GotoLine) {
    return await hostVs.GotoLine(path, line);
  }
  const data = await jsonFetch(`${API_BASE}/v1/vs/goto-line`, { method: 'POST', body: JSON.stringify({ path, line }) });
  return data.success || false;
}

export async function buildSolution(): Promise<boolean> {
  if (hostVs?.BuildSolution) {
    return await hostVs.BuildSolution();
  }
  const data = await jsonFetch(`${API_BASE}/v1/vs/build`, { method: 'POST' });
  return data.success || false;
}

export async function getOpenDocuments(): Promise<string[]> {
  if (hostVs?.GetOpenDocuments) {
    const result = await hostVs.GetOpenDocuments();
    return JSON.parse(result);
  }
  const data = await jsonFetch(`${API_BASE}/v1/vs/open-documents`);
  return data.documents || [];
}

export async function executeShell(command: string): Promise<string> {
  if (hostVs?.ExecuteShell) {
    return await hostVs.ExecuteShell(command);
  }
  const data = await jsonFetch(`${API_BASE}/v1/vs/execute-shell`, { method: 'POST', body: JSON.stringify({ command }) });
  return data.output || '';
}

// Default export with all methods
export default {
  // Filesystem
  writeFile,
  testDir,
  fileExists,
  listFiles,
  // Code analysis
  getCompilationErrors,
  getProjectStructure,
  getSolutionInfo,
  getActiveDocument,
  getCurrentSelection,
  // Code editing
  insertAtCursor,
  replaceSelection,
  // File management
  deleteFile,
  renameFile,
  // VS integration
  getWorkspaceRoot,
  openFile,
  gotoLine,
  buildSolution,
  getOpenDocuments,
  executeShell
};
