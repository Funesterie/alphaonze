import * as vscode from 'vscode';
import * as http from 'http';
import * as url from 'url';
import * as crypto from 'crypto';
import type { AuthManager, UserInfo } from './AuthManager';

const DEFAULT_SERVER_URL = 'https://a11.funesterie.pro';
const DEFAULT_GOOGLE_CLIENT_ID = '';
const CALLBACK_HOST = 'localhost';
const CALLBACK_PORT = 9876;
const CALLBACK_PATH = '/callback';
const CALLBACK_TOKEN_PATH = '/callback-token';

type BackendAuthUser = {
  id?: string | number;
  email?: string;
  username?: string;
  name?: string;
  role?: string;
  plan?: 'free' | 'premium';
  fullAccess?: boolean;
  provider?: string;
};

type BackendAuthResponse = {
  token?: string;
  user?: BackendAuthUser;
  success?: boolean;
  error?: string;
  message?: string;
};

export class GoogleAuth {
  private authManager: AuthManager;

  constructor(authManager: AuthManager) {
    this.authManager = authManager;
  }

  async authenticate(): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('a11');
    const serverUrl = normalizeBaseUrl(config.get<string>('serverUrl', DEFAULT_SERVER_URL));
    const googleClientId = String(
      config.get<string>('googleClientId', DEFAULT_GOOGLE_CLIENT_ID) || DEFAULT_GOOGLE_CLIENT_ID
    ).trim();

    if (!googleClientId) {
      vscode.window.showErrorMessage('A11: client ID Google manquant. Configure a11.googleClientId pour activer Google OAuth.');
      return false;
    }

    const state = crypto.randomBytes(16).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');
    const redirectUri = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;
    const authUrl = buildGoogleAuthUrl({ clientId: googleClientId, redirectUri, state, nonce });

    return new Promise<boolean>((resolve) => {
      let server: http.Server | null = null;
      let resolved = false;

      const cleanup = () => {
        if (server) {
          server.close();
          server = null;
        }
      };

      const finish = (success: boolean) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(success);
        }
      };

      const timeout = setTimeout(() => {
        vscode.window.showWarningMessage('A11: delai de connexion Google expire.');
        finish(false);
      }, 5 * 60 * 1000);

      server = http.createServer(async (req, res) => {
        if (!req.url) {
          res.end();
          return;
        }

        const parsed = url.parse(req.url, true);

        if (req.method === 'GET' && parsed.pathname === CALLBACK_PATH) {
          const queryError = getFirstQueryValue(parsed.query.error);
          if (queryError) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(this.buildCallbackHtml(false, `Erreur OAuth: ${queryError}`));
            clearTimeout(timeout);
            finish(false);
            return;
          }

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(this.buildFragmentRelayHtml());
          return;
        }

        if (req.method === 'POST' && parsed.pathname === CALLBACK_TOKEN_PATH) {
          try {
            const body = await readJsonBody(req);
            const returnedState = String(body.state || '').trim();
            const idToken = String(body.id_token || body.idToken || '').trim();
            const oauthError = String(body.error || '').trim();

            if (oauthError) {
              throw new Error(`OAuth Google: ${oauthError}`);
            }

            if (returnedState !== state) {
              throw new Error('Etat OAuth invalide.');
            }

            if (!idToken) {
              throw new Error('Jeton Google manquant.');
            }

            const authData = await exchangeGoogleIdToken({ serverUrl, idToken });
            const user = normalizeBackendUser(authData.user);

            await this.authManager.storeToken(authData.token);
            await this.authManager.storeUser(user);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true, name: user.name }));

