/**
 * File Edit API Routes - Secure file editing with preview, undo, audit
 * Phase 4: Diff preview, undo/redo, whitelist validation, audit logs
 */

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');

// Lazy load diff library
let Diff = null;
function getDiff() {
  if (!Diff) {
    try {
      Diff = require('diff');
    } catch (err) {
      throw new Error('diff package not installed. Run: npm install diff');
    }
  }
  return Diff;
}

// Workspace root (configure via env or detect)
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || process.cwd();

// Whitelist for editable paths (security)
const EDITABLE_PATHS = [
  path.join(WORKSPACE_ROOT, 'apps'),
  path.join(WORKSPACE_ROOT, 'src'),
  path.join(WORKSPACE_ROOT, 'test'),
  path.join(WORKSPACE_ROOT, 'docs')
];

// Undo/Redo history (in-memory, max 100 entries)
const editHistory = new Map(); // key: filePath, value: array of {original, edited, timestamp}
const MAX_HISTORY = 100;

// Audit log
const auditLog = [];
const MAX_AUDIT_LOG = 1000;

function logAudit(action, filePath, user = 'anonymous', details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    filePath,
    user,
    details
  };
  auditLog.push(entry);
  if (auditLog.length > MAX_AUDIT_LOG) {
    auditLog.shift();
  }
  console.log('[Edit Audit]', JSON.stringify(entry));
}

function isPathAllowed(filePath) {
  const normalized = path.normalize(path.resolve(filePath));
  return EDITABLE_PATHS.some(allowed => normalized.startsWith(allowed));
}

function getFileHistory(filePath) {
  if (!editHistory.has(filePath)) {
    editHistory.set(filePath, []);
  }
  return editHistory.get(filePath);
}

function addToHistory(filePath, original, edited) {
  const history = getFileHistory(filePath);
  history.push({
    original,
    edited,
    timestamp: Date.now(),
    hash: crypto.createHash('sha256').update(edited).digest('hex').substring(0, 8)
  });
  
  // Limit history size
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
}

/**
 * Register File Edit API routes
 * @param {express.Router} router - Express router instance
 */
