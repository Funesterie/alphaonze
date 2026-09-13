'use strict';

/**
 * Controle de la voix chantee : la chanson rendue par Suno est-elle bien chantee par
 * la voix du catalogue qu'on a demandee ?
 *
 * Constat du 13/09/2026 : « Djeff Est de Retour » (04/09), demandee avec la voix de
 * Djeff, est sortie chantee par une voix proche de Vivy sur ses DEUX variantes. Une
 * persona Suno n'est qu'une indication : le rendu peut deriver sans aucune erreur
 * cote Suno, et personne ne le voit avant d'ecouter.
 *
 * Mesure : le pont XTTS/RVC isole la voix (Demucs), puis compare son empreinte
 * (WavLM x-vector) a une reference de la voix attendue ET a une reference de
 * contraste (Vivy). On juge l'ECART entre les deux, jamais un score absolu : une
 * voix chantee sur de la musique ne ressemble jamais beaucoup a un echantillon.
 * Mesures du 13/09 : temoins Djeff +0.38 et +0.40, chansons chantees par Vivy de
 * -0.15 a -0.37. L'empreinte XTTS, essayee d'abord, ne separait rien (0.12 a 0.19
 * pour tout le monde) : ne pas y revenir.
 *
 * Aucune des deux variantes n'est la bonne voix : UNE relance (12 credits Suno,
 * accordee par Djeff le 13/09). La relance rate aussi : la persona est marquee a
 * refaire, et le runner de reanimation la reconstruit depuis l'echantillon.
 */

const fs = require('node:fs');
const path = require('node:path');

const SEUIL_CIBLE = 0.10;
const SEUIL_AUTRE = -0.05;
const CONTROLE_PERIME_MS = 15 * 60 * 1000;

const REFERENCES_PAR_DEFAUT = {
  djeff: { cible: 'djeff-vagues-psy-vocals.wav', contraste: 'vivy-voix-reference.mp3' },
};

function flag(env, key, defaut) {
  const brut = String(env?.[key] ?? '').trim().toLowerCase();
  if (!brut) return defaut;
  return !['0', 'false', 'off', 'no', 'non'].includes(brut);
}

function num(env, key, defaut) {
  const brut = Number(env?.[key]);
  return Number.isFinite(brut) && String(env?.[key] ?? '').trim() !== '' ? brut : defaut;
}

function cleVoix(voix) {
  return String(voix || '').trim().toLowerCase();
}

function voixSuivies(env) {
  return new Set(String(env?.A11_VOICE_CHECK_VOICES || 'djeff')
    .split(/[,;\s]+/).map(cleVoix).filter(Boolean));
}

function referencesPour(voix, env = process.env) {
  const cle = cleVoix(voix);
  if (!cle) return null;
  const base = REFERENCES_PAR_DEFAUT[cle] || {};
  const suffixe = cle.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const cible = String(env?.[`A11_VOICE_CHECK_REF_${suffixe}`] || base.cible || '').trim();
  const contraste = String(env?.[`A11_VOICE_CHECK_CONTRAST_${suffixe}`] || base.contraste || '').trim();
  return cible && contraste ? { cible, contraste } : null;
}

/** Cette voix doit-elle etre controlee apres chaque chanson ? */
function doitControler(voix, env = process.env) {
  if (!flag(env, 'A11_VOICE_CHECK_ENABLED', true)) return false;
  const cle = cleVoix(voix);
  return Boolean(cle) && voixSuivies(env).has(cle) && Boolean(referencesPour(cle, env));
}

function verdictDepuisScores(scores = {}, refs = {}, env = process.env) {
  const cible = Number(scores?.[refs.cible]);
  const contraste = Number(scores?.[refs.contraste]);
  if (!Number.isFinite(cible) || !Number.isFinite(contraste)) return { verdict: 'erreur', ecart: null };
  const ecart = Math.round((cible - contraste) * 1000) / 1000;
  if (ecart >= num(env, 'A11_VOICE_CHECK_MIN_GAP', SEUIL_CIBLE)) return { verdict: 'cible', ecart };
  if (ecart <= SEUIL_AUTRE) return { verdict: 'autre', ecart };
  return { verdict: 'incertain', ecart };
}

