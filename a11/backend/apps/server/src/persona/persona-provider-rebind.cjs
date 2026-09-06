'use strict';

/**
 * persona-provider-rebind.cjs — Reconnexion des voix (protocole F.O.R.C.E. §9.5, §5.6).
 *
 * Greffé au-dessus de `src/music/persona-recovery.cjs`, qui sait déjà détecter une
 * voix expirée (553 « voice has expired ») et la réanimer depuis un échantillon.
 * Ce module ajoute ce qui manquait : parcourir TOUTES les voix de l'holocron,
 * les recâbler une par une, de façon **idempotente et tracée**.
 *
 * Trois issues par voix, et une seule est gratuite :
 *   'inchange'  la voix répond, son id est bon — on ne touche à rien.
 *   'recable'   la voix existe encore mais sous un autre id — on réécrit le pointeur.
 *   'recree'    la voix est morte — on la refait depuis l'échantillon local, puis
 *               on recâble l'id neuf.
 *   'echec'     rien n'a marché. La persona reste QUARANTINED.
 *
 * §5 : « REBIND est idempotent + loggé ; un rebind échoué laisse en QUARANTINED,
 * jamais en RESTORED. » D'où `toutesLiees` : un seul échec suffit à bloquer la
 * promotion. On ne moyenne pas, on ne tolère pas « 4 voix sur 5 ».
 *
 * Piège appris en prod (mémoire du 2026-07) : une voix morte ne dit pas qu'elle
 * est morte. Le provider répond SENSITIVE_WORD_ERROR, ce qui envoie chercher un
 * mot interdit dans les paroles alors que le problème est l'identifiant. On traite
 * donc ce message comme un symptôme d'expiration, pas comme une erreur de contenu.
 */

const ACTIONS = Object.freeze(['inchange', 'recable', 'recree', 'echec']);

/** Messages qui signalent une voix morte en se faisant passer pour autre chose. */
const SYMPTOMES_VOIX_MORTE = /(voice has expired|voice_not_found|persona_not_found|SENSITIVE_WORD_ERROR|invalid persona)/i;
const INLINE_SECRET_KEYS = new Set([
  'apikey',
  'apitoken',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'secret',
  'secretkey',
  'clientsecret',
  'password',
  'passphrase',
  'credential',
  'credentials',
  'authorization',
  'cookie',
  'privatekey',
  'signingkey',
]);
const INLINE_SECRET_VALUE_PATTERNS = Object.freeze([
  /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/i,
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{12,}\b/i,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|hf_[A-Za-z0-9]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{30,})\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b(?:api[\s_-]*key|api[\s_-]*token|access[\s_-]*token|refresh[\s_-]*token|client[\s_-]*secret|password|passphrase|authorization)\b\s*[:=]\s*["']?[^\s"',;]{8,}/i,
]);