function registerFileEditRoutes(router) {
  console.log('[FileEdit] Registering file edit API routes...');

  // Health check
  router.get('/edit/health', (req, res) => {
    res.json({
      ok: true,
      available: true,
      workspace_root: WORKSPACE_ROOT,
      editable_paths: EDITABLE_PATHS,
      history_size: Array.from(editHistory.values()).reduce((sum, h) => sum + h.length, 0),
      audit_log_size: auditLog.length
    });
  });

  // Preview diff before applying
  router.post('/edit/preview', async (req, res) => {
    try {
      const { path: filePath, newContent } = req.body;
      if (!filePath) return res.status(400).json({ error: 'path required' });
      if (newContent === undefined) return res.status(400).json({ error: 'newContent required' });

      const fullPath = path.resolve(filePath);

      // Security check
      if (!isPathAllowed(fullPath)) {
        logAudit('preview_denied', fullPath, req.user?.id);
        return res.status(403).json({ error: 'Path not in whitelist' });
      }

      // Read current content
      let originalContent = '';
      let fileExists = false;
      try {
        originalContent = await fs.readFile(fullPath, 'utf-8');
        fileExists = true;
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }

      // Generate diff
      const diff = getDiff();
      const patch = diff.createPatch(path.basename(fullPath), originalContent, newContent, 'original', 'edited');
      const changes = diff.diffLines(originalContent, newContent);

      const summary = {
        additions: changes.filter(c => c.added).reduce((sum, c) => sum + (c.count || 0), 0),
        deletions: changes.filter(c => c.removed).reduce((sum, c) => sum + (c.count || 0), 0),
        unchanged: changes.filter(c => !c.added && !c.removed).reduce((sum, c) => sum + (c.count || 0), 0)
      };

      res.json({
        path: fullPath,
        fileExists,
        patch,
        changes,
        summary,
        safe: true
      });
    } catch (err) {
      console.error('[FileEdit] Preview error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Apply edit (with undo support)
  router.post('/edit/apply', async (req, res) => {
    try {
      const { path: filePath, newContent, force = false } = req.body;
      if (!filePath) return res.status(400).json({ error: 'path required' });
      if (newContent === undefined) return res.status(400).json({ error: 'newContent required' });

      const fullPath = path.resolve(filePath);
      const user = req.user?.id || 'anonymous';

      // Security check
      if (!isPathAllowed(fullPath)) {
        logAudit('apply_denied', fullPath, user);
        return res.status(403).json({ error: 'Path not in whitelist', path: fullPath });
      }

      // Read current content for undo
      let originalContent = '';
      let fileExists = false;
      try {
        originalContent = await fs.readFile(fullPath, 'utf-8');
        fileExists = true;
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }

      // Safety check: require force=true for large changes
      if (!force && originalContent.length > 0) {
        const diff = getDiff();
        const changes = diff.diffLines(originalContent, newContent);
        const deletions = changes.filter(c => c.removed).reduce((sum, c) => sum + (c.count || 0), 0);
        
        if (deletions > 100) {
          return res.status(400).json({
            error: 'Large deletion detected. Use force=true to confirm.',
            deletions,
            preview_recommended: true
          });
        }
      }

      // Create directory if needed
      const dir = path.dirname(fullPath);
      if (!fsSync.existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
      }

      // Save to history
      addToHistory(fullPath, originalContent, newContent);

      // Write file
      await fs.writeFile(fullPath, newContent, 'utf-8');

      // Log audit
      logAudit('apply', fullPath, user, {
        fileExists,
        size: newContent.length,
        hash: crypto.createHash('sha256').update(newContent).digest('hex').substring(0, 8)
      });

      res.json({
        success: true,
        path: fullPath,
        fileExists,
        size: newContent.length,
        canUndo: true
      });
    } catch (err) {
      console.error('[FileEdit] Apply error:', err);
      logAudit('apply_error', req.body.path, req.user?.id, { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Undo last edit
  router.post('/edit/undo', async (req, res) => {
    try {
      const { path: filePath } = req.body;
      if (!filePath) return res.status(400).json({ error: 'path required' });

      const fullPath = path.resolve(filePath);
      const user = req.user?.id || 'anonymous';

      // Security check
      if (!isPathAllowed(fullPath)) {
        return res.status(403).json({ error: 'Path not in whitelist' });
      }

      const history = getFileHistory(fullPath);
      if (history.length === 0) {
        return res.status(404).json({ error: 'No undo history for this file' });
      }

      // Get last edit
      const lastEdit = history.pop();

      // Restore original content
      await fs.writeFile(fullPath, lastEdit.original, 'utf-8');

      // Log audit
      logAudit('undo', fullPath, user, {
        restored_hash: crypto.createHash('sha256').update(lastEdit.original).digest('hex').substring(0, 8)
      });

      res.json({
        success: true,
        path: fullPath,
        restored: true,
        remainingUndos: history.length
      });
    } catch (err) {
      console.error('[FileEdit] Undo error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get edit history for a file
  router.get('/edit/history/:path(*)', async (req, res) => {
    try {
      const filePath = req.params.path;
      if (!filePath) return res.status(400).json({ error: 'path required' });

      const fullPath = path.resolve(filePath);

      // Security check
      if (!isPathAllowed(fullPath)) {
        return res.status(403).json({ error: 'Path not in whitelist' });
      }

      const history = getFileHistory(fullPath);
      
      res.json({
        path: fullPath,
        history: history.map(entry => ({
          timestamp: entry.timestamp,
          hash: entry.hash,
          size: entry.edited.length
        }))
      });
    } catch (err) {
      console.error('[FileEdit] History error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get audit log
  router.get('/edit/audit', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    
    const entries = auditLog.slice(-limit - offset, auditLog.length - offset).reverse();
    
    res.json({
      total: auditLog.length,
      limit,
      offset,
      entries
    });
  });

  // Clear history (admin only - add auth middleware in production)
  router.post('/edit/history/clear', (req, res) => {
    const { path: filePath } = req.body;
    
    if (filePath) {
      const fullPath = path.resolve(filePath);
      editHistory.delete(fullPath);
      res.json({ success: true, cleared: fullPath });
    } else {
      const size = editHistory.size;
      editHistory.clear();
      res.json({ success: true, cleared: size });
    }
  });

  console.log('[FileEdit] ✓ File edit API routes registered');
}

module.exports = { registerFileEditRoutes };