function urlPont(env = process.env) {
  return String(env?.A11_VOICE_CHECK_URL || env?.A11_VOICE_XTTS_RVC_URL || env?.A11_XTTS_RVC_URL || '')
    .trim().replace(/\/+$/, '');
}

async function mesurerVoix({ audio, filename = 'chanson.mp3', refs, env = process.env, fetchImpl = globalThis.fetch }) {
  const base = urlPont(env);
  if (!base) throw new Error('voice_check_bridge_missing');
  const form = new FormData();
  form.append('audio', new Blob([audio]), filename);
  form.append('references', `${refs.cible},${refs.contraste}`);
  form.append('separate', 'true');
  const reponse = await fetchImpl(`${base}/api/voice/identify`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(num(env, 'A11_VOICE_CHECK_TIMEOUT_MS', 300000)),
  });
  const corps = await reponse.json().catch(() => ({}));
  if (!reponse.ok || corps?.ok !== true) {
    throw new Error(`voice_check_bridge_${reponse.status}:${String(corps?.detail || corps?.error || '').slice(0, 120)}`);
  }
  return corps;
}

async function telecharger(url, fetchImpl, env) {
  const reponse = await fetchImpl(url, {
    signal: AbortSignal.timeout(num(env, 'A11_VOICE_CHECK_DOWNLOAD_TIMEOUT_MS', 120000)),
  });
  if (!reponse.ok) throw new Error(`voice_check_download_${reponse.status}`);
  return Buffer.from(await reponse.arrayBuffer());
}

// --- Registre des taches suivies : un fichier par tache Suno ---

function cheminTache(dir, taskId) {
  const sur = String(taskId || '').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 120);
  return dir && sur ? path.join(dir, `${sur}.json`) : '';
}

function lireTache(dir, taskId) {
  const fichier = cheminTache(dir, taskId);
  if (!fichier || !fs.existsSync(fichier)) return null;
  try {
    return JSON.parse(fs.readFileSync(fichier, 'utf8'));
  } catch {
    return null;
  }
}

function ecrireTache(dir, taskId, record) {
  const fichier = cheminTache(dir, taskId);
  if (!fichier) return false;
  fs.mkdirSync(dir, { recursive: true });
  // Le corps de la requete Suno contient l'URL de rappel et son jeton.
  fs.writeFileSync(fichier, JSON.stringify(record, null, 2), { mode: 0o600 });
  return true;
}

/**
 * A l'envoi : retient la tache si la voix est suivie. Le corps est garde pour
 * pouvoir relancer exactement la meme chanson ; il est efface une fois controle.
 */
function enregistrerTache({ dir, taskId, voice, body, retryOf = '', env = process.env } = {}) {
  if (!dir || !taskId || !doitControler(voice, env)) return null;
  const record = {
    taskId: String(taskId),
    voice: cleVoix(voice),
    retryOf: String(retryOf || ''),
    createdAt: new Date().toISOString(),
    status: 'attente',
    body: body || null,
  };
  ecrireTache(dir, taskId, record);
  return record;
}

