'use strict';

/**
 * Generation automatique des echantillons manquants du catalogue de voix.
 *
 * Le risque evident ici est la boucle: une voix dont la persona Suno est morte
 * echouerait a chaque passage et relancerait une generation indefiniment, brulant
 * des credits et empilant des tampons en memoire. Quatre garde-fous:
 *
 *   1. Verrou de concurrence: une seule campagne a la fois, jamais deux en parallele.
 *   2. Plafond d'essais par voix: apres N echecs, on abandonne et on le dit.
 *   3. Delai d'attente entre deux essais sur la meme voix.
 *   4. Budget par campagne: on traite au plus M voix, puis on rend la main.
 *
 * Rien n'est garde en memoire au-dela de l'ecriture du fichier.
 */

const {
  readVoiceCatalog,
  upsertVoiceInCatalog,
  attachVoiceSample,
} = require('./voice-catalog.cjs');

const MAX_ATTEMPTS = 3;              // au-dela, la voix est laissee tranquille
const RETRY_COOLDOWN_MS = 3600000;   // 1 h entre deux essais sur la meme voix
const MAX_PER_RUN = 2;               // budget d'une campagne
const POLL_INTERVAL_MS = 8000;
const MAX_POLLS = 30;                // ~4 min, au-dela on abandonne ce tour
const MAX_SAMPLE_BYTES = 12 * 1024 * 1024;

let campagneEnCours = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function intConfig(env, key, fallback) {
  const raw = Number(env?.[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Une voix merite-t-elle une tentative maintenant ? */
function needsSample(entry, env = process.env) {
  if (!entry?.active || entry.sampleFile) return false;
  const maxAttempts = intConfig(env, 'A11_VOICE_SAMPLE_MAX_ATTEMPTS', MAX_ATTEMPTS);
  if (Number(entry.sampleAttempts || 0) >= maxAttempts) return false;
  const last = Date.parse(entry.sampleLastAttemptAt || '') || 0;
  if (!last) return true;
  const cooldown = intConfig(env, 'A11_VOICE_SAMPLE_COOLDOWN_MS', RETRY_COOLDOWN_MS);
  return Date.now() - last >= cooldown;
}

function markAttempt(entry, error, env = process.env) {
  upsertVoiceInCatalog({
    ...entry,
    sampleAttempts: Number(entry.sampleAttempts || 0) + 1,
    sampleLastAttemptAt: new Date().toISOString(),
    sampleLastError: error ? String(error).slice(0, 200) : '',
  }, env);
}

function buildSamplePayload(entry) {
  // La persona seule ne suffit pas a tenir le genre: sans tag negatif, Suno derive.
  // Le projet en pose pour ses artistes officiels (pour Djeff: << female vocals,
  // female lead, airy female hook >>), on applique la meme protection ici.
  const genreTags = entry.gender === 'homme'
    ? 'female vocals, female lead, soprano, airy female hook, romantic pop female vocal'
    : entry.gender === 'femme'
      ? 'male vocals, male lead, deep male voice, gruff male vocal'
      : '';
  const styleGenre = entry.gender === 'homme'
    ? 'male lead vocal, '
    : entry.gender === 'femme'
      ? 'female lead vocal, '
      : '';

  return {
    model: 'V5_5',
    customMode: true,
    instrumental: false,
    title: `Echantillon ${entry.label}`,
    style: `${styleGenre}clean vocal take, sparse backing, close mic, neutral mid tempo`,
    prompt: [
      '[Verse]', `[${entry.label}]`,
      'Je pose ma voix, un mot puis deux',
      'Le souffle passe, tu sais qui parle',
      '', '[Chorus]', `[${entry.label}]`,
      'Ecoute bien, c est moi qui chante',
      'Rien d autre, juste le timbre',
    ].join('\n'),
    negativeTags: [
      'spoken word, narration, celebrity voice imitation, English lyrics',
      genreTags,
    ].filter(Boolean).join(', '),
    callBackUrl: 'https://a11.funesterie.me/health',
    personaId: entry.voiceId,
    personaModel: 'voice_persona',
  };
}

async function generateOne(entry, apiKey, baseUrl, env) {
  const res = await fetch(`${baseUrl}/generate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSamplePayload(entry)),
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json().catch(() => ({}));
  const taskId = body?.data?.taskId;
  if (!taskId) throw new Error(body?.msg || `soumission refusee (${res.status})`);

  const maxPolls = intConfig(env, 'A11_VOICE_SAMPLE_MAX_POLLS', MAX_POLLS);
  for (let i = 0; i < maxPolls; i += 1) {
    await sleep(POLL_INTERVAL_MS);
    const st = await fetch(`${baseUrl}/generate/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20000),
    });
    const sb = await st.json().catch(() => ({}));
    const data = sb?.data || {};
    const items = Array.isArray(data?.response?.sunoData) ? data.response.sunoData : [];
    const best = items.filter((x) => x.audioUrl && x.duration).sort((a, b) => b.duration - a.duration)[0];

    if (best) {
      const audio = await fetch(best.audioUrl, { signal: AbortSignal.timeout(60000) });
      if (!audio.ok) throw new Error(`telechargement ${audio.status}`);
      const buffer = Buffer.from(await audio.arrayBuffer());
      // Plafond dur: un rendu anormalement gros ne doit pas remplir le disque.
      if (buffer.length > MAX_SAMPLE_BYTES) throw new Error('echantillon trop volumineux');
      if (buffer.length < 10000) throw new Error('echantillon trop court');
      attachVoiceSample(entry.name, { buffer, durationSeconds: Math.round(best.duration) }, env);
      return { ok: true, durationSeconds: Math.round(best.duration), bytes: buffer.length };
    }

    const status = String(data.status || '');
    if (/FAIL|ERROR|SENSITIVE/i.test(status)) {
      throw new Error(data.errorMessage || status);
    }
  }
  throw new Error('rendu non recupere dans le delai');
}

