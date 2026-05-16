import * as vscode from 'vscode';
import type { AuthManager } from '../auth/AuthManager';
import type { A11Client } from '../api/A11Client';

export class StatusBarProvider {
  private statusBarItem: vscode.StatusBarItem;
  private authManager: AuthManager;
  private client: A11Client;
  private checkInterval: NodeJS.Timeout | undefined;

  constructor(authManager: AuthManager, client: A11Client) {
    this.authManager = authManager;
    this.client = client;

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'a11.openChat';
    this.statusBarItem.show();
  }

  async initialize(): Promise<void> {
    await this.update();
    // Check status every 30 seconds
    this.checkInterval = setInterval(() => this.update(), 30_000);
  }

  async update(): Promise<void> {
    const isAuth = await this.authManager.isAuthenticated();
    const status = await this.client.getStatus();

    if (!status.online) {
      this.statusBarItem.text = '$(circle-slash) A11 ✗';
      this.statusBarItem.tooltip = 'A11: Serveur hors ligne — Cliquer pour ouvrir le chat';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      return;
    }

    if (isAuth) {
      const user = this.authManager.getUser();
      this.statusBarItem.text = '$(sparkle) A11 ✓';
      this.statusBarItem.tooltip = `A11: Connecté${user ? ` (${user.email})` : ''} — Cliquer pour ouvrir le chat`;
      this.statusBarItem.backgroundColor = undefined;
    } else {
      const remaining = this.authManager.getTrialRemaining();
      if (remaining === 0) {
        this.statusBarItem.text = '$(warning) A11 ⚠';
        this.statusBarItem.tooltip = 'A11: Essai épuisé — Se connecter pour continuer';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      } else {
        this.statusBarItem.text = `$(sparkle) A11 ⚠ ${remaining}`;
        this.statusBarItem.tooltip = `A11: Mode essai — ${remaining} requêtes restantes — Cliquer pour ouvrir le chat`;
        this.statusBarItem.backgroundColor = undefined;
      }
    }
  }

  dispose(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    this.statusBarItem.dispose();
  }
}
