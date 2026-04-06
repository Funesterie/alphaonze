/**
 * A11 Host API wrapper - Mode 3 (full VS access)
 * Accès à l'API C# exposée par A11FsApi via WebView2
 */

export interface A11HostAPI {
  // Test/Ping
  Ping(name: string): Promise<string>;
  
  // Workspace
  GetWorkspaceRoot(): Promise<string | null>;
  
  // Filesystem
  ReadFile(path: string): Promise<string | null>;
  WriteFile(path: string, content: string): Promise<boolean>;
  FileExists(path: string): Promise<boolean>;
  ListFiles(directory: string): Promise<string[]>;
  
  // Visual Studio - File Operations
  OpenFile(path: string): Promise<boolean>;
  GotoLine(path: string, line: number): Promise<boolean>;
  GetOpenDocuments(): Promise<string[]>;
  
  // Visual Studio - Editing
  ApplyEditReplaceFile(path: string, newContent: string): Promise<boolean>;
  
  // Visual Studio - Commands
  ExecuteVsCommand(command: string, args?: string): Promise<boolean>;
  BuildSolution(): Promise<boolean>;
  
  // Shell
  ExecuteShell(command: string): Promise<string>;
}

export interface A11Command {
  type: 
    | 'ping'
    | 'open_file' 
    | 'goto_line' 
    | 'read_file' 
    | 'write_file' 
    | 'execute_shell' 
    | 'build'
    | 'get_workspace_root'
    | 'get_open_documents'
    | 'list_files'
    | 'file_exists'
    | 'execute_vs_command';
  path?: string;
  line?: number;
  content?: string;
  command?: string;
  args?: string;
  directory?: string;
  name?: string;
}

// État d'initialisation
let isInitialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Vérifie si on est dans WebView2 avec accès à a11fs
 */
export function isA11HostAvailable(): boolean {
  const w = window as any;
  return !!(w.chrome?.webview?.hostObjects?.a11fs);
}

/**
 * Attend que le WebView2 soit prêt (chrome.webview.hostObjects disponible)
 * @param timeout Timeout en ms (défaut: 5000)
 */
export async function waitForWebView2Ready(timeout = 5000): Promise<boolean> {
  // Si déjà initialisé, retourner immédiatement
  if (isInitialized) {
    return true;
  }

  // Si une initialisation est en cours, attendre sa completion
  if (initPromise) {
    await initPromise;
    return isInitialized;
  }

  // Créer une nouvelle promesse d'initialisation
  initPromise = new Promise<void>((resolve) => {
    const startTime = Date.now();
    
    const checkReady = () => {
      const w = window as any;
      
      // Vérifier si chrome.webview.hostObjects est disponible
      if (w.chrome?.webview?.hostObjects) {
        console.log('[a11host] ✅ WebView2 hostObjects détecté');
        isInitialized = true;
        resolve();
        return;
      }

      // Timeout dépassé
      if (Date.now() - startTime > timeout) {
        console.warn('[a11host] ⚠️ Timeout waiting for WebView2 hostObjects');
        resolve(); // On résout quand même pour ne pas bloquer
        return;
      }

      // Réessayer dans 50ms
      setTimeout(checkReady, 50);
    };

    checkReady();
  });

  await initPromise;
  return isInitialized;
}

/**
 * Récupère l'API hôte (null si pas dans VSIX)
 * Attend automatiquement que le WebView2 soit prêt
 */
export async function getA11Host(): Promise<A11HostAPI | null> {
  await waitForWebView2Ready();
  
  if (!isA11HostAvailable()) {
    console.warn('[a11host] API non disponible après initialisation');
    return null;
  }
  
  const w = window as any;
  return w.chrome.webview.hostObjects.a11fs;
}

/**
 * Version synchrone (pour compatibilité) - NE PAS UTILISER au démarrage
 * @deprecated Utiliser getA11Host() (async) à la place
 */
export function getA11HostSync(): A11HostAPI | null {
  if (!isA11HostAvailable()) return null;
  const w = window as any;
  return w.chrome.webview.hostObjects.a11fs;
}

