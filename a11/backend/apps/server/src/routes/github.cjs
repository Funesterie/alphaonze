/**
 * github.cjs
 *
 * Routes API GitHub pour A11.
 * Permet à A11 d'interagir avec le repo Funesterie via son token A11_GH.
 *
 * GET  /api/github/summary          — Résumé du repo
 * GET  /api/github/whoami           — Identité du token
 * GET  /api/github/issues           — Lister les issues
 * POST /api/github/issues           — Créer une issue
 * GET  /api/github/branches         — Lister les branches
 * GET  /api/github/commits          — Derniers commits
 * GET  /api/github/prs              — Lister les PRs
 * POST /api/github/prs              — Créer une PR
 * POST /api/github/files            — Créer/mettre à jour un fichier
 * GET  /api/github/workflows        — Lister les workflows
 * POST /api/github/workflows/:id/trigger — Déclencher un workflow
 */

const { Router } = require('express');
const { createGitHubClient } = require('../../lib/github-client.cjs');

function createGitHubRouter({ verifyJWT }) {
  const router = Router();

  function gh(req) {
    const owner = req.query.owner || req.body?.owner || undefined;
    const repo = req.query.repo || req.body?.repo || undefined;
    return createGitHubClient({ owner, repo });
  }

  // ── Résumé ────────────────────────────────────────────────────────────────

  router.get('/github/summary', verifyJWT, async (req, res) => {
    try {
      const summary = await gh(req).summary();
      return res.json({ ok: true, summary });
    } catch (err) {
      console.error('[GitHub] summary error:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/github/whoami', verifyJWT, async (req, res) => {
    try {
      const user = await gh(req).whoami();
      return res.json({ ok: true, login: user.login, name: user.name, avatar: user.avatar_url });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Issues ────────────────────────────────────────────────────────────────

  router.get('/github/issues', verifyJWT, async (req, res) => {
    try {
      const { state = 'open', per_page = 20, page = 1 } = req.query;
      const issues = await gh(req).listIssues({ state, per_page: Number(per_page), page: Number(page) });
      return res.json({ ok: true, issues });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/github/issues', verifyJWT, async (req, res) => {
    const { title, body, labels, assignees } = req.body || {};
    if (!title) return res.status(400).json({ ok: false, error: 'title requis' });
    try {
      const issue = await gh(req).createIssue({ title, body, labels, assignees });
      return res.json({ ok: true, issue: { number: issue.number, url: issue.html_url, title: issue.title } });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/github/issues/:number/comment', verifyJWT, async (req, res) => {
    const { body } = req.body || {};
    if (!body) return res.status(400).json({ ok: false, error: 'body requis' });
    try {
      const comment = await gh(req).commentIssue(Number(req.params.number), body);
      return res.json({ ok: true, comment: { id: comment.id, url: comment.html_url } });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.patch('/github/issues/:number/close', verifyJWT, async (req, res) => {
    try {
      const issue = await gh(req).closeIssue(Number(req.params.number));
      return res.json({ ok: true, issue: { number: issue.number, state: issue.state } });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Branches ──────────────────────────────────────────────────────────────

  router.get('/github/branches', verifyJWT, async (req, res) => {
    try {
      const branches = await gh(req).listBranches({ per_page: Number(req.query.per_page || 30) });
      return res.json({ ok: true, branches: branches.map((b) => ({ name: b.name, sha: b.commit?.sha?.slice(0, 7) })) });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Commits ───────────────────────────────────────────────────────────────

  router.get('/github/commits', verifyJWT, async (req, res) => {
    try {
      const { sha, per_page = 20, page = 1 } = req.query;
      const commits = await gh(req).listCommits({ sha, per_page: Number(per_page), page: Number(page) });
      return res.json({
        ok: true,
        commits: commits.map((c) => ({
          sha: c.sha?.slice(0, 7),
          message: c.commit?.message?.split('\n')[0],
          author: c.commit?.author?.name,
          date: c.commit?.author?.date,
          url: c.html_url,
        })),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Pull Requests ─────────────────────────────────────────────────────────

  router.get('/github/prs', verifyJWT, async (req, res) => {
    try {
      const { state = 'open', per_page = 20 } = req.query;
      const prs = await gh(req).listPRs({ state, per_page: Number(per_page) });
      return res.json({
        ok: true,
        prs: prs.map((p) => ({
          number: p.number,
          title: p.title,
          state: p.state,
          branch: p.head?.ref,
          url: p.html_url,
          draft: p.draft,
        })),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/github/prs', verifyJWT, async (req, res) => {
    const { title, body, head, base, draft } = req.body || {};
    if (!title || !head) return res.status(400).json({ ok: false, error: 'title et head requis' });
    try {
      const pr = await gh(req).createPR({ title, body, head, base, draft });
      return res.json({ ok: true, pr: { number: pr.number, url: pr.html_url, title: pr.title } });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Fichiers ──────────────────────────────────────────────────────────────

  router.post('/github/files', verifyJWT, async (req, res) => {
    const { filePath, content, message, branch } = req.body || {};
    if (!filePath || !content || !message) {
      return res.status(400).json({ ok: false, error: 'filePath, content et message requis' });
    }
    try {
      const result = await gh(req).putFile({ filePath, content, message, branch });
      return res.json({
        ok: true,
        commit: {
          sha: result?.commit?.sha?.slice(0, 7),
          url: result?.commit?.html_url,
          message: result?.commit?.message,
        },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Workflows ─────────────────────────────────────────────────────────────

  router.get('/github/workflows', verifyJWT, async (req, res) => {
    try {
      const data = await gh(req).listWorkflows();
      return res.json({
        ok: true,
        workflows: (data?.workflows || []).map((w) => ({
          id: w.id,
          name: w.name,
          state: w.state,
          path: w.path,
        })),
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/github/workflows/:id/trigger', verifyJWT, async (req, res) => {
    const { ref, inputs } = req.body || {};
    try {
      await gh(req).triggerWorkflow(req.params.id, { ref, inputs });
      return res.json({ ok: true, message: `Workflow ${req.params.id} déclenché sur ${ref || 'main'}` });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = createGitHubRouter;
