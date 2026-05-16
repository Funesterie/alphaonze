import * as vscode from 'vscode';
import type { AuthManager } from '../auth/AuthManager';
import type { A11Client } from '../api/A11Client';
import type { ChatViewProvider } from '../providers/ChatViewProvider';
import type { StatusBarProvider } from '../providers/StatusBarProvider';

function getEditorContext(): { code: string; language: string; selection: boolean } | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;

  const language = editor.document.languageId;
  const selection = editor.selection;

  if (!selection.isEmpty) {
    return {
      code: editor.document.getText(selection),
      language,
      selection: true,
    };
  }

  return {
    code: editor.document.getText(),
    language,
    selection: false,
  };
}

async function getGitDiff(): Promise<string> {
  try {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) return '';

    const git = gitExtension.exports.getAPI(1);
    if (!git.repositories.length) return '';

    const repo = git.repositories[0];
    const diff = await repo.diff(true); // staged diff
    return diff || await repo.diff(false); // unstaged if no staged
  } catch {
    return '';
  }
}

export function registerCommands(
  context: vscode.ExtensionContext,
  authManager: AuthManager,
  client: A11Client,
  chatProvider: ChatViewProvider,
  statusBar: StatusBarProvider
): void {

  // ─── Chat ───────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('a11.chat', async () => {
      await vscode.commands.executeCommand('a11.chatView.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('a11.openChat', async () => {
      await vscode.commands.executeCommand('a11.chatView.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('a11.newConversation', () => {
      chatProvider.newConversation();
      vscode.commands.executeCommand('a11.chatView.focus');
    })
  );

  // ─── Explain ────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('a11.explain', async () => {
      const ctx = getEditorContext();
      if (!ctx) {
        vscode.window.showWarningMessage('A11: Ouvrez un fichier pour expliquer du code.');
        return;
      }
      if (!ctx.selection && ctx.code.length > 10000) {
        vscode.window.showWarningMessage('A11: Sélectionnez du code à expliquer (fichier trop grand).');
        return;
      }

      await vscode.commands.executeCommand('a11.chatView.focus');
      await chatProvider.sendCommand(
        `Explique ce code ${ctx.language}`,
        ctx.code,
        ctx.language
      );
    })
  );

  // ─── Fix ────────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('a11.fix', async () => {
      const ctx = getEditorContext();
      if (!ctx) {
        vscode.window.showWarningMessage('A11: Ouvrez un fichier pour corriger des erreurs.');
        return;
      }

      // Try to get diagnostics for current file
      const editor = vscode.window.activeTextEditor;
      let errorContext = '';
      if (editor) {
        const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
        const errors = diagnostics
          .filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
          .map((d) => `Ligne ${d.range.start.line + 1}: ${d.message}`)
          .slice(0, 10)
          .join('\n');
        if (errors) {
          errorContext = `\n\nErreurs détectées:\n${errors}`;
        }
      }

      await vscode.commands.executeCommand('a11.chatView.focus');
      await chatProvider.sendCommand(
        `Corrige les erreurs dans ce code ${ctx.language}${errorContext}`,
        ctx.code,
        ctx.language
      );
    })
  );

  // ─── Refactor ───────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('a11.refactor', async () => {
      const ctx = getEditorContext();
      if (!ctx) {
        vscode.window.showWarningMessage('A11: Sélectionnez du code à refactoriser.');
        return;
      }

      await vscode.commands.executeCommand('a11.chatView.focus');
      await chatProvider.sendCommand(
        `Refactorise ce code ${ctx.language}`,
        ctx.code,
        ctx.language
      );
    })
  );

  // ─── Generate ───────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('a11.generate', async () => {
      const editor = vscode.window.activeTextEditor;
      const language = editor?.document.languageId || 'typescript';

      const description = await vscode.window.showInputBox({
        prompt: 'Décrivez le code à générer',
        placeHolder: 'Ex: Une fonction qui trie un tableau d\'objets par date',
      });

      if (!description) return;

      await vscode.commands.executeCommand('a11.chatView.focus');
      await chatProvider.sendCommand(
        `Génère du code ${language} pour: ${description}`,
        undefined,
        language
      );
    })
  );

  // ─── Test ───────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('a11.test', async () => {
      const ctx = getEditorContext();
      if (!ctx) {
        vscode.window.showWarningMessage('A11: Sélectionnez du code pour générer des tests.');
        return;
      }

      await vscode.commands.executeCommand('a11.chatView.focus');
      await chatProvider.sendCommand(
        `Génère des tests unitaires complets pour ce code ${ctx.language}`,
        ctx.code,
        ctx.language
      );
    })
  );

  // ─── Review ─────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('a11.review', async () => {
      const ctx = getEditorContext();
      if (!ctx) {
        vscode.window.showWarningMessage('A11: Ouvrez un fichier pour une code review.');
        return;
      }

      await vscode.commands.executeCommand('a11.chatView.focus');
      await chatProvider.sendCommand(
        `Effectue une code review complète de ce code ${ctx.language}`,
        ctx.code,
        ctx.language
      );
    })
  );

  // ─── Commit ─────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('a11.commit', async () => {
      const diff = await getGitDiff();
      if (!diff) {
        vscode.window.showWarningMessage('A11: Aucun diff git trouvé. Faites des modifications d\'abord.');
        return;
      }

      await vscode.commands.executeCommand('a11.chatView.focus');
      await chatProvider.sendCommand(
        'Génère un message de commit git conventionnel pour ce diff',
        diff,
        'diff'
      );
    })
  );

  // ─── Docs ───────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('a11.docs', async () => {
      const ctx = getEditorContext();
      if (!ctx) {
        vscode.window.showWarningMessage('A11: Sélectionnez du code pour générer la documentation.');
        return;
      }

      await vscode.commands.executeCommand('a11.chatView.focus');
      await chatProvider.sendCommand(
        `Génère la documentation complète pour ce code ${ctx.language}`,
        ctx.code,
        ctx.language
      );
    })
  );

  // ─── Optimize ───────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('a11.optimize', async () => {
      const ctx = getEditorContext();
      if (!ctx) {
        vscode.window.showWarningMessage('A11: Sélectionnez du code à optimiser.');
        return;
      }

      await vscode.commands.executeCommand('a11.chatView.focus');
      await chatProvider.sendCommand(
        `Optimise les performances de ce code ${ctx.language}`,
        ctx.code,
        ctx.language
      );
    })
  );

  // ─── Security ───────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('a11.security', async () => {
      const ctx = getEditorContext();
      if (!ctx) {
        vscode.window.showWarningMessage('A11: Ouvrez un fichier pour un audit de sécurité.');
        return;
      }

      await vscode.commands.executeCommand('a11.chatView.focus');
      await chatProvider.sendCommand(
        `Effectue un audit de sécurité complet de ce code ${ctx.language}`,
        ctx.code,
        ctx.language
      );
    })
  );

  // ─── Auth ───────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('a11.login', async () => {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(account) Connexion avec Google', value: 'google' },
          { label: '$(mail) Connexion avec email/mot de passe', value: 'email' },
        ],
        { placeHolder: 'Choisissez une méthode de connexion' }
      );

      if (!choice) return;

      if (choice.value === 'google') {
        await vscode.commands.executeCommand('a11.loginWithGoogle');
      } else {
        const email = await vscode.window.showInputBox({
          prompt: 'Adresse email',
          placeHolder: 'votre@email.com',
          validateInput: (v) => v.includes('@') ? null : 'Email invalide',
        });
        if (!email) return;

        const password = await vscode.window.showInputBox({
          prompt: 'Mot de passe',
          password: true,
        });
        if (!password) return;

        const success = await authManager.login(email, password);
        if (success) {
          await chatProvider.refreshAuth();
          await statusBar.update();
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('a11.loginWithGoogle', async () => {
      const success = await authManager.loginWithGoogle();
      if (success) {
        await chatProvider.refreshAuth();
        await statusBar.update();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('a11.logout', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'A11: Se déconnecter ?',
        { modal: true },
        'Se déconnecter'
      );
      if (confirm === 'Se déconnecter') {
        await authManager.logout();
        await chatProvider.refreshAuth();
        await statusBar.update();
      }
    })
  );

  // ─── Status ─────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('a11.status', async () => {
      const status = await client.getStatus();
      const isAuth = await authManager.isAuthenticated();
      const user = authManager.getUser();

      const lines = [
        `Serveur: ${status.online ? '🟢 En ligne' : '🔴 Hors ligne'}`,
        status.version ? `Version: ${status.version}` : '',
        `Auth: ${isAuth ? `✅ ${user?.email}` : '❌ Non connecté'}`,
        `Essai: ${authManager.getTrialCount()}/50 requêtes utilisées`,
      ].filter(Boolean);

      vscode.window.showInformationMessage(`A11 Status\n${lines.join('\n')}`);
    })
  );

  // ─── Inline Chat ────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('a11.inlineChat', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('A11: Ouvrez un fichier pour utiliser le chat inline.');
        return;
      }

      const prompt = await vscode.window.showInputBox({
        prompt: 'A11 — Que voulez-vous faire avec ce code ?',
        placeHolder: 'Ex: Ajoute de la gestion d\'erreurs, Optimise cette fonction...',
      });

      if (!prompt) return;

      const ctx = getEditorContext();
      if (!ctx) return;

      // Show progress
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'A11: Traitement en cours...',
          cancellable: false,
        },
        async () => {
          const check = await authManager.checkAndConsumeRequest();
          if (!check.allowed) {
            vscode.window.showErrorMessage('A11: Essai épuisé. Connectez-vous pour continuer.');
            return;
          }

          try {
            const response = await client.chat(prompt, { code: ctx.code, language: ctx.language });

            // Extract code blocks from response
            const codeBlockMatch = response.content.match(/```[\w]*\n([\s\S]*?)```/);
            if (codeBlockMatch) {
              const extractedCode = codeBlockMatch[1].trim();
              const action = await vscode.window.showInformationMessage(
                'A11: Code généré. Que faire ?',
                'Appliquer',
                'Voir dans le chat',
                'Copier'
              );

              if (action === 'Appliquer') {
                await editor.edit((editBuilder) => {
                  if (!editor.selection.isEmpty) {
                    editBuilder.replace(editor.selection, extractedCode);
                  } else {
                    const line = editor.selection.active.line;
                    const lineEnd = editor.document.lineAt(line).range.end;
                    editBuilder.insert(lineEnd, '\n' + extractedCode);
                  }
                });
              } else if (action === 'Voir dans le chat') {
                await vscode.commands.executeCommand('a11.chatView.focus');
                await chatProvider.sendCommand(prompt, ctx.code, ctx.language);
              } else if (action === 'Copier') {
                await vscode.env.clipboard.writeText(extractedCode);
                vscode.window.showInformationMessage('A11: Code copié dans le presse-papiers.');
              }
            } else {
              // No code block, show in chat
              await vscode.commands.executeCommand('a11.chatView.focus');
              await chatProvider.sendCommand(prompt, ctx.code, ctx.language);
            }
          } catch (error) {
            vscode.window.showErrorMessage(`A11: Erreur — ${(error as Error).message}`);
          }
        }
      );
    })
  );
}