/**
 * Execute une commande A-11 (depuis le backend ou UI)
 */
export async function executeA11Command(cmd: A11Command): Promise<any> {
  const host = await getA11Host();
  
  if (!host) {
    console.warn('[a11host] API non disponible (hors VSIX?)');
    return { success: false, error: 'API non disponible' };
  }

  try {
    switch (cmd.type) {
      case 'ping':
        if (!cmd.name) throw new Error('name requis');
        return await host.Ping(cmd.name);
      
      case 'get_workspace_root':
        return await host.GetWorkspaceRoot();
      
      case 'open_file':
        if (!cmd.path) throw new Error('path requis');
        return await host.OpenFile(cmd.path);
      
      case 'goto_line':
        if (!cmd.path || cmd.line === undefined) throw new Error('path et line requis');
        return await host.GotoLine(cmd.path, cmd.line);
      
      case 'read_file':
        if (!cmd.path) throw new Error('path requis');
        return await host.ReadFile(cmd.path);
      
      case 'write_file':
        if (!cmd.path || !cmd.content) throw new Error('path et content requis');
        return await host.WriteFile(cmd.path, cmd.content);
      
      case 'file_exists':
        if (!cmd.path) throw new Error('path requis');
        return await host.FileExists(cmd.path);
      
      case 'list_files':
        if (!cmd.directory) throw new Error('directory requis');
        return await host.ListFiles(cmd.directory);
      
      case 'get_open_documents':
        return await host.GetOpenDocuments();
      
      case 'execute_shell':
        if (!cmd.command) throw new Error('command requis');
        return await host.ExecuteShell(cmd.command);
      
      case 'execute_vs_command':
        if (!cmd.command) throw new Error('command requis');
        return await host.ExecuteVsCommand(cmd.command, cmd.args);
      
      case 'build':
        return await host.BuildSolution();
      
      default:
        throw new Error(`Commande inconnue: ${cmd.type}`);
    }
  } catch (err) {
    console.error('[a11host] Erreur execution commande:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * Hook React pour accéder à l'API
 * Note: Nécessite React d'être disponible
 */
export function useA11Host() {
  // Import React dynamically to avoid errors if not available
  let useState: any;
  let useEffect: any;
  
  try {
    const React = require('react');
    useState = React.useState;
    useEffect = React.useEffect;
  } catch {
    console.warn('[a11host] React not available, useA11Host will not work');
    return {
      available: false,
      host: null,
      execute: executeA11Command,
    };
  }

  const [available, setAvailable] = useState(false);
  // `useState` is imported dynamically (as any), so generics on the call trigger TS2347.
  // Create host state by passing a typed initial value instead.
  const hostState = useState(null as A11HostAPI | null);
  const host = hostState[0] as A11HostAPI | null;
  const setHost = hostState[1] as (h: A11HostAPI | null) => void;

  useEffect(() => {
    const init = async () => {
      await waitForWebView2Ready();
      const h = await getA11Host();
      setHost(h);
      setAvailable(h !== null);
    };
    init();
  }, []);
  
  return {
    available,
    host,
    execute: executeA11Command,
  };
}

// ========================================
// 🔥 HELPERS PRATIQUES POUR MODE 3
// ========================================

/**
 * Ouvre un fichier dans Visual Studio
 */
export async function openFileInVS(path: string): Promise<boolean> {
  const host = await getA11Host();
  if (!host) return false;
  try {
    return await host.OpenFile(path);
  } catch (err) {
    console.error('[a11host] openFileInVS error:', err);
    return false;
  }
}

/**
 * Lit le contenu d'un fichier
 */
export async function readFile(path: string): Promise<string | null> {
  const host = await getA11Host();
  if (!host) return null;
  try {
    return await host.ReadFile(path);
  } catch (err) {
    console.error('[a11host] readFile error:', err);
    return null;
  }
}

/**
 * Récupère la racine du workspace (solution directory)
 */
export async function getWorkspaceRoot(): Promise<string | null> {
  const host = await getA11Host();
  if (!host) return null;
  try {
    return await host.GetWorkspaceRoot();
  } catch (err) {
    console.error('[a11host] getWorkspaceRoot error:', err);
    return null;
  }
}

/**
 * Liste tous les fichiers ouverts dans VS
 */
export async function getOpenDocuments(): Promise<string[]> {
  const host = await getA11Host();
  if (!host) return [];
  try {
    return await host.GetOpenDocuments();
  } catch (err) {
    console.error('[a11host] getOpenDocuments error:', err);
    return [];
  }
}

/**
 * Exécute une commande shell et retourne la sortie
 */
export async function executeShell(command: string): Promise<string> {
  const host = await getA11Host();
  if (!host) return '';
  try {
    return await host.ExecuteShell(command);
  } catch (err) {
    console.error('[a11host] executeShell error:', err);
    return `Error: ${err}`;
  }
}

/**
 * Build la solution courante
 */
export async function buildSolution(): Promise<boolean> {
  const host = await getA11Host();
  if (!host) return false;
  try {
    return await host.BuildSolution();
  } catch (err) {
    console.error('[a11host] buildSolution error:', err);
    return false;
  }
}

/**
 * Test de connexion avec le host
 */
export async function pingHost(name: string = 'Frontend'): Promise<string | null> {
  const host = await getA11Host();
  if (!host) return null;
  try {
    return await host.Ping(name);
  } catch (err) {
    console.error('[a11host] pingHost error:', err);
    return null;
  }
}

/**
 * Récupère le contexte complet du workspace pour A-11
 * Utile pour initialiser A-11 avec toutes les infos d'environnement
 */
export async function getWorkspaceContext(): Promise<{
  workspaceRoot: string | null;
  openDocuments: string[];
  available: boolean;
  error?: string;
}> {
  const host = await getA11Host();
  
  if (!host) {
    return {
      workspaceRoot: null,
      openDocuments: [],
      available: false,
      error: 'API not available'
    };
  }

  try {
    const [workspaceRoot, openDocuments] = await Promise.all([
      host.GetWorkspaceRoot().catch(() => null),
      host.GetOpenDocuments().catch(() => []),
    ]);

    return {
      workspaceRoot,
      openDocuments,
      available: true,
    };
  } catch (err) {
    console.error('[a11host] getWorkspaceContext error:', err);
    return {
      workspaceRoot: null,
      openDocuments: [],
      available: false,
      error: String(err)
    };
  }
}

/**
 * Formate le contexte workspace en markdown pour envoyer à A-11
 */
export async function formatWorkspaceContextForA11(): Promise<string> {
  const ctx = await getWorkspaceContext();
  
  if (!ctx.available) {
    return '⚠️ Mode 3 non disponible (hors WebView2)';
  }

  let markdown = '## 📍 Contexte Workspace (Mode 3 Actif)\n\n';
  
  if (ctx.workspaceRoot) {
    markdown += `**Workspace Root:** \`${ctx.workspaceRoot}\`\n\n`;
  }
  
  if (ctx.openDocuments.length > 0) {
    markdown += `**Documents ouverts (${ctx.openDocuments.length}):**\n`;
    ctx.openDocuments.forEach(doc => {
      const fileName = doc.split('\\').pop();
      markdown += `- \`${fileName}\` (${doc})\n`;
    });
  } else {
    markdown += `**Documents ouverts:** Aucun\n`;
  }
  
  markdown += `\n**Capacités disponibles:**\n`;
  markdown += `- 📂 Ouvrir des fichiers dans VS\n`;
  markdown += `- 📖 Lire/écrire des fichiers\n`;
  markdown += `- 🔨 Lancer des builds\n`;
  markdown += `- ⚡ Exécuter des commandes shell\n`;
  markdown += `- 📋 Lister les fichiers du workspace\n`;
  markdown += `\nTu peux agir directement au lieu d'expliquer. Utilise les commandes JSON.`;
  
  return markdown;
}