            clearTimeout(timeout);
            vscode.window.showInformationMessage(`A11: connecte en tant que ${user.email || user.name}`);
            finish(true);
          } catch (error) {
            const message = (error as Error).message || 'Connexion Google impossible.';
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, message }));
            clearTimeout(timeout);
            finish(false);
          }
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      });

      server.on('error', (err) => {
        vscode.window.showErrorMessage(`A11: impossible de demarrer le callback OAuth local - ${err.message}`);
        clearTimeout(timeout);
        finish(false);
      });

      server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
        vscode.env.openExternal(vscode.Uri.parse(authUrl)).then((opened) => {
          if (!opened) {
            vscode.window.showErrorMessage('A11: impossible d\'ouvrir le navigateur pour Google.');
            clearTimeout(timeout);
            finish(false);
          }
        });
      });
    });
  }

  private buildFragmentRelayHtml(): string {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>A11 - Connexion Google</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0d1117;
      color: #e6edf3;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 40px;
      text-align: center;
      max-width: 420px;
    }
    h1 { color: #4ade80; margin: 0 0 12px; font-size: 24px; }
    p { color: #8b949e; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1 id="title">Connexion en cours</h1>
    <p id="message">Retour vers A11...</p>
  </div>
  <script>
    (async () => {
      const title = document.getElementById('title');
      const message = document.getElementById('message');
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const query = new URLSearchParams(window.location.search);
      const payload = {
        id_token: fragment.get('id_token') || query.get('id_token') || '',
        state: fragment.get('state') || query.get('state') || '',
        error: fragment.get('error') || query.get('error') || ''
      };

      try {
        const response = await fetch('${CALLBACK_TOKEN_PATH}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
          throw new Error(data.message || data.error || 'Connexion impossible');
        }
        title.textContent = 'Connexion reussie';
        message.textContent = 'Vous pouvez fermer cet onglet.';
        setTimeout(() => window.close(), 1200);
      } catch (error) {
        title.textContent = 'Connexion echouee';
        title.style.color = '#f87171';
        message.textContent = error && error.message ? error.message : 'Connexion Google impossible';
      }
    })();
  </script>
</body>
</html>`;
  }

  private buildCallbackHtml(success: boolean, message: string): string {
    const title = success ? 'Connexion reussie' : 'Connexion echouee';
    const color = success ? '#4ade80' : '#f87171';

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>A11 - ${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0d1117;
      color: #e6edf3;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 40px;
      text-align: center;
      max-width: 420px;
    }
    h1 { color: ${color}; margin: 0 0 12px; font-size: 24px; }
    p { color: #8b949e; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
  <script>
    ${success ? 'setTimeout(() => window.close(), 1200);' : ''}
  </script>
</body>
</html>`;
  }
}

function normalizeBaseUrl(value: string): string {
  return String(value || DEFAULT_SERVER_URL).trim().replace(/\/+$/g, '') || DEFAULT_SERVER_URL;
}

function buildGoogleAuthUrl({
  clientId,
  redirectUri,
  state,
  nonce,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
}): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'id_token',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeGoogleIdToken({
  serverUrl,
  idToken,
}: {
  serverUrl: string;
  idToken: string;
}): Promise<{ token: string; user: BackendAuthUser }> {
  const tokenResponse = await fetch(`${serverUrl}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential: idToken }),
  });

  const data = await tokenResponse.json().catch(() => ({})) as BackendAuthResponse;
  if (!tokenResponse.ok || !data?.token) {
    throw new Error(data?.message || data?.error || 'Erreur serveur');
  }

  return {
    token: data.token,
    user: data.user || {},
  };
}

function normalizeBackendUser(user: BackendAuthUser = {}): UserInfo {
  const email = String(user.email || '').trim();
  const name = String(user.name || user.username || email || 'Google').trim();
  const fullAccess = user.fullAccess === true || String(user.role || '').toLowerCase() === 'admin';
  const plan: 'free' | 'premium' = user.plan === 'premium' || fullAccess ? 'premium' : 'free';

  return {
    id: String(user.id || email || 'google-user'),
    email,
    name,
    username: user.username,
    role: user.role,
    plan,
    fullAccess,
    provider: user.provider || 'google',
  };
}

function getFirstQueryValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 128 * 1024) {
        reject(new Error('Payload OAuth trop volumineux.'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Payload OAuth invalide.'));
      }
    });

    req.on('error', reject);
  });
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