/**
 * Genere les echantillons manquants. Sans effet si une campagne tourne deja,
 * si aucune voix n'est eligible, ou si la fonction est desactivee.
 */
async function runMissingVoiceSamples({ apiKey, baseUrl, env = process.env } = {}) {
  if (String(env.A11_VOICE_SAMPLE_AUTO || '1') === '0') {
    return { skipped: 'desactive' };
  }
  if (campagneEnCours) return { skipped: 'campagne_en_cours' };
  if (!apiKey) return { skipped: 'cle_suno_absente' };

  campagneEnCours = true;
  const résultats = [];
  try {
    const budget = intConfig(env, 'A11_VOICE_SAMPLE_MAX_PER_RUN', MAX_PER_RUN);
    const candidates = readVoiceCatalog(env).voices.filter((v) => needsSample(v, env)).slice(0, budget);
    if (!candidates.length) return { skipped: 'rien_a_faire', treated: 0 };

    for (const entry of candidates) {
      // On marque l'essai AVANT de tenter: si le processus meurt en cours, le compteur
      // a deja avance et la voix ne sera pas retentee en boucle au redemarrage.
      markAttempt(entry, '', env);
      try {
        const out = await generateOne(entry, apiKey, baseUrl, env);
        résultats.push({ name: entry.name, ok: true, ...out });
        console.info('[VoiceSample] %s: echantillon stocke (%ss)', entry.name, out.durationSeconds);
      } catch (error) {
        const message = String(error.message || error).slice(0, 200);
        markAttempt({ ...entry, sampleAttempts: Number(entry.sampleAttempts || 0) + 1 }, message, env);
        résultats.push({ name: entry.name, ok: false, error: message });
        console.warn('[VoiceSample] %s: echec (%s)', entry.name, message);
      }
    }
    return { treated: résultats.length, résultats };
  } finally {
    campagneEnCours = false;
  }
}

module.exports = {
  runMissingVoiceSamples,
  needsSample,
  MAX_ATTEMPTS,
  RETRY_COOLDOWN_MS,
};
