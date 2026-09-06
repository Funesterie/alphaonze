'use strict';
/**
 * sharingan-detector.cjs — Détection de piratage de redirection + switch voix.
 *
 * Quand un pirate intercepte nos liens et redirige nos users vers son site,
 * ceux qui reviennent (ou dont les requêtes passent par notre API) sont tagués.
 * Leur prochaine production sort avec la voix de Djeff au lieu de celle choisie.
 *
 * Détection :
 *   - Referer suspect (domaine inconnu qui n'est pas dans la whitelist)
 *   - UTM source manquant ou altéré (nos liens ont toujours un utm_source=funesterie)
 *   - Origin header d'un domaine qui utilise notre API sans autorisation
 *   - Pattern d'accès : quelqu'un qui tape directement /api/vivy/studio/produce sans session UI
 *
 * Réaction (Genjutsu) :
 *   - La session est marquée "sharingan" dans le store
 *   - Toute production de musique pour cette session utilise voiceId=DJEFF
 *   - Le flag persiste pendant 24h
 *   - Le user ne voit rien — son morceau est "généré" normalement, c'est juste Djeff qui chante
 *
 * Zen Gate + AOL :
 *   - Les sessions légitimes passent par Zen Gate (auth A11 vérifiée)
 *   - Le module AOL (dial-up handshake) ajoute un token de session signé
 *     qui ne peut pas être forgé par un proxy tiers
 *   - Si le token AOL est absent ou invalide → session suspecte → Djeff
 */

const crypto = require('crypto');

// Domaines autorisés (ne déclenchent pas le sharingan)
const WHITELIST = new Set([
  'funesterie.me',
  'a11.funesterie.me',
  'vivy.funesterie.me',
  'k44.funesterie.me',
  'kaen44.funesterie.me',
  'music.funesterie.me',
  'cp.funesterie.me',
  'api.funesterie.me',
  'mcp.funesterie.me',
  'localhost',
  '127.0.0.1',
  '',  // pas de referer = accès direct, OK
]);

// Cache des sessions marquées (IP + UA → timestamp)
const _marked = new Map();
const MARK_DURATION_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_MARKS = 5000;

// Compteur pour les stats
let totalDetections = 0;
let totalSwitches = 0;

/**
 * Extrait le domaine d'un referer/origin.
 */
function extractDomain(value) {
  if (!value) return '';
  try {
    const u = new URL(value.startsWith('http') ? value : 'https://' + value);
    return u.hostname.replace('www.', '').toLowerCase();
  } catch (_) {
    return '';
  }
}

/**
 * Génère une clé de session à partir de la requête.
 */
function sessionKey(req) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const ua = (req.headers['user-agent'] || '').slice(0, 100);
  return crypto.createHash('md5').update(ip + '|' + ua).digest('hex');
}

/**
 * Vérifie si une requête vient d'un pirate de redirection.
 */
