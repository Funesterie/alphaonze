/**
 * github-client.cjs
 *
 * Module GitHub pour A11 — utilise A11_GH (Personal Access Token) depuis l'env.
 *
 * Capacités :
 * - Lire les issues, PRs, branches, commits du repo Funesterie
 * - Créer des issues, commenter, fermer
 * - Pusher des fichiers via l'API Contents
 * - Lister les workflows GitHub Actions
 * - Créer des releases
 *
 * Usage :
 *   const { createGitHubClient } = require('./github-client.cjs');
 *   const gh = createGitHubClient();
 *   const issues = await gh.listIssues();
 */

const GITHUB_API = 'https://api.github.com';
const DEFAULT_OWNER = 'Funesterie';
const DEFAULT_REPO = 'alphaonze';

function getToken() {
  const token = process.env.A11_GH || process.env.GITHUB_TOKEN || '';
  if (!token) {
    throw new Error('A11_GH non configuré — ajoute le token GitHub dans .env.local');
  }
  return token;
}

function buildHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'A11-funesterie/1.0',
  };
}

async function ghFetch(path, options = {}) {
  const token = getToken();
  const url = path.startsWith('https://') ? path : `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...buildHeaders(token),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    let errorBody = '';
    try { errorBody = await res.text(); } catch (_) {}
    throw new Error(`GitHub API ${res.status} ${res.statusText} — ${path}\n${errorBody}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

function createGitHubClient(options = {}) {
  const owner = options.owner || DEFAULT_OWNER;
  const repo = options.repo || DEFAULT_REPO;
  const base = `/repos/${owner}/${repo}`;

  return {
    // ── Repo ──────────────────────────────────────────────────────────────────

    async getRepo() {
      return ghFetch(base);
    },

    // ── Issues ────────────────────────────────────────────────────────────────

    async listIssues({ state = 'open', per_page = 20, page = 1 } = {}) {
      return ghFetch(`${base}/issues?state=${state}&per_page=${per_page}&page=${page}`);
    },

    async getIssue(number) {
      return ghFetch(`${base}/issues/${number}`);
    },

    async createIssue({ title, body = '', labels = [], assignees = [] }) {
      return ghFetch(`${base}/issues`, {
        method: 'POST',
        body: JSON.stringify({ title, body, labels, assignees }),
      });
    },

    async commentIssue(number, body) {
      return ghFetch(`${base}/issues/${number}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
    },

    async closeIssue(number) {
      return ghFetch(`${base}/issues/${number}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed' }),
      });
    },

    // ── Pull Requests ─────────────────────────────────────────────────────────

    async listPRs({ state = 'open', per_page = 20 } = {}) {
      return ghFetch(`${base}/pulls?state=${state}&per_page=${per_page}`);
    },

    async getPR(number) {
      return ghFetch(`${base}/pulls/${number}`);
    },

    async createPR({ title, body = '', head, base: prBase = 'main', draft = false }) {
      return ghFetch(`${base}/pulls`, {
        method: 'POST',
        body: JSON.stringify({ title, body, head, base: prBase, draft }),
      });
    },

    // ── Branches ──────────────────────────────────────────────────────────────

    async listBranches({ per_page = 30 } = {}) {
      return ghFetch(`${base}/branches?per_page=${per_page}`);
    },

    async getBranch(branchName) {
      return ghFetch(`${base}/branches/${encodeURIComponent(branchName)}`);
    },

    // ── Commits ───────────────────────────────────────────────────────────────

    async listCommits({ sha = '', per_page = 20, page = 1 } = {}) {
      const q = new URLSearchParams({ per_page: String(per_page), page: String(page) });
      if (sha) q.set('sha', sha);
      return ghFetch(`${base}/commits?${q}`);
    },

    async getCommit(ref) {
      return ghFetch(`${base}/commits/${ref}`);
    },

    // ── Fichiers (Contents API) ───────────────────────────────────────────────

    async getFile(filePath, ref = '') {
      const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      return ghFetch(`${base}/contents/${filePath}${q}`);
    },

    /**
     * Crée ou met à jour un fichier via l'API Contents.
     * @param {string} filePath - Chemin dans le repo (ex: "docs/README.md")
     * @param {string} content  - Contenu en clair (sera encodé en base64)
     * @param {string} message  - Message de commit
     * @param {string} branch   - Branche cible
     */
    async putFile({ filePath, content, message, branch = 'main' }) {
      // Récupérer le SHA si le fichier existe déjà
      let sha;
      try {
        const existing = await this.getFile(filePath, branch);
        sha = existing?.sha;
      } catch (_) {
        // Fichier inexistant — création
      }

      const encoded = Buffer.from(content, 'utf-8').toString('base64');
      const body = { message, content: encoded, branch };
      if (sha) body.sha = sha;

      return ghFetch(`${base}/contents/${filePath}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    },

    // ── Workflows GitHub Actions ──────────────────────────────────────────────

    async listWorkflows() {
      return ghFetch(`${base}/actions/workflows`);
    },

    async listWorkflowRuns({ workflow_id = '', per_page = 10 } = {}) {
      const path = workflow_id
        ? `${base}/actions/workflows/${workflow_id}/runs?per_page=${per_page}`
        : `${base}/actions/runs?per_page=${per_page}`;
      return ghFetch(path);
    },

    async triggerWorkflow(workflow_id, { ref = 'main', inputs = {} } = {}) {
      return ghFetch(`${base}/actions/workflows/${workflow_id}/dispatches`, {
        method: 'POST',
        body: JSON.stringify({ ref, inputs }),
      });
    },

    // ── Releases ──────────────────────────────────────────────────────────────

    async listReleases({ per_page = 10 } = {}) {
      return ghFetch(`${base}/releases?per_page=${per_page}`);
    },

    async createRelease({ tag_name, name, body = '', draft = false, prerelease = false }) {
      return ghFetch(`${base}/releases`, {
        method: 'POST',
        body: JSON.stringify({ tag_name, name, body, draft, prerelease }),
      });
    },

    // ── Utilitaires ───────────────────────────────────────────────────────────

    /**
     * Vérifie que le token est valide et retourne l'identité GitHub.
     */
    async whoami() {
      return ghFetch('/user');
    },

    /**
     * Résumé rapide du repo pour A11 (issues ouvertes, dernière branche, dernier commit).
     */
    async summary() {
      const [repoInfo, issues, branches, commits] = await Promise.all([
        this.getRepo().catch(() => null),
        this.listIssues({ state: 'open', per_page: 5 }).catch(() => []),
        this.listBranches({ per_page: 10 }).catch(() => []),
        this.listCommits({ per_page: 5 }).catch(() => []),
      ]);

      return {
        repo: repoInfo?.full_name || `${owner}/${repo}`,
        description: repoInfo?.description || '',
        defaultBranch: repoInfo?.default_branch || 'main',
        openIssues: Array.isArray(issues) ? issues.length : 0,
        branches: Array.isArray(branches) ? branches.map((b) => b.name) : [],
        latestCommit: Array.isArray(commits) && commits[0] ? {
          sha: commits[0].sha?.slice(0, 7),
          message: commits[0].commit?.message?.split('\n')[0],
          author: commits[0].commit?.author?.name,
          date: commits[0].commit?.author?.date,
        } : null,
      };
    },
  };
}

module.exports = { createGitHubClient };
