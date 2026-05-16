import * as vscode from 'vscode';

const TRIAL_LIMIT = 50;
const TOKEN_KEY = 'a11.jwt.token';
const USER_KEY = 'a11.user.info';

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  plan: 'free' | 'premium';
  username?: string;
  role?: string;
  fullAccess?: boolean;
  provider?: string;
}

export class AuthManager {
  private context: vscode.ExtensionContext;
  private _onAuthChanged = new vscode.EventEmitter<boolean>();
  readonly onAuthChanged = this._onAuthChanged.event;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async login(email: string, password: string): Promise<boolean> {
    try {
      const serverUrl = vscode.workspace.getConfiguration('a11').get<string>('serverUrl', 'https://a11.funesterie.pro');
      const response = await fetch(`${serverUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: 'Erreur de connexion' }));
        throw new Error((err as { message?: string }).message || 'Erreur de connexion');
      }

      const data = await response.json() as { token: string; user: UserInfo };
      await this.storeToken(data.token);
      await this.storeUser(data.user);
      this._onAuthChanged.fire(true);
      return true;
    } catch (error) {
      vscode.window.showErrorMessage(`A11: Connexion échouée — ${(error as Error).message}`);
      return false;
    }
  }

  async loginWithGoogle(): Promise<boolean> {
    try {
      const { GoogleAuth } = await import('./GoogleAuth');
      const googleAuth = new GoogleAuth(this);
      return await googleAuth.authenticate();
    } catch (error) {
      vscode.window.showErrorMessage(`A11: OAuth Google échoué — ${(error as Error).message}`);
      return false;
    }
  }

  async logout(): Promise<void> {
    await this.context.secrets.delete(TOKEN_KEY);
    await this.context.globalState.update(USER_KEY, undefined);
    this._onAuthChanged.fire(false);
    vscode.window.showInformationMessage('A11: Déconnecté.');
  }

  async getToken(): Promise<string | undefined> {
    return this.context.secrets.get(TOKEN_KEY);
  }

  async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    if (!token) return false;
    // Basic JWT expiry check
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        await this.logout();
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async storeToken(token: string): Promise<void> {
    await this.context.secrets.store(TOKEN_KEY, token);
  }

  async storeUser(user: UserInfo): Promise<void> {
    await this.context.globalState.update(USER_KEY, user);
  }

  getUser(): UserInfo | undefined {
    return this.context.globalState.get<UserInfo>(USER_KEY);
  }

  getTrialCount(): number {
    return this.context.globalState.get<number>('a11.trialCount', 0);
  }

  async incrementTrialCount(): Promise<number> {
    const count = this.getTrialCount() + 1;
    await this.context.globalState.update('a11.trialCount', count);
    return count;
  }

  getTrialRemaining(): number {
    return Math.max(0, TRIAL_LIMIT - this.getTrialCount());
  }

  isTrialExhausted(): boolean {
    return this.getTrialCount() >= TRIAL_LIMIT;
  }

  async checkAndConsumeRequest(): Promise<{ allowed: boolean; isAuthenticated: boolean; trialRemaining: number }> {
    const authenticated = await this.isAuthenticated();
    if (authenticated) {
      return { allowed: true, isAuthenticated: true, trialRemaining: -1 };
    }

    if (this.isTrialExhausted()) {
      return { allowed: false, isAuthenticated: false, trialRemaining: 0 };
    }

    const remaining = this.getTrialRemaining();
    await this.incrementTrialCount();
    return { allowed: true, isAuthenticated: false, trialRemaining: remaining - 1 };
  }

  dispose(): void {
    this._onAuthChanged.dispose();
  }
}