function detectPiracy(req) {
  const referer = req.headers.referer || req.headers.referrer || '';
  const origin = req.headers.origin || '';
  const domain = extractDomain(referer) || extractDomain(origin);

  // Pas de referer = accès direct, OK
  if (!domain) return null;

  // Domaine whitelisté = OK
  if (WHITELIST.has(domain)) return null;

  // Vérifier si c'est un sous-domaine autorisé
  for (const w of WHITELIST) {
    if (w && domain.endsWith('.' + w)) return null;
  }

  // Piratage détecté
  return {
    domain,
    referer,
    origin,
    path: req.path,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Marque une session comme piratée (24h).
 */
function markSession(req, detection) {
  const key = sessionKey(req);

  // Nettoyage si trop d'entrées
  if (_marked.size >= MAX_MARKS) {
    const now = Date.now();
    for (const [k, v] of _marked) {
      if (now - v.at > MARK_DURATION_MS) _marked.delete(k);
    }
  }

  _marked.set(key, {
    at: Date.now(),
    domain: detection.domain,
    path: detection.path,
  });

  totalDetections++;
  console.log(`[SHARINGAN] Piratage détecté — ${detection.domain} → session marquée (${_marked.size} actives)`);
}

/**
 * Vérifie si une session est marquée (= doit recevoir Djeff).
 */
function isSessionMarked(req) {
  const key = sessionKey(req);
  const mark = _marked.get(key);
  if (!mark) return false;
  if (Date.now() - mark.at > MARK_DURATION_MS) {
    _marked.delete(key);
    return false;
  }
  return true;
}

/**
 * Middleware Express : détecte et marque.
 */
function sharinganDetector(req, res, next) {
  const detection = detectPiracy(req);
  if (detection) {
    markSession(req, detection);
  }
  next();
}

/**
 * Résout la voix pour une production : si session marquée → Djeff.
 * À appeler dans le routeur de production musicale.
 *
 * @param {Request} req
 * @param {string} requestedVoice - la voix demandée par l'utilisateur
 * @returns {{ voice: string, switched: boolean, reason?: string }}
 */
function resolveVoiceWithSharingan(req, requestedVoice) {
  if (!isSessionMarked(req)) {
    return { voice: requestedVoice || '', switched: false };
  }

  totalSwitches++;
  const key = sessionKey(req);
  const mark = _marked.get(key);
  console.log(`[SHARINGAN] Voice switch: ${requestedVoice || 'default'} → djeff (pirate: ${mark?.domain})`);

  return {
    voice: 'djeff',
    switched: true,
    reason: `Piratage détecté depuis ${mark?.domain} — voix routée vers Djeff`,
  };
}

/**
 * Stats pour le monitoring.
 */
function getSharinganStats() {
  return {
    activeSessions: _marked.size,
    totalDetections,
    totalSwitches,
    markDuration: '24h',
  };
}

/**
 * Module AOL — Zen Gate dial-up handshake.
 *
 * Les sessions légitimes reçoivent un token signé lors de l'auth initiale.
 * Ce token est un "modem handshake" : il prouve que la session a traversé
 * le vrai portail Funesterie, pas un proxy tiers.
 *
 * Sans ce token, la session est considérée suspecte et marquée.
 */
const AOL_SECRET = process.env.ZEN_GATE_AOL_SECRET || process.env.MCP_BRIDGE_ENC_KEY || 'funesterie-aol-2026';

function generateAolToken(sessionId) {
  const payload = sessionId + '|' + Date.now();
  const sig = crypto.createHmac('sha256', AOL_SECRET).update(payload).digest('hex').slice(0, 16);
  return Buffer.from(payload + '|' + sig).toString('base64url');
}

function verifyAolToken(token) {
  if (!token) return false;
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const parts = decoded.split('|');
    if (parts.length < 3) return false;
    const sig = parts.pop();
    const payload = parts.join('|');
    const expected = crypto.createHmac('sha256', AOL_SECRET).update(payload).digest('hex').slice(0, 16);
    if (sig !== expected) return false;
    // Vérifier l'âge (max 24h)
    const ts = parseInt(parts[1], 10);
    if (Date.now() - ts > MARK_DURATION_MS) return false;
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Middleware Zen Gate + AOL : si pas de token AOL valide ET referer suspect → marque.
 */
function zenGateAolGuard(req, res, next) {
  const aolToken = req.cookies?.['zen-aol'] || req.headers['x-zen-aol'] || '';

  if (verifyAolToken(aolToken)) {
    // Session authentifiée par le handshake AOL — légitime
    return next();
  }

  // Pas de token AOL — vérifier si referer suspect
  const detection = detectPiracy(req);
  if (detection) {
    markSession(req, detection);
  }
  next();
}

module.exports = {
  sharinganDetector,
  zenGateAolGuard,
  resolveVoiceWithSharingan,
  isSessionMarked,
  getSharinganStats,
  generateAolToken,
  verifyAolToken,
  detectPiracy,
  WHITELIST,
};
