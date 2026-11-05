'use strict';

function safePath(path) {
  if (typeof path !== 'string' || !path || path.split('/').some(x => !x || x === '.' || x === '..')) {
    throw new Error('Invalid GitHub file path');
  }
  return path.split('/').map(encodeURIComponent).join('/');
}

class GitHubAdapter {
  constructor({ token, owner, ownerType = 'org', fetchImpl = globalThis.fetch }) {
    if (!token || typeof token !== 'string') throw new Error('Server-side GitHub token is required');
    if (!/^[A-Za-z0-9-]{1,39}$/.test(owner || '')) throw new Error('Invalid GitHub owner');
    if (!['org', 'user'].includes(ownerType)) throw new Error('Invalid GitHub owner type');
    if (typeof fetchImpl !== 'function') throw new Error('fetch is required');
    this.token = token;
    this.owner = owner;
    this.ownerType = ownerType;
    this.fetchImpl = fetchImpl;
  }

  async request(method, path, body, { allow404 = false } = {}) {
    if (!path.startsWith('/')) throw new Error('Invalid GitHub API path');
    const response = await this.fetchImpl('https://api.github.com' + path, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'Funesterie-MCP-Private-Relay/0.1',
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000)
    });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub API ${method} ${path.split('?')[0]}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  }

  repoPath(repoName) {
    if (!/^a11-mcp-relay-[a-f0-9]{16}$/.test(repoName || '')) throw new Error('Unexpected relay repo name');
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(repoName)}`;
  }

  async createPrivateRepo(repoName) {
    this.repoPath(repoName);
    const endpoint = this.ownerType === 'org' ? `/orgs/${encodeURIComponent(this.owner)}/repos` : '/user/repos';
    const repo = await this.request('POST', endpoint, {
      name: repoName, private: true, auto_init: true,
      description: 'A11 encrypted temporary MCP mailbox; do not publish',
      has_issues: false, has_projects: false, has_wiki: false
    });
    if (repo.private !== true || repo.name !== repoName || repo.owner?.login?.toLowerCase() !== this.owner.toLowerCase()) {
      throw new Error('GitHub did not create the expected private repository; manual review required');
    }
    return repo;
  }

  getRepo(repoName) { return this.request('GET', this.repoPath(repoName)); }

  async putJson(repoName, path, payload) {
    return this.request('PUT', this.repoPath(repoName) + '/contents/' + safePath(path), {
      message: 'relay: encrypted message or control metadata',
      content: Buffer.from(JSON.stringify(payload)).toString('base64')
    });
  }

  async getJson(repoName, path) {
    const file = await this.request('GET', this.repoPath(repoName) + '/contents/' + safePath(path), undefined, { allow404: true });
    if (!file) return null;
    if (file.type !== 'file' || file.encoding !== 'base64') throw new Error('Unexpected GitHub content type');
    return JSON.parse(Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8'));
  }

  async listJson(repoName, directory) {
    const entries = await this.request('GET', this.repoPath(repoName) + '/contents/' + safePath(directory), undefined, { allow404: true });
    if (entries === null) return [];
    if (!Array.isArray(entries)) throw new Error('Unexpected GitHub directory listing');
    return entries.filter(x => x.type === 'file' && x.name.endsWith('.json')).map(x => x.name);
  }

  async deleteRepo(repoName) {
    await this.request('DELETE', this.repoPath(repoName));
  }
}

module.exports = { GitHubAdapter };