import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { AuthManager } from '../auth/AuthManager';
import type { A11Client } from '../api/A11Client';
import type { ChatMessage } from '../api/A11Client';
import type { HistoryTreeDataProvider } from './TreeDataProvider';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'a11.chatView';

  private view?: vscode.WebviewView;
  private authManager: AuthManager;
  private client: A11Client;
  private historyProvider: HistoryTreeDataProvider;
  private extensionUri: vscode.Uri;
  private conversationHistory: ChatMessage[] = [];
  private currentConversationId: string = this.generateId();

  constructor(
    extensionUri: vscode.Uri,
    authManager: AuthManager,
    client: A11Client,
    historyProvider: HistoryTreeDataProvider
  ) {
    this.extensionUri = extensionUri;
    this.authManager = authManager;
    this.client = client;
    this.historyProvider = historyProvider;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'media'),
        vscode.Uri.joinPath(this.extensionUri, 'src', 'webview'),
        vscode.Uri.joinPath(this.extensionUri, 'out'),
      ],
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this.handleMessage(message);
    });

    // Send initial state
    this.sendInitialState();
  }

  private async sendInitialState(): Promise<void> {
    if (!this.view) return;

    const isAuth = await this.authManager.isAuthenticated();
    const user = this.authManager.getUser();
    const trialRemaining = this.authManager.getTrialRemaining();
    const model = vscode.workspace.getConfiguration('a11').get<string>('model', 'gpt-4o-mini');

    this.view.webview.postMessage({
      type: 'init',
      isAuthenticated: isAuth,
      user,
      trialRemaining,
      model,
      conversationId: this.currentConversationId,
    });
  }

  private async handleMessage(message: { type: string; [key: string]: unknown }): Promise<void> {
    switch (message.type) {
      case 'sendMessage':
        await this.handleSendMessage(message.text as string, message.context as { code?: string; language?: string } | undefined);
        break;
      case 'login':
        await vscode.commands.executeCommand('a11.login');
        break;
      case 'loginGoogle':
        await vscode.commands.executeCommand('a11.loginWithGoogle');
        break;
      case 'logout':
        await vscode.commands.executeCommand('a11.logout');
        break;
      case 'newConversation':
        this.newConversation();
        break;
      case 'changeModel':
        await vscode.workspace.getConfiguration('a11').update('model', message.model as string, true);
        break;
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'a11');
        break;
      case 'copyCode':
        await vscode.env.clipboard.writeText(message.code as string);
        break;
      case 'applyCode':
        await this.applyCodeToEditor(message.code as string);
        break;
      case 'ready':
        await this.sendInitialState();
        break;
    }
  }

  private async handleSendMessage(text: string, context?: { code?: string; language?: string }): Promise<void> {
    if (!this.view) return;

    // Check trial/auth
    const check = await this.authManager.checkAndConsumeRequest();
    if (!check.allowed) {
      this.view.webview.postMessage({
        type: 'trialExhausted',
        message: 'Votre essai gratuit est épuisé. Connectez-vous pour continuer.',
      });
      return;
    }

    // Add user message to history
    this.conversationHistory.push({ role: 'user', content: text });

    // Show typing indicator
    this.view.webview.postMessage({ type: 'typing', show: true });

    // Start streaming response
    const messageId = this.generateId();
    this.view.webview.postMessage({ type: 'streamStart', messageId });

    let fullResponse = '';

    try {
      // Get current editor context if not provided
      const editorContext = context || this.getEditorContext();

      await this.client.chat(
        text,
        {
          code: editorContext?.code,
          language: editorContext?.language,
          history: this.conversationHistory.slice(-10), // Last 10 messages for context
        },
        (chunk) => {
          if (!this.view) return;
          if (chunk.delta) {
            fullResponse += chunk.delta;
            this.view.webview.postMessage({
              type: 'streamChunk',
              messageId,
              delta: chunk.delta,
            });
          }
          if (chunk.done) {
            this.view.webview.postMessage({
              type: 'streamEnd',
              messageId,
              content: fullResponse,
            });
          }
        }
      );

      // Add assistant response to history
      this.conversationHistory.push({ role: 'assistant', content: fullResponse });

      // Update trial count in UI
      if (!check.isAuthenticated) {
        this.view.webview.postMessage({
          type: 'trialUpdate',
          remaining: check.trialRemaining,
        });
      }

      // Update history tree
      this.historyProvider.addConversation({
        id: this.currentConversationId,
        title: text.slice(0, 50) + (text.length > 50 ? '…' : ''),
        timestamp: Date.now(),
        messageCount: this.conversationHistory.length,
      });

    } catch (error) {
      this.view.webview.postMessage({
        type: 'error',
        messageId,
        message: (error as Error).message,
      });
    } finally {
      if (this.view) {
        this.view.webview.postMessage({ type: 'typing', show: false });
      }
    }
  }

  private getEditorContext(): { code?: string; language?: string } | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;

    const selection = editor.selection;
    const language = editor.document.languageId;

    if (!selection.isEmpty) {
      return {
        code: editor.document.getText(selection),
        language,
      };
    }

    // Include full file if small enough
    const fullText = editor.document.getText();
    if (fullText.length < 8000) {
      return { code: fullText, language };
    }

    // Include surrounding context (±50 lines)
    const line = editor.selection.active.line;
    const start = Math.max(0, line - 50);
    const end = Math.min(editor.document.lineCount - 1, line + 50);
    const range = new vscode.Range(start, 0, end, editor.document.lineAt(end).text.length);
    return {
      code: editor.document.getText(range),
      language,
    };
  }

  private async applyCodeToEditor(code: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('A11: Aucun éditeur actif pour appliquer le code.');
      return;
    }

    await editor.edit((editBuilder) => {
      if (!editor.selection.isEmpty) {
        editBuilder.replace(editor.selection, code);
      } else {
        editBuilder.insert(editor.selection.active, code);
      }
    });
  }

  newConversation(): void {
    this.conversationHistory = [];
    this.currentConversationId = this.generateId();
    if (this.view) {
      this.view.webview.postMessage({
        type: 'newConversation',
        conversationId: this.currentConversationId,
      });
    }
  }

  async sendCommand(command: string, code?: string, language?: string): Promise<void> {
    if (!this.view) {
      await vscode.commands.executeCommand('a11.chatView.focus');
      // Wait for view to be ready
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (this.view) {
      this.view.webview.postMessage({
        type: 'injectMessage',
        text: command,
        code,
        language,
      });
      await this.handleSendMessage(command, code ? { code, language } : undefined);
    }
  }

  async refreshAuth(): Promise<void> {
    await this.sendInitialState();
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.html');
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'styles.css')
    );

    try {
      const nonce = this.generateId();
      let html = fs.readFileSync(htmlPath.fsPath, 'utf-8');
      html = html
        .replace(/{{STYLES_URI}}/g, stylesUri.toString())
        .replace(/{{NONCE}}/g, nonce)
        .replace(/{{CSP_SOURCE}}/g, webview.cspSource);
      return html;
    } catch {
      return this.getFallbackHtml(webview, stylesUri.toString());
    }
  }

  private getFallbackHtml(webview: vscode.Webview, stylesUri: string): string {
    const nonce = this.generateId();
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${stylesUri}">
  <title>A11 Chat</title>
</head>
<body>
  <div id="app">
    <p style="color: #8b949e; padding: 20px;">Chargement de l'interface A11...</p>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
