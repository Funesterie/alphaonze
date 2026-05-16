import * as vscode from 'vscode';
import type { AuthManager } from '../auth/AuthManager';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

export interface StreamChunk {
  delta: string;
  done: boolean;
}

export type StreamCallback = (chunk: StreamChunk) => void;

export class A11Client {
  private authManager: AuthManager;

  constructor(authManager: AuthManager) {
    this.authManager = authManager;
  }

  private getServerUrl(): string {
    return vscode.workspace.getConfiguration('a11').get<string>('serverUrl', 'https://a11.funesterie.pro');
  }

  private getModel(): string {
    return vscode.workspace.getConfiguration('a11').get<string>('model', 'gpt-4o-mini');
  }

  private async buildHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client': 'vscode-a11',
      'X-Version': '0.1.0',
    };

    const token = await this.authManager.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const trialCount = this.authManager.getTrialCount();
    headers['X-Trial-Count'] = String(trialCount);

    return headers;
  }

  async chat(
    message: string,
    context?: { code?: string; language?: string; history?: ChatMessage[] },
    onStream?: StreamCallback
  ): Promise<ChatResponse> {
    const serverUrl = this.getServerUrl();
    const model = this.getModel();
    const headers = await this.buildHeaders();

    const messages: ChatMessage[] = [];

    if (context?.history) {
      messages.push(...context.history);
    }

    if (context?.code) {
      messages.push({
        role: 'user',
        content: `\`\`\`${context.language || ''}\n${context.code}\n\`\`\`\n\n${message}`,
      });
    } else {
      messages.push({ role: 'user', content: message });
    }

    const payload = {
      message,
      messages,
      model,
      stream: !!onStream,
      context: context ? { code: context.code, language: context.language } : undefined,
    };

    if (onStream) {
      return this.streamRequest(`${serverUrl}/api/chat`, payload, headers, onStream);
    }

    const response = await fetch(`${serverUrl}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
      throw new Error((err as { message?: string }).message || `HTTP ${response.status}`);
    }

    const data = await response.json() as { response?: string; content?: string; model?: string };
    return {
      content: data.response || data.content || '',
      model: data.model || model,
    };
  }

  private async streamRequest(
    url: string,
    payload: unknown,
    headers: Record<string, string>,
    onStream: StreamCallback
  ): Promise<ChatResponse> {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
      throw new Error((err as { message?: string }).message || `HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Streaming non supporté par ce serveur');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let model = this.getModel();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              onStream({ delta: '', done: true });
              break;
            }
            try {
              const parsed = JSON.parse(data) as { delta?: string; content?: string; model?: string; done?: boolean };
              const delta = parsed.delta || parsed.content || '';
              if (parsed.model) model = parsed.model;
              if (delta) {
                fullContent += delta;
                onStream({ delta, done: false });
              }
              if (parsed.done) {
                onStream({ delta: '', done: true });
              }
            } catch {
              // Non-JSON SSE line, skip
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { content: fullContent, model };
  }

  async explain(code: string, language: string, onStream?: StreamCallback): Promise<ChatResponse> {
    const prompt = `Explique ce code ${language} de manière claire et concise. Décris ce qu'il fait, comment il fonctionne, et signale tout problème potentiel.`;
    return this.chat(prompt, { code, language }, onStream);
  }

  async fix(code: string, error: string, language: string, onStream?: StreamCallback): Promise<ChatResponse> {
    const prompt = `Corrige ce code ${language}. ${error ? `Erreur signalée: ${error}` : 'Identifie et corrige tous les bugs.'} Fournis le code corrigé avec une explication des changements.`;
    return this.chat(prompt, { code, language }, onStream);
  }

  async refactor(code: string, language: string, onStream?: StreamCallback): Promise<ChatResponse> {
    const prompt = `Refactorise ce code ${language} pour améliorer la lisibilité, la maintenabilité et les performances. Applique les meilleures pratiques. Fournis le code refactorisé avec une explication des changements.`;
    return this.chat(prompt, { code, language }, onStream);
  }

  async generate(description: string, language: string, onStream?: StreamCallback): Promise<ChatResponse> {
    const prompt = `Génère du code ${language} pour: ${description}. Fournis un code complet, fonctionnel et bien commenté.`;
    return this.chat(prompt, { language }, onStream);
  }

  async generateTests(code: string, language: string, onStream?: StreamCallback): Promise<ChatResponse> {
    const prompt = `Génère des tests unitaires complets pour ce code ${language}. Couvre les cas normaux, les cas limites et les cas d'erreur. Utilise le framework de test standard pour ${language}.`;
    return this.chat(prompt, { code, language }, onStream);
  }

  async review(code: string, language: string, onStream?: StreamCallback): Promise<ChatResponse> {
    const prompt = `Effectue une code review complète de ce code ${language}. Évalue: qualité du code, performance, sécurité, maintenabilité, respect des bonnes pratiques. Donne une note et des recommandations concrètes.`;
    return this.chat(prompt, { code, language }, onStream);
  }

  async generateCommitMessage(diff: string, onStream?: StreamCallback): Promise<ChatResponse> {
    const prompt = `Génère un message de commit git conventionnel (Conventional Commits) pour ce diff. Format: type(scope): description. Types: feat, fix, docs, style, refactor, test, chore. Sois concis et précis.`;
    return this.chat(prompt, { code: diff, language: 'diff' }, onStream);
  }

  async generateDocs(code: string, language: string, onStream?: StreamCallback): Promise<ChatResponse> {
    const prompt = `Génère la documentation complète pour ce code ${language}. Inclus: JSDoc/TSDoc/docstrings pour chaque fonction/classe, description des paramètres, valeurs de retour, exemples d'utilisation.`;
    return this.chat(prompt, { code, language }, onStream);
  }

  async optimize(code: string, language: string, onStream?: StreamCallback): Promise<ChatResponse> {
    const prompt = `Analyse et optimise les performances de ce code ${language}. Identifie les goulots d'étranglement, propose des optimisations concrètes avec le code amélioré et une explication des gains de performance.`;
    return this.chat(prompt, { code, language }, onStream);
  }

  async securityAudit(code: string, language: string, onStream?: StreamCallback): Promise<ChatResponse> {
    const prompt = `Effectue un audit de sécurité complet de ce code ${language}. Identifie: injections SQL/XSS/CSRF, mauvaise gestion des secrets, vulnérabilités OWASP Top 10, problèmes d'authentification/autorisation. Fournis des recommandations de correction.`;
    return this.chat(prompt, { code, language }, onStream);
  }

  async getStatus(): Promise<{ online: boolean; version?: string; models?: string[] }> {
    try {
      const serverUrl = this.getServerUrl();
      const response = await fetch(`${serverUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) return { online: false };

      const data = await response.json() as { version?: string; models?: string[]; status?: string };
      return { online: true, version: data.version, models: data.models };
    } catch {
      return { online: false };
    }
  }
}
