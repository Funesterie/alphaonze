import * as vscode from 'vscode';

const GATE_SERVICES = [
  { id: 'comfy', label: 'ComfyUI Cloud', icon: '🎨' },
  { id: 'civitai', label: 'CivitAI', icon: '🖼️' },
  { id: 'huggingface', label: 'HuggingFace', icon: '🤗' },
  { id: 'figma', label: 'Figma', icon: '🎨' },
  { id: 'canva', label: 'Canva', icon: '🖌️' },
  { id: 'notion', label: 'Notion', icon: '📝' },
  { id: 'netlify', label: 'Netlify', icon: '🚀' },
  { id: 'cloudflare', label: 'Cloudflare', icon: '☁️' },
  { id: 'aws', label: 'AWS', icon: '🟧' },
  { id: 'exa', label: 'Exa Search', icon: '🔍' },
  { id: 'openai-docs', label: 'OpenAI Docs', icon: '🤖' },
  { id: 'xai-docs', label: 'xAI/Grok Docs', icon: '⚡' },
];

let statusBar: vscode.StatusBarItem;
let bridgeActive = false;
let auditLog: string[] = [];

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('funesterie');
  const gateUrl = config.get<string>('gateUrl', 'https://mcp.funesterie.me/gate');

  // Status bar
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'funesterie.bridge.status';
  updateStatusBar(false);
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('funesterie.bridge.status', () => showStatus(gateUrl)),
    vscode.commands.registerCommand('funesterie.bridge.connect', () => connectBridge(gateUrl)),
    vscode.commands.registerCommand('funesterie.bridge.disconnect', () => disconnectBridge()),
    vscode.commands.registerCommand('funesterie.gate.list', () => listServices(gateUrl)),
  );

  // Tree view
  const serviceProvider = new ServiceTreeProvider(gateUrl);
  vscode.window.registerTreeDataProvider('funesterie.services', serviceProvider);

  const auditProvider = new AuditTreeProvider();
  vscode.window.registerTreeDataProvider('funesterie.audit', auditProvider);

  // Auto-connect
  if (config.get<boolean>('autoConnect', true)) {
    connectBridge(gateUrl);
  }

  vscode.window.showInformationMessage('Funesterie MCP Bridge activé');
}

function updateStatusBar(connected: boolean) {
  bridgeActive = connected;
  statusBar.text = connected ? '$(plug) Funesterie Gate' : '$(circle-slash) Funesterie';
  statusBar.tooltip = connected ? 'Zen Gate actif — tout MCP passe par Funesterie' : 'Bridge déconnecté';
  statusBar.color = connected ? '#7b2ff7' : undefined;
}

async function connectBridge(gateUrl: string) {
  try {
    const res = await fetch(`${gateUrl}/status`);
    const data = await res.json() as { ok: boolean; targets: string[]; totalRequests: number };
    if (data.ok) {
      updateStatusBar(true);
      auditLog.unshift(`[${new Date().toLocaleTimeString()}] Bridge connecté — ${data.targets.length} services, ${data.totalRequests} requêtes`);
      vscode.window.showInformationMessage(`Zen Gate connecté: ${data.targets.length} services MCP gatés`);
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Zen Gate inaccessible: ${(err as Error).message}`);
    updateStatusBar(false);
  }
}

function disconnectBridge() {
  updateStatusBar(false);
  auditLog.unshift(`[${new Date().toLocaleTimeString()}] Bridge déconnecté`);
  vscode.window.showInformationMessage('Funesterie bridge déconnecté');
}

async function showStatus(gateUrl: string) {
  try {
    const res = await fetch(`${gateUrl}/status`);
    const data = await res.json() as { ok: boolean; targets: string[]; totalRequests: number };
    const msg = `Zen Gate: ${data.ok ? 'OK' : 'DOWN'}\nServices: ${data.targets.join(', ')}\nRequêtes: ${data.totalRequests}`;
    vscode.window.showInformationMessage(msg);
  } catch (err) {
    vscode.window.showErrorMessage(`Gate status: ${(err as Error).message}`);
  }
}

async function listServices(gateUrl: string) {
  const items = GATE_SERVICES.map(s => ({
    label: `${s.icon} ${s.label}`,
    description: `${gateUrl}/${s.id}`,
    detail: s.id,
  }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Services MCP gatés par Funesterie' });
  if (picked) {
    vscode.env.openExternal(vscode.Uri.parse(`${gateUrl}/${picked.detail}`));
  }
}

// Tree providers
class ServiceTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  constructor(private gateUrl: string) {}

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

  getChildren(): vscode.TreeItem[] {
    return GATE_SERVICES.map(s => {
      const item = new vscode.TreeItem(`${s.icon} ${s.label}`, vscode.TreeItemCollapsibleState.None);
      item.description = bridgeActive ? 'gatéd' : 'off';
      item.tooltip = `${this.gateUrl}/${s.id}`;
      return item;
    });
  }
}

class AuditTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

  getChildren(): vscode.TreeItem[] {
    if (!auditLog.length) return [new vscode.TreeItem('Aucun log')];
    return auditLog.slice(0, 20).map(log => new vscode.TreeItem(log));
  }
}

export function deactivate() {
  bridgeActive = false;
}