function estVoixMorte(erreurOuTexte) {
  if (!erreurOuTexte) return false;
  const s = typeof erreurOuTexte === 'string' ? erreurOuTexte : String(erreurOuTexte.message || erreurOuTexte.code || '');
  return SYMPTOMES_VOIX_MORTE.test(s);
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Recâble une voix. Idempotent : si elle répond déjà, on ne fait rien.
 *
 * @param {object} voix                 { id, provider, voiceId, samplePath }
 * @param {object} o
 * @param {(v)=>Promise<{ok:boolean,voiceId?:string,error?:any}>} o.sonder
 *        Demande au provider si cette voix existe. Ne doit RIEN consommer de payant.
 * @param {(v)=>Promise<{ok:boolean,voiceId?:string,error?:any}>} [o.recreer]
 *        Refait la voix depuis l'échantillon local. Peut coûter — d'où `autoriserRecreation`.
 * @param {boolean} [o.autoriserRecreation=false]
 */
async function rebindVoix(voix, { sonder, recreer, autoriserRecreation = false } = {}) {
  if (typeof sonder !== 'function') throw new Error('rebind_sonde_manquante');
  const base = { voix: voix?.id || voix?.voiceId || 'inconnue', provider: voix?.provider || 'inconnu', at: nowIso() };

  let sonde;
  try {
    sonde = await sonder(voix);
  } catch (error) {
    sonde = { ok: false, error };
  }

  if (sonde?.ok && (!sonde.voiceId || sonde.voiceId === voix?.voiceId)) {
    return { ...base, action: 'inchange', voiceId: voix?.voiceId };
  }
  if (sonde?.ok && sonde.voiceId && sonde.voiceId !== voix?.voiceId) {
    return { ...base, action: 'recable', voiceId: sonde.voiceId, ancienId: voix?.voiceId };
  }

  const morte = estVoixMorte(sonde?.error);
  if (!morte) {
    return { ...base, action: 'echec', raison: `sonde negative sans symptome d expiration: ${String(sonde?.error?.message || sonde?.error || 'inconnu')}` };
  }
  if (!autoriserRecreation) {
    return { ...base, action: 'echec', raison: 'voix expiree, recreation non autorisee (appel payant)' };
  }
  if (typeof recreer !== 'function') {
    return { ...base, action: 'echec', raison: 'voix expiree, aucun recreateur fourni' };
  }
  if (!voix?.samplePath) {
    return { ...base, action: 'echec', raison: 'voix expiree, aucun echantillon local pour la refaire' };
  }

  try {
    const neuve = await recreer(voix);
    if (neuve?.ok && neuve.voiceId) {
      return { ...base, action: 'recree', voiceId: neuve.voiceId, ancienId: voix?.voiceId };
    }
    return { ...base, action: 'echec', raison: `recreation sans id: ${String(neuve?.error?.message || neuve?.error || 'inconnu')}` };
  } catch (error) {
    return { ...base, action: 'echec', raison: `recreation en erreur: ${String(error?.message || error)}` };
  }
}

/**
 * Recâble toutes les voix d'un holocron.
 * `toutesLiees` est faux dès qu'UNE voix échoue — §5 l'exige.
 */
async function rebindProviders(voices, options = {}) {
  const liste = Array.isArray(voices) ? voices : [];
  const journal = [];
  for (const voix of liste) {
    journal.push(await rebindVoix(voix, options));
  }
  const echecs = journal.filter((r) => r.action === 'echec');
  const modifies = journal.filter((r) => r.action === 'recable' || r.action === 'recree');
  return {
    at: nowIso(),
    total: liste.length,
    toutesLiees: liste.length > 0 && echecs.length === 0,
    inchangees: journal.filter((r) => r.action === 'inchange').length,
    modifiees: modifies.length,
    echecs: echecs.length,
    // Les pointeurs a reecrire dans l'holocron promu. Vide si rien n'a bouge.
    pointeurs: modifies.map((r) => ({ voix: r.voix, provider: r.provider, voiceId: r.voiceId, ancienId: r.ancienId })),
    journal,
  };
}

/**
 * Vérifie les raccords d'une persona AGENT sans toucher aux voix fournisseur.
 *
 * Les liaisons viennent exclusivement des fichiers `models.json` et `tools.json`
 * du holocron déjà vérifié par l'appelant. Aucun probe réseau, aucune recréation
 * Suno, aucun coût : cette étape garantit seulement que le profil restauré ne
 * démarre pas avec des modèles/outils informes ou un secret injecté en clair.
 */
function rebindAgentProviders(holocron) {
  const models = holocron?.files?.['models.json']?.chain;
  const tools = holocron?.files?.['tools.json']?.permissions;
  const journal = [];

  if (!Array.isArray(models)) {
    journal.push({ type: 'models', action: 'echec', raison: 'chaine de modeles absente' });
  } else {
    for (const binding of models) {
      const valide = binding
        && typeof binding === 'object'
        && String(binding.role || '').trim()
        && String(binding.provider || '').trim()
        && String(binding.model || '').trim()
        && !hasInlineSecret(binding);
      journal.push({
        type: 'model',
        role: String(binding?.role || '').slice(0, 80),
        provider: String(binding?.provider || '').slice(0, 80),
        model: String(binding?.model || '').slice(0, 120),
        action: valide ? 'inchange' : 'echec',
        raison: valide ? null : 'liaison modele incomplete ou secret en clair',
      });
    }
  }

  if (!Array.isArray(tools)) {
    journal.push({ type: 'tools', action: 'echec', raison: 'permissions outils absentes' });
  } else {
    for (const binding of tools) {
      const valide = binding
        && typeof binding === 'object'
        && String(binding.name || '').trim()
        && typeof binding.allowed === 'boolean'
        && !hasInlineSecret(binding);
      journal.push({
        type: 'tool',
        name: String(binding?.name || '').slice(0, 100),
        allowed: binding?.allowed === true,
        action: valide ? 'inchange' : 'echec',
        raison: valide ? null : 'permission outil incomplete ou secret en clair',
      });
    }
  }

  const echecs = journal.filter((entry) => entry.action === 'echec');
  const total = journal.length;
  return {
    at: nowIso(),
    kind: 'agent-runtime',
    total,
    toutesLiees: total > 0 && echecs.length === 0,
    inchangees: total - echecs.length,
    modifiees: 0,
    echecs: echecs.length,
    pointeurs: [],
    journal,
    voiceProviderTouched: false,
    paidProviderTouched: false,
  };
}

function normalizeSecretKey(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function looksLikeInlineSecret(value) {
  const text = String(value || '').trim();
  return Boolean(text) && INLINE_SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(text));
}

function hasSecretKeyValue(value) {
  if (typeof value === 'string') return Boolean(value.trim());
  if (Buffer.isBuffer(value)) return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && typeof value === 'object' && Object.keys(value).length > 0);
}

function hasInlineSecret(value) {
  const seen = new Set();
  const visit = (candidate) => {
    if (typeof candidate === 'string' || Buffer.isBuffer(candidate)) {
      return looksLikeInlineSecret(candidate);
    }
    if (!candidate || typeof candidate !== 'object') return false;
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    if (Array.isArray(candidate)) return candidate.some(visit);
    for (const [key, child] of Object.entries(candidate)) {
      if (INLINE_SECRET_KEYS.has(normalizeSecretKey(key)) && hasSecretKeyValue(child)) return true;
      if (visit(child)) return true;
    }
    return false;
  };
  return visit(value);
}

module.exports = {
  ACTIONS,
  SYMPTOMES_VOIX_MORTE,
  estVoixMorte,
  hasInlineSecret,
  rebindAgentProviders,
  rebindProviders,
  rebindVoix,
};
