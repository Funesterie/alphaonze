import * as vscode from 'vscode';
import type { AuthManager } from '../auth/AuthManager';
import type { A11Client } from '../api/A11Client';

export interface ConversationItem {
  id: string;
  title: string;
  timestamp: number;
  messageCount: number;
}

export class HistoryTreeDataProvider implements vscode.TreeDataProvider<ConversationItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ConversationItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private conversations: ConversationItem[] = [];

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  addConversation(item: ConversationItem): void {
    this.conversations.unshift(item);
    if (this.conversations.length > 50) {
      this.conversations = this.conversations.slice(0, 50);
    }
    this.refresh();
  }

  getTreeItem(element: ConversationItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.title, vscode.TreeItemCollapsibleState.None);
    item.description = new Date(element.timestamp).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    item.tooltip = `${element.messageCount} message(s) — ${new Date(element.timestamp).toLocaleString('fr-FR')}`;
    item.iconPath = new vscode.ThemeIcon('comment-discussion');
    item.command = {
      command: 'a11.openChat',
      title: 'Ouvrir la conversation',
      arguments: [element.id],
    };
    return item;
  }

  getChildren(): ConversationItem[] {
    return this.conversations;
  }
}

export class StatusTreeDataProvider implements vscode.TreeDataProvider<StatusItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<StatusItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private authManager: AuthManager;
  private client: A11Client;
  private items: StatusItem[] = [];

  constructor(authManager: AuthManager, client: A11Client) {
    this.authManager = authManager;
    this.client = client;
  }

  async refresh(): Promise<void> {
    const isAuth = await this.authManager.isAuthenticated();
    const status = await this.client.getStatus();
    const user = this.authManager.getUser();

    this.items = [
      {
        label: status.online ? '🟢 Serveur en ligne' : '🔴 Serveur hors ligne',
        description: status.version ? `v${status.version}` : '',
        icon: status.online ? 'check' : 'error',
      },
      {
        label: isAuth ? `👤 ${user?.email || 'Connecté'}` : '👤 Non connecté',
        description: isAuth ? (user?.plan === 'premium' ? 'Premium' : 'Gratuit') : 'Mode essai',
        icon: isAuth ? 'account' : 'person',
      },
      {
        label: isAuth ? '∞ Requêtes illimitées' : `🎯 ${this.authManager.getTrialRemaining()} requêtes restantes`,
        description: isAuth ? '' : `/ 50 essai gratuit`,
        icon: 'pulse',
      },
    ];

    if (status.models && status.models.length > 0) {
      this.items.push({
        label: `🤖 Modèle: ${vscode.workspace.getConfiguration('a11').get<string>('model', 'gpt-4o-mini')}`,
        description: `${status.models.length} modèle(s) disponible(s)`,
        icon: 'hubot',
      });
    }

    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: StatusItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    item.iconPath = new vscode.ThemeIcon(element.icon);
    return item;
  }

  getChildren(): StatusItem[] {
    return this.items;
  }
}

interface StatusItem {
  label: string;
  description: string;
  icon: string;
}
