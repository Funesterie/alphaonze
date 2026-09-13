'use strict';
// Publication explicite, bornee et reprenable.
//
// Publier est public et pratiquement definitif: on ne relit pas un morceau apres
// coup, on le retire. D'ou trois freins plutot qu'un. --apply est obligatoire.
// --limit vaut 1 par defaut, pour qu'un premier passage sorte UN morceau qu'on
// puisse aller regarder. Et le fil d'or rend le passage idempotent: relancer ne
// republie pas, c'est ce qui manquait au lot de juillet qui a pose 110 doublons.
const fs = require('node:fs');
const path = require('node:path');
const { getCanonicalRuntimeRoot } = require('../lib/runtime-root.cjs');
const { readHistoryTracks, historyDirectory, applyHistoryEnhancements } = require('../src/music/jukebox-history.cjs');
const { resolveJukeboxAsset } = require('../src/music/jukebox-stream-integrity.cjs');
const { publishTrackIfNew, autoPublishEnabled, resolveSharing, normaliserTitre } = require('../src/social/soundcloud-auto-publish.cjs');
const { titleFromLyrics } = require('../src/music/jukebox-claude-titler.cjs');
const { getFreshSocialTokens, getSoundCloudAccountIdentity, listSoundCloudTracks, uploadSoundCloudTrack } = require('../src/social/social-autoprompt.cjs');
const { atomic } = require('./master-jukebox-v11pan.cjs');

const argument = (nom, defaut) => {
  const trouve = process.argv.find((a) => a.startsWith(`--${nom}=`));
  return trouve ? trouve.slice(nom.length + 3) : defaut;
};

// Depuis le 13/09/2026, seuls les sons crees APRES le dernier envoi public du lot
// historique (23/08/2026 14:35) partent. Le jukebox a ete renomme depuis juillet :
// seuls 21 de ses titres correspondent encore a SoundCloud, donc le garde par titre
// ne protege PAS les morceaux plus anciens -- les publier reposterait les chansons
// de juillet sous un autre nom.
const SINCE_DEFAUT = '2026-08-23T14:35:00Z';

function estVersionMaster(track) {
  return /v11|pan|master|d40/i.test([track.mastering, track.variant, track.trackUrl].join(' ')) ? 1 : 0;
}

/** Candidats d'un passage : recents, non exclus, du plus recent au plus ancien, master d'abord. */
function selectionnerCandidats(tracks, { since = SINCE_DEFAUT, exclusions = new Set() } = {}) {
  const seuil = Date.parse(since);
  if (!Number.isFinite(seuil)) throw Error('invalid_since');
  const tries = (tracks || [])
    .filter((t) => {
      const d = Date.parse(t && t.createdAt);
      return Number.isFinite(d) && d > seuil && !exclusions.has(String(t.id));
    })
    .sort((a, b) => (Date.parse(b.createdAt) - Date.parse(a.createdAt)) || (estVersionMaster(b) - estVersionMaster(a)));
  // Une generation Suno rend deux versions aux paroles identiques : on n'en garde
  // qu'une, la master. Sans ca, la jumelle d'un son au titre generique etait
  // retitree autrement que celle deja en ligne, echappait au garde par titre et
  // repartait en doublon (cas « Session principale » / « La Batte Perce le Noir »).
  const vus = new Set();
  return tries.filter((t) => {
    const cle = String(t.lyrics || '').replace(/\s+/g, ' ').trim().slice(0, 240) || `date:${t.createdAt}`;
    if (vus.has(cle)) return false;
    vus.add(cle);
    return true;
  });
}

/**
 * Sons ecartes a la main (les deux chansons « factures », 13/09/2026).
 * Fichier absent = aucune exclusion ; fichier illisible = on refuse de publier.
 */
