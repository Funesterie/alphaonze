import * as vscode from 'vscode';
import { A11Client } from './api/A11Client';
import { AuthManager } from './auth/AuthManager';
import { registerCommands } from './commands';
import { ChatViewProvider } from './providers/ChatViewProvider';
import { StatusBarProvider } from './providers/StatusBarProvider';
import { HistoryTreeDataProvider, StatusTreeDataProvider } from './providers/TreeDataProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const authManager = new AuthManager(context);
  const client = new A11Client(authManager);
  const historyProvider = new HistoryTreeDataProvider();
  const statusTreeProvider = new StatusTreeDataProvider(authManager, client);
  const chatProvider = new ChatViewProvider(
    context.extensionUri,
    authManager,
    client,
    historyProvider
  );
  const statusBarProvider = new StatusBarProvider(authManager, client);

  context.subscriptions.push(
    authManager,
    statusBarProvider,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider),
    vscode.window.registerTreeDataProvider('a11.historyView', historyProvider),
    vscode.window.registerTreeDataProvider('a11.statusView', statusTreeProvider)
  );

  context.subscriptions.push(
    authManager.onAuthChanged(async () => {
      await chatProvider.refreshAuth();
      await statusBarProvider.update();
      await statusTreeProvider.refresh();
    })
  );

  const statusRefreshTimer = setInterval(() => {
    void statusTreeProvider.refresh();
  }, 30_000);
  context.subscriptions.push({ dispose: () => clearInterval(statusRefreshTimer) });

  registerCommands(context, authManager, client, chatProvider, statusBarProvider);

  await statusBarProvider.initialize();
  await statusTreeProvider.refresh();
}

export function deactivate(): void {
  // Disposables registered in context.subscriptions are cleaned up by VS Code.
}