function pistesDepuis(tracks = []) {
  return (Array.isArray(tracks) ? tracks : [])
    .map((piste) => ({
      id: String(piste?.id || piste?.audioId || piste?.audio_id || ''),
      url: String(piste?.audioUrl || piste?.audio_url || piste?.sourceAudioUrl || piste?.source_audio_url || piste?.url || ''),
    }))
    .filter((piste) => /^https?:\/\//i.test(piste.url))
    .slice(0, 2);
}

/**
 * A l'arrivee : mesure les variantes, puis relance une fois ou marque la persona.
 * Idempotent : le rappel Suno et le suivi de statut peuvent tous deux le declencher.
 */
async function controlerTache({
  dir,
  taskId,
  tracks = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  relancer = null,
  marquerDerive = null,
  journal = console,
} = {}) {
  const record = lireTache(dir, taskId);
  if (!record) return { skipped: 'non_suivie' };
  if (record.status === 'fait') return { skipped: 'deja_fait', record };
  if (record.status === 'controle' && Date.now() - (Date.parse(record.startedAt || '') || 0) < CONTROLE_PERIME_MS) {
    return { skipped: 'en_cours' };
  }
  const refs = referencesPour(record.voice, env);
  if (!refs) return { skipped: 'sans_reference' };
  const pistes = pistesDepuis(tracks);
  if (!pistes.length) return { skipped: 'sans_piste' };

  ecrireTache(dir, taskId, { ...record, status: 'controle', startedAt: new Date().toISOString() });

  const resultats = [];
  for (const piste of pistes) {
    try {
      const audio = await telecharger(piste.url, fetchImpl, env);
      const mesure = await mesurerVoix({ audio, refs, env, fetchImpl });
      resultats.push({ id: piste.id, ...verdictDepuisScores(mesure.scores, refs, env), scores: mesure.scores });
    } catch (error) {
      resultats.push({ id: piste.id, verdict: 'erreur', ecart: null, error: String(error?.message || error).slice(0, 160) });
    }
  }

  const verdicts = resultats.map((r) => r.verdict);
  const meilleure = resultats.filter((r) => r.verdict === 'cible').sort((a, b) => b.ecart - a.ecart)[0] || null;
  const verdict = meilleure
    ? 'ok'
    : verdicts.every((v) => v === 'autre')
      ? 'rate'
      : verdicts.every((v) => v === 'erreur') ? 'erreur' : 'incertain';

  const fin = {
    ...record,
    status: 'fait',
    checkedAt: new Date().toISOString(),
    verdict,
    meilleure: meilleure?.id || '',
    resultats,
  };

  if (verdict === 'rate' && !record.retryOf) {
    if (flag(env, 'A11_VOICE_CHECK_AUTO_RETRY', true) && typeof relancer === 'function' && record.body) {
      try {
        const nouvelle = await relancer(record.body);
        if (nouvelle) {
          fin.retryTaskId = String(nouvelle);
          enregistrerTache({ dir, taskId: nouvelle, voice: record.voice, body: record.body, retryOf: record.taskId, env });
        }
      } catch (error) {
        fin.retryError = String(error?.message || error).slice(0, 160);
      }
    }
  } else if (verdict === 'rate' && record.retryOf && typeof marquerDerive === 'function') {
    // Deux chansons de suite sans la bonne voix : ce n'est plus un tirage malchanceux,
    // la persona elle-meme ne porte plus la voix. On la fait refabriquer.
    try {
      marquerDerive(record.voice, `voix_differente: ecarts ${resultats.map((r) => r.ecart).join(' / ')}`);
      fin.personaAReprendre = true;
    } catch (error) {
      fin.personaError = String(error?.message || error).slice(0, 160);
    }
  }

  delete fin.body;
  ecrireTache(dir, taskId, fin);
  journal?.info?.(
    '[VoiceCheck] tache=%s voix=%s verdict=%s ecarts=%s%s%s',
    record.taskId,
    record.voice,
    verdict,
    resultats.map((r) => r.ecart ?? r.verdict).join('/'),
    fin.retryTaskId ? ` relance=${fin.retryTaskId}` : '',
    fin.personaAReprendre ? ' persona=a_refaire' : ''
  );
  return { record: fin };
}

/** Les derniers controles, sans le corps des requetes. */
function listerControles(dir, limit = 20) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((nom) => nom.endsWith('.json'))
    .map((nom) => {
      try {
        const record = JSON.parse(fs.readFileSync(path.join(dir, nom), 'utf8'));
        delete record.body;
        return record;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, Math.max(1, Number(limit) || 20));
}

module.exports = {
  SEUIL_CIBLE,
  SEUIL_AUTRE,
  REFERENCES_PAR_DEFAUT,
  doitControler,
  referencesPour,
  verdictDepuisScores,
  mesurerVoix,
  enregistrerTache,
  lireTache,
  controlerTache,
  listerControles,
};
