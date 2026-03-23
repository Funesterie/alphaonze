/**
 * File Edit Client - TypeScript SDK for secure file editing
 * Frontend SDK avec diff preview, undo/redo, audit logs
 */

export interface DiffChange {
  added?: boolean;
  removed?: boolean;
  value: string;
  count?: number;
}

export interface PreviewResult {
  path: string;
  fileExists: boolean;
  patch: string;
  changes: DiffChange[];
  summary: {
    additions: number;
    deletions: number;
    unchanged: number;
  };
  safe: boolean;
}

export interface ApplyResult {
  success: boolean;
  path: string;
  fileExists: boolean;
  size: number;
  canUndo: boolean;
}

export interface UndoResult {
  success: boolean;
  path: string;
  restored: boolean;
  remainingUndos: number;
}

export interface HistoryEntry {
  timestamp: number;
  hash: string;
  size: number;
}

export interface AuditEntry {
  timestamp: string;
  action: string;
  filePath: string;
  user: string;
  details: any;
}

export class FileEditClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://127.0.0.1:3000') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async request<T>(endpoint: string, body?: any, method: string = 'POST'): Promise<T> {
    const url = `${this.baseUrl}/api/edit${endpoint}`;
    const options: RequestInit = {
      method: method === 'GET' || !body ? 'GET' : method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async health(): Promise<{
    ok: boolean;
    available: boolean;
    workspace_root: string;
    editable_paths: string[];
    history_size: number;
    audit_log_size: number;
  }> {
    return this.request('/health', null, 'GET');
  }

  async preview(path: string, newContent: string): Promise<PreviewResult> {
    return this.request('/preview', { path, newContent });
  }

  async apply(path: string, newContent: string, force: boolean = false): Promise<ApplyResult> {
    return this.request('/apply', { path, newContent, force });
  }

  async undo(path: string): Promise<UndoResult> {
    return this.request('/undo', { path });
  }

  async getHistory(path: string): Promise<{ path: string; history: HistoryEntry[] }> {
    const encodedPath = encodeURIComponent(path);
    return this.request(`/history/${encodedPath}`, null, 'GET');
  }

  async getAuditLog(limit: number = 100, offset: number = 0): Promise<{
    total: number;
    limit: number;
    offset: number;
    entries: AuditEntry[];
  }> {
    return this.request(`/audit?limit=${limit}&offset=${offset}`, null, 'GET');
  }

  async clearHistory(path?: string): Promise<{ success: boolean; cleared: string | number }> {
    return this.request('/history/clear', path ? { path } : {});
  }
}

// Singleton instance
let clientInstance: FileEditClient | null = null;

export function getFileEditClient(baseUrl?: string): FileEditClient {
  if (!clientInstance || baseUrl) {
    clientInstance = new FileEditClient(baseUrl);
  }
  return clientInstance;
}

// Helper functions
export async function previewEdit(path: string, newContent: string): Promise<PreviewResult> {
  const client = getFileEditClient();
  return client.preview(path, newContent);
}

export async function applyEdit(
  path: string,
  newContent: string,
  options: { force?: boolean; preview?: boolean } = {}
): Promise<ApplyResult> {
  const client = getFileEditClient();
  
  // Preview first if requested
  if (options.preview) {
    const previewResult = await client.preview(path, newContent);
    console.log('[FileEdit] Preview:', previewResult.summary);
    
    // Warn on large deletions
    if (previewResult.summary.deletions > 50) {
      console.warn('[FileEdit] Warning: Large deletion detected', previewResult.summary);
    }
  }
  
  return client.apply(path, newContent, options.force);
}

export async function undoEdit(path: string): Promise<UndoResult> {
  const client = getFileEditClient();
  return client.undo(path);
}

export async function getEditHistory(path: string): Promise<HistoryEntry[]> {
  const client = getFileEditClient();
  const result = await client.getHistory(path);
  return result.history;
}

export async function getRecentEdits(limit: number = 20): Promise<AuditEntry[]> {
  const client = getFileEditClient();
  const result = await client.getAuditLog(limit);
  return result.entries;
}

/**
 * Format diff for display
 */
export function formatDiff(changes: DiffChange[]): string {
  return changes.map(change => {
    const prefix = change.added ? '+ ' : change.removed ? '- ' : '  ';
    return change.value.split('\n').map(line => prefix + line).join('\n');
  }).join('\n');
}

/**
 * Get diff statistics
 */
export function getDiffStats(changes: DiffChange[]): {
  additions: number;
  deletions: number;
  modifications: number;
} {
  let additions = 0;
  let deletions = 0;
  let modifications = 0;
  
  for (const change of changes) {
    if (change.added) {
      additions += change.count || 0;
    } else if (change.removed) {
      deletions += change.count || 0;
    } else {
      modifications += change.count || 0;
    }
  }
  
  return { additions, deletions, modifications };
}

/**
 * Validate edit before applying (client-side safety check)
 */
export function validateEdit(
  original: string,
  newContent: string
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  
  // Check for complete file deletion
  if (original.length > 100 && newContent.length === 0) {
    warnings.push('Complete file deletion detected');
  }
  
  // Check for large reduction (>80%)
  if (original.length > 100 && newContent.length < original.length * 0.2) {
    warnings.push(`Large content reduction: ${original.length} → ${newContent.length} bytes`);
  }
  
  // Check for syntax errors in common file types
  const ext = original.match(/\.(\w+)$/)?.[1];
  if (ext === 'json') {
    try {
      JSON.parse(newContent);
    } catch (err) {
      warnings.push('JSON syntax error detected');
    }
  }
  
  return {
    valid: warnings.length === 0,
    warnings
  };
}