function lireExclusions(root) {
  const fichier = path.join(root, 'social', 'soundcloud-exclusions.json');
  let brut;
  try { brut = fs.readFileSync(fichier, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return new Set();
    throw Error('soundcloud_exclusions_unreadable');
  }
  let donnees;
  try { donnees = JSON.parse(brut); } catch { throw Error('soundcloud_exclusions_invalid'); }
  if (!donnees || !Array.isArray(donnees.entries)) throw Error('soundcloud_exclusions_invalid');
  return new Set(donnees.entries.map((e) => String((e && e.id) || '')).filter(Boolean));
}

/**
 * Le jeton, par ordre : stdin, puis le coffre des comptes sociaux -- la ou la
 * reconnexion OAuth range un jeton frais, que l'application renouvelle et
 * enregistre -- puis l'environnement. Avant le 13/09/2026 le runner ne lisait que
 * l'environnement, dont le jeton avait expire : il ne pouvait plus rien publier.
 */
async function jetonSoundCloud({ credentials = {}, env = process.env, chargerDepuisCoffre = chargerJetonDuCoffre } = {}) {
  if (credentials.SOUNDCLOUD_ACCESS_TOKEN) return credentials.SOUNDCLOUD_ACCESS_TOKEN;
  if (env.DATABASE_URL && typeof chargerDepuisCoffre === 'function') {
    try {
      const jeton = await chargerDepuisCoffre(env);
      if (jeton) return jeton;
    } catch (error) {
      console.error('coffre SoundCloud indisponible, repli sur l environnement :', String(error.message || error).slice(0, 120));
    }
  }
  const jeton = env.SOCIAL_SOUNDCLOUD_ACCESS_TOKEN || env.SOUNDCLOUD_ACCESS_TOKEN;
  if (!jeton) throw Error('soundcloud_access_token_missing');
  return jeton;
}

// Compte admin (user_id 2) qui a reconnecte SoundCloud le 13/09/2026.
async function chargerJetonDuCoffre(env) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    const compte = await getFreshSocialTokens(pool, { provider: 'soundcloud', userId: env.SOUNDCLOUD_PUBLISH_USER_ID || '2' }, env);
    return (compte && compte.tokens && compte.tokens.accessToken) || '';
  } finally {
    await pool.end();
  }
}

function createBudgetedTitler({ apiKey, budgetUsd, stats, save, titleImpl = titleFromLyrics }) {
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) throw Error('invalid_titling_budget');
  stats.coutTitrageReserveUsd ||= 0;
  return async ({ lyrics }) => {
    const available = budgetUsd - stats.coutTitrageUsd - stats.coutTitrageReserveUsd;
    if (available <= 0) throw Error('budget_titrage_atteint');
    let reserved = 0;
    const resultat = await titleImpl({
      lyrics, apiKey, maxCostUsd: available,
      reserveCost: (amount) => {
        if (reserved || !Number.isFinite(amount) || amount <= 0 || amount > available) throw Error('budget_titrage_atteint');
        reserved = amount;
        stats.coutTitrageReserveUsd = Number((stats.coutTitrageReserveUsd + amount).toFixed(9));
        save();
      },
    });
    if (!reserved || !Number.isFinite(resultat.costUsd) || resultat.costUsd < 0 || resultat.costUsd > reserved) {
      throw Error('provider_cost_exceeded_reservation');
    }
    stats.titrages++;
    stats.coutTitrageUsd = Number((stats.coutTitrageUsd + resultat.costUsd).toFixed(9));
    stats.coutTitrageReserveUsd = Number((stats.coutTitrageReserveUsd - reserved).toFixed(9));
    save();
    return resultat;
  };
}

function isAuthError(error) {
  return [401, 403].includes(Number(error?.status))
    || /(?:soundcloud|titrage_(?:provider|count))_http_(?:401|403)\b/.test(String(error?.code || error?.message || ''));
}

async function runPublicationBatch({ tracks, stats, publish, save, isStopping = () => false }) {
  for (const track of tracks) {
    if (isStopping() || stats.publies >= stats.limit) break;
    try {
      const resultat = await publish(track);
      if (resultat.published) {
        stats.publies++;
        stats.publications.push({ id: track.id, title: resultat.upload?.title || track.title, url: resultat.upload?.permalinkUrl || '', fingerprint: resultat.fingerprint.slice(0, 16) });
      } else {
        stats.ignores++;
        stats.raisons[resultat.reason] = (stats.raisons[resultat.reason] || 0) + 1;
      }
    } catch (error) {
      stats.echecs++;
      const message = String(error.code || error.message || 'publication_failed');
      // Le journal ne garde aucun corps amont, URL signee ou secret.
      stats.erreurs.push({ id: track.id, error: isAuthError(error) ? 'oauth_reconnect_required' : message.replace(/https?:\/\/\S+/gi, '[url]').replace(/\b(?:token|api[_ -]?key|authorization|secret)\s*[:=]\s*\S+/gi, '[secret]').slice(0, 160) });
      if (isAuthError(error)) stats.state = 'authentication_required';
      else if (message.includes('budget_titrage_atteint')) stats.state = 'budget_atteint';
      else if (/soundcloud_registry_|provider_cost_exceeded_reservation/.test(message)) stats.state = 'review_required';
      if (stats.state !== 'running') { save(); break; }
    }
    save();
  }
  if (stats.state === 'running') stats.state = isStopping() ? 'paused' : (stats.publies >= stats.limit ? 'limite_atteinte' : 'complete');
  save();
  return stats;
}

