'use strict';

const express = require('express');
const {
  buildSemanticMediaRoulette,
} = require('../../lib/semantic-media-roulette.cjs');
const { getLogger } = require('../../lib/structured-logger.cjs');

const logger = getLogger({ component: 'semantic-media-roulette-route' });

function boolFromInput(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function numberFromInput(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function buildOptions(req, base = {}) {
  const source = {
    ...(req.query || {}),
    ...(req.body || {}),
  };
  const user = req.user && typeof req.user === 'object' ? req.user : {};
  const userId = String(
    source.userId
    || user.id
    || user.sub
    || user.email
    || ''
  ).trim();

  return {
    ...base,
    query: String(source.query || source.q || '').trim(),
    creativeBrief: String(source.creativeBrief || source.brief || source.intent || '').trim(),
    intent: String(source.intent || '').trim(),
    mood: String(source.mood || '').trim(),
    tags: source.tags,
    user,
    userId,
    userInfo: source.userInfo,
    userContext: source.userContext || source.context,
    seed: source.seed,
    limit: numberFromInput(source.limit, 8),
    rankedLimit: numberFromInput(source.rankedLimit || source.poolLimit, 40),
    includeUserMemory: boolFromInput(source.includeUserMemory, true),
    includeProfileSnippets: boolFromInput(source.includeProfileSnippets, false),
    includeLocalPaths: boolFromInput(source.includeLocalPaths, false),
    randomize: boolFromInput(source.randomize, true),
  };
}

function createSemanticMediaRouletteRouter({ runtimeRoot, workspaceRoot } = {}) {
  const router = express.Router();

  function handle(req, res) {
    try {
      const result = buildSemanticMediaRoulette(buildOptions(req, {
        runtimeRoot,
        workspaceRoot,
      }));
      logger.info('Semantic media roulette built', {
        userId: result.profile?.userId,
        mediaCount: result.sources?.mediaCount,
        selectedCount: result.sources?.selectedCount,
      });
      return res.json(result);
    } catch (error_) {
      logger.error('Semantic media roulette failed', { error: error_?.message });
      return res.status(500).json({
        ok: false,
        error: 'semantic_media_roulette_failed',
        message: String(error_?.message || error_),
      });
    }
  }

  router.get('/roulette', handle);
  router.post('/roulette', express.json({ limit: '1mb' }), handle);

  return router;
}

module.exports = createSemanticMediaRouletteRouter;
module.exports.createSemanticMediaRouletteRouter = createSemanticMediaRouletteRouter;
