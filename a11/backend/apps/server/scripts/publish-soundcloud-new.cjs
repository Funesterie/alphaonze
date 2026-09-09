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
const { publishTrackIfNew, autoPublishEnabled, resolveSharing } = require('../src/social/soundcloud-auto-publish.cjs');
const { titleFromLyrics } = require('../src/music/jukebox-claude-titler.cjs');
const { uploadSoundCloudTrack } = require('../src/social/social-autoprompt.cjs');
const { atomic } = require('./master-jukebox-v11pan.cjs');

const argument = (nom, defaut) => {
  const trouve = process.argv.find((a) => a.startsWith(`--${nom}=`));
  return trouve ? trouve.slice(nom.length + 3) : defaut;
};

async function main() {
  if (!process.argv.includes('--apply')) throw Error('Explicit --apply required');
  if (!autoPublishEnabled(process.env)) throw Error('SOUNDCLOUD_AUTO_PUBLISH_ENABLED absent: rien ne doit partir par accident');

  // Les secrets arrivent par stdin, jamais par argv: une ligne de commande se
  // retrouve dans ps, dans l'historique du shell et dans les journaux.
  const credentials = process.argv.includes('--key-stdin') ? JSON.parse(fs.readFileSync(0, 'utf8')) : {};
  const accessToken = credentials.SOUNDCLOUD_ACCESS_TOKEN || process.env.SOCIAL_SOUNDCLOUD_ACCESS_TOKEN || process.env.SOUNDCLOUD_ACCESS_TOKEN;
  if (!accessToken) throw Error('soundcloud_access_token_missing');
  const claudeKey = credentials.CLAUDE_API_KEY || process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '';

  const limite = Math.max(1, Number(argument('limit', '1')) || 1);
  const budgetUsd = Math.max(0, Number(argument('budget-usd', '0.10')) || 0);
  const root = getCanonicalRuntimeRoot(), directory = historyDirectory();
  const assetDir = path.join(root, 'files/generated/vivy');
  const lock = path.join(root, 'vivy-stream/soundcloud-publish.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const lockFd = fs.openSync(lock, 'wx', 0o600); fs.closeSync(lockFd);
  const journal = path.join(root, 'vivy-stream/soundcloud-publish-status.json');

  const tracks = applyHistoryEnhancements(readHistoryTracks(directory), directory);
  const stats = {
    schema: 'funesterie.social.soundcloud-publish-run.v1',
    startedAt: new Date().toISOString(), state: 'running',
    sharing: resolveSharing(process.env), limit: limite, budgetUsd,
    candidats: tracks.length, publies: 0, ignores: 0, echecs: 0,
    titrages: 0, coutTitrageUsd: 0, raisons: {}, publications: [], erreurs: [],
  };
  const save = () => { stats.updatedAt = new Date().toISOString(); atomic(journal, stats); };

  let stopping = false;
  process.once('SIGTERM', () => { stopping = true; });
  process.once('SIGINT', () => { stopping = true; });

  const upload = async ({ audioPath, title, description, genre, tagList, sharing }) =>
    uploadSoundCloudTrack({ accessToken, audioPath, title, description, genre, tagList, sharing });

  // Le budget de titrage est tenu ICI, pas dans le module: seul l'appelant sait
  // combien de morceaux il s'apprete a titrer dans ce passage.
  const titleTrack = claudeKey ? async ({ lyrics }) => {
    if (stats.coutTitrageUsd >= budgetUsd) throw Error('budget_titrage_atteint');
    const resultat = await titleFromLyrics({ lyrics, apiKey: claudeKey });
    stats.titrages++; stats.coutTitrageUsd = Number((stats.coutTitrageUsd + resultat.costUsd).toFixed(6)); save();
    return resultat;
  } : null;

  try {
    save();
    for (const track of tracks) {
      if (stopping || stats.publies >= limite) break;
      try {
        const filePath = resolveJukeboxAsset(track.trackUrl, assetDir);
        const resultat = await publishTrackIfNew({
          filePath, title: track.title, lyrics: track.lyrics || '', upload, titleTrack,
        });
        if (resultat.published) {
          stats.publies++;
          stats.publications.push({ id: track.id, title: resultat.upload?.title || track.title, url: resultat.upload?.permalinkUrl || '', fingerprint: resultat.fingerprint.slice(0, 16) });
          console.log(JSON.stringify({ publie: stats.publies, titre: resultat.upload?.title, url: resultat.upload?.permalinkUrl }));
        } else {
          stats.ignores++;
          stats.raisons[resultat.reason] = (stats.raisons[resultat.reason] || 0) + 1;
        }
      } catch (error) {
        stats.echecs++;
        stats.erreurs.push({ id: track.id, error: String(error.code || error.message).slice(0, 160) });
        if (String(error.message || '').includes('budget_titrage_atteint')) { stats.state = 'budget_atteint'; break; }
      }
      save();
    }
    if (stats.state === 'running') stats.state = stopping ? 'paused' : (stats.publies >= limite ? 'limite_atteinte' : 'complete');
    save();
    console.log(JSON.stringify({ state: stats.state, publies: stats.publies, ignores: stats.ignores, echecs: stats.echecs, raisons: stats.raisons, coutTitrageUsd: stats.coutTitrageUsd }));
  } finally { fs.unlinkSync(lock); }
}

if (require.main === module) main().catch((error) => { console.error(String(error.code || error.message)); process.exitCode = 1; });
module.exports = { main };