async function main() {
  if (!process.argv.includes('--apply')) throw Error('Explicit --apply required');
  if (!autoPublishEnabled(process.env)) throw Error('SOUNDCLOUD_AUTO_PUBLISH_ENABLED absent: rien ne doit partir par accident');

  // Les secrets arrivent par stdin, jamais par argv: une ligne de commande se
  // retrouve dans ps, dans l'historique du shell et dans les journaux.
  const credentials = process.argv.includes('--key-stdin') ? JSON.parse(fs.readFileSync(0, 'utf8')) : {};
  const accessToken = await jetonSoundCloud({ credentials, env: process.env });
  const claudeKey = credentials.CLAUDE_API_KEY || process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '';

  const limite = Number(argument('limit', '1'));
  const budgetUsd = Number(argument('budget-usd', '0.10'));
  if (!Number.isInteger(limite) || limite < 1 || limite > 1000) throw Error('invalid_publish_limit');
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) throw Error('invalid_titling_budget');
  const since = argument('since', process.env.SOUNDCLOUD_AUTO_PUBLISH_SINCE || SINCE_DEFAUT);
  if (!Number.isFinite(Date.parse(since))) throw Error('invalid_since');
  // Lecture seule : un OAuth deja refuse ne doit pas consommer de titrage.
  await getSoundCloudAccountIdentity(accessToken);
  // Ce qui est deja en ligne (13/09/2026) : le registre ne connait pas le lot de
  // juillet (326 morceaux). Sans cette liste, le premier passage le republiait.
  // Une liste incomplete fait echouer ici, avant tout upload.
  const enLigne = new Set((await listSoundCloudTracks(accessToken)).map((t) => normaliserTitre(t.title)).filter(Boolean));
  const root = getCanonicalRuntimeRoot(), directory = historyDirectory();
  const assetDir = path.join(root, 'files/generated/vivy');
  const lock = path.join(root, 'vivy-stream/soundcloud-publish.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const lockFd = fs.openSync(lock, 'wx', 0o600); fs.closeSync(lockFd);
  const journal = path.join(root, 'vivy-stream/soundcloud-publish-status.json');

  const stats = {
    schema: 'funesterie.social.soundcloud-publish-run.v1',
    startedAt: new Date().toISOString(), state: 'running',
    sharing: resolveSharing(process.env), limit: limite, budgetUsd, since,
    candidats: 0, publies: 0, ignores: 0, echecs: 0,
    titrages: 0, coutTitrageUsd: 0, coutTitrageReserveUsd: 0, raisons: {}, publications: [], erreurs: [],
  };
  const save = () => { stats.updatedAt = new Date().toISOString(); atomic(journal, stats); };

  let stopping = false;
  process.once('SIGTERM', () => { stopping = true; });
  process.once('SIGINT', () => { stopping = true; });

  const upload = async ({ audioPath, title, description, genre, tagList, sharing }) =>
    uploadSoundCloudTrack({ accessToken, audioPath, title, description, genre, tagList, sharing });

  // Le budget de titrage est tenu ICI, pas dans le module: seul l'appelant sait
  // combien de morceaux il s'apprete a titrer dans ce passage.
  const titleTrack = claudeKey ? createBudgetedTitler({ apiKey: claudeKey, budgetUsd, stats, save }) : null;

  try {
    const tracks = selectionnerCandidats(applyHistoryEnhancements(readHistoryTracks(directory), directory), {
      since, exclusions: lireExclusions(root),
    });
    stats.candidats = tracks.length;
    save();
    await runPublicationBatch({ tracks, stats, save, isStopping: () => stopping, publish: async (track) => {
      const filePath = resolveJukeboxAsset(track.trackUrl, assetDir);
      const resultat = await publishTrackIfNew({
        filePath, title: track.title, lyrics: track.lyrics || '', upload, titleTrack,
        titleAlreadyPublished: (titre) => enLigne.has(normaliserTitre(titre)),
      });
      if (resultat.published) {
        // L'autre version du meme son (original / master) ne repart pas.
        enLigne.add(normaliserTitre(resultat.title));
        console.log(JSON.stringify({ publie: stats.publies + 1, titre: resultat.upload?.title, url: resultat.upload?.permalinkUrl }));
      }
      return resultat;
    } });
    console.log(JSON.stringify({ state: stats.state, publies: stats.publies, ignores: stats.ignores, echecs: stats.echecs, raisons: stats.raisons, coutTitrageUsd: stats.coutTitrageUsd, coutTitrageReserveUsd: stats.coutTitrageReserveUsd }));
  } finally { fs.unlinkSync(lock); }
}

if (require.main === module) main().catch((error) => { console.error(String(error.code || error.message)); process.exitCode = 1; });
module.exports = {
  SINCE_DEFAUT, createBudgetedTitler, isAuthError, jetonSoundCloud, lireExclusions, main, runPublicationBatch, selectionnerCandidats,
};
