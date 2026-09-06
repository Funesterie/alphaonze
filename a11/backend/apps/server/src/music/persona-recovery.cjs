'use strict';

/**
 * Reanimation d'une persona Suno expiree — le « gene sauveur » du catalogue.
 *
 * Pourquoi une persona meurt-elle ? Elle n'est pas un fichier chez nous: c'est une
 * reference chez Suno vers un clip source heberge sur leurs serveurs. Retention,
 * changement de version de modele, purge: quand le clip disparait, l'identifiant
 * survit dans notre catalogue mais ne designe plus rien. Suno repond alors 553
 * « The voice has expired » ou « voice persona generation failed ». On gardait
 * l'adresse, ils avaient demoli la maison.
 *
 * Le remede tient a une chose: garder l'ADN chez nous. Le catalogue conserve deja un
 * echantillon audio de chaque voix sur notre disque (voice-catalog.cjs, sampleFile),
 * precisement parce que les URL Suno expirent. Cet echantillon suffit a refabriquer
 * une persona:
 *
 *   1. reinjecter l'echantillon              -> POST /generate/upload-extend (taskId)
 *   2. attendre que le clip existe           -> GET  /generate/record-info   (audioId)
 *   3. refabriquer la persona depuis ce clip -> POST /generate/generate-persona
 *   4. remplacer le voiceId mort dans le catalogue, en gardant le meme echantillon
 *
 * Une voix sans echantillon n'est pas reanimable: il faut un nouvel enregistrement,
 * et le consentement qui va avec. On le dit au lieu de le masquer.
 *
 * La reanimation coute une generation Suno. Memes garde-fous que les echantillons:
 * verrou de concurrence, plafond d'essais, delai entre deux tentatives.
 */

const fs = require('node:fs');
const crypto = require('node:crypto');

const {
  findVoiceInCatalog,
  upsertVoiceInCatalog,
  readVoiceSample,
  normalizeVoiceId,
} = require('./voice-catalog.cjs');

const MAX_RECOVERY_ATTEMPTS = 2;        // au-dela, la voix attend une main humaine
const RECOVERY_COOLDOWN_MS = 21600000;  // 6 h entre deux reanimations d'une meme voix
const POLL_INTERVAL_MS = 8000;
const MAX_POLLS = 30;                   // ~4 min, au-dela on rend la main
const VOCAL_WINDOW_SECONDS = 20;        // Suno impose une fenetre vocale de 10 a 30 s

let reanimationEnCours = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function intConfig(env, key, fallback) {
  const raw = Number(env?.[key]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * La signature d'une persona morte. Suno la formule de plusieurs facons selon
 * l'endpoint: code 553, « voice has expired », « voice persona generation failed ».
 * On reste sur ces trois marqueurs: elargir ferait passer pour un deces de voix
 * n'importe quelle panne de generation, et on desactiverait des voix vivantes.
 */
function looksLikeExpiredPersona(value) {
  if (!value) return false;
  // Suno transporte son code reel dans l'enveloppe du corps avec un HTTP 200: un
  // ?? sur status masquait donc toujours le 553 au seul site d'appel de production.
  const codes = [value?.status, value?.code, value?.apiCode]
    .map((brut) => Number(brut))
    .filter((nombre) => Number.isFinite(nombre));
  const texte = String(
    value?.message || value?.msg || value?.detail || value || ''
  ).toLowerCase();
  if (codes.includes(553)) return true;
  if (/voice\s+has\s+expired/.test(texte)) return true;
  if (/voice\s+persona\s+generation\s+failed/.test(texte)) return true;
  if (/recreate\s+the\s+voice/.test(texte)) return true;
  return false;
}

/** Constate le deces sans rien detruire: l'echantillon reste, c'est l'ADN. */
function markPersonaExpired(nameOrAlias, detail = '', env = process.env) {
  const entry = findVoiceInCatalog(nameOrAlias, env);
  if (!entry) return null;
  if (entry.personaExpiredAt) return entry;
  return upsertVoiceInCatalog({
    ...entry,
    personaExpiredAt: new Date().toISOString(),
    recoveryLastError: String(detail || '').slice(0, 200),
  }, env);
}

/** Une voix merite-t-elle une tentative de reanimation maintenant ? */
function canAttemptRecovery(entry, env = process.env) {
  if (!entry?.personaExpiredAt) return false;
  if (!entry.sampleFile) return false;
  const maxAttempts = intConfig(env, 'A11_PERSONA_RECOVERY_MAX_ATTEMPTS', MAX_RECOVERY_ATTEMPTS);
  if (Number(entry.recoveryAttempts || 0) >= maxAttempts) return false;
  const last = Date.parse(entry.recoveryLastAttemptAt || '') || 0;
  if (!last) return true;
  const cooldown = intConfig(env, 'A11_PERSONA_RECOVERY_COOLDOWN_MS', RECOVERY_COOLDOWN_MS);
  return Date.now() - last >= cooldown;
}

function markRecoveryAttempt(entry, error, env = process.env) {
  return upsertVoiceInCatalog({
    ...entry,
    recoveryAttempts: Number(entry.recoveryAttempts || 0) + 1,
    recoveryLastAttemptAt: new Date().toISOString(),
    recoveryLastError: error ? String(error).slice(0, 200) : '',
  }, env);
}

/**
 * Fenetre vocale a extraire du clip. Suno exige 10 a 30 s: on vise 20 s, en partant
 * apres l'attaque quand la duree le permet (les premieres secondes portent souvent un
 * silence ou un fondu, pas de la voix).
 */
function resolveVocalWindow(durationSeconds = 0) {
  const duree = Number(durationSeconds) > 0 ? Number(durationSeconds) : 0;
  if (!duree || duree <= VOCAL_WINDOW_SECONDS + 2) {
    return { vocalStart: 0, vocalEnd: Math.min(30, Math.max(10, duree || VOCAL_WINDOW_SECONDS)) };
  }
  const depart = Math.min(Math.max(2, Math.floor(duree * 0.15)), duree - VOCAL_WINDOW_SECONDS);
  return { vocalStart: depart, vocalEnd: depart + VOCAL_WINDOW_SECONDS };
}

/**
 * Lien signe et perissable vers l'echantillon.
 *
 * Suno doit pouvoir telecharger l'ADN, donc sans authentification. Mais ce sont des
 * voix de personnes reelles, donnees avec un consentement nominatif: l'URL doit rester
 * indevinable et expirer. Signature HMAC sur (nom, echeance), comparaison a temps
 * constant, duree de vie courte -- le temps d'une reanimation, pas davantage.
 */
function resolveSampleShareSecret(env = process.env) {
  return String(env.A11_VOICE_SAMPLE_SHARE_SECRET || env.JWT_SECRET || '').trim();
}

function signSampleShare(name, expiresAt, env = process.env) {
  const secret = resolveSampleShareSecret(env);
  if (secret.length < 24) return '';
  return crypto.createHmac('sha256', secret)
    .update(`voice-sample:${String(name || '')}:${String(expiresAt || '')}`)
    .digest('hex')
    .slice(0, 40);
}

function verifySampleShare(name, expiresAt, signature, env = process.env) {
  const echeance = Number(expiresAt);
  if (!Number.isFinite(echeance) || echeance <= Date.now()) return false;
  const attendue = signSampleShare(name, expiresAt, env);
  if (!attendue) return false;
  // timingSafeEqual compare des OCTETS: une garde sur la longueur en caracteres
  // laissait passer une signature accentuee et levait une RangeError sur une
  // route publique sans authentification.
  const attendueOctets = Buffer.from(attendue, 'utf8');
  const fournieOctets = Buffer.from(String(signature || ''), 'utf8');
  if (attendueOctets.length !== fournieOctets.length) return false;
  return crypto.timingSafeEqual(attendueOctets, fournieOctets);
}

function buildSampleShareUrl(name, publicBaseUrl, env = process.env, ttlMs = 900000) {
  const base = String(publicBaseUrl || '').replace(/\/+$/, '');
  if (!base) return '';
  const expiresAt = Date.now() + Math.max(60000, Number(ttlMs) || 0);
  const signature = signSampleShare(name, expiresAt, env);
  if (!signature) return '';
  // getPublicBaseUrl ne rend que l'origine: le prefixe de montage du routeur doit
  // etre concatene ici, exactement comme le fait buildSunoCallbackUrl. Sans lui,
  // Suno recevait une URL en 404 et aucune reanimation ne pouvait aboutir.
  return `${base}/api/vivy/studio/voice-catalog/${encodeURIComponent(name)}/sample/shared`
    + `?exp=${expiresAt}&sig=${signature}`;
}

/**
 * URL de rappel Suno. Obligatoire sur /generate/upload-extend — sans elle, l'API
 * rend « Please enter callBackUrl. » et la reanimation echoue.
 *
 * Resolue ici plutot qu'importee de vivy-studio.cjs : ce module est le coeur de la
 * reanimation, il ne doit pas dependre du gros module de route pour demarrer.
 * Memes variables d'environnement, meme forme, meme jeton facultatif.
 */
function resolveRecoveryCallbackUrl(explicite = '', env = process.env) {
  const base = String(explicite || env.VIVY_SUNO_CALLBACK_URL || env.SUNO_CALLBACK_URL || '').trim();
  if (!base) return '';
  const token = String(env.VIVY_SUNO_CALLBACK_TOKEN || env.SUNO_CALLBACK_TOKEN || '').trim();
  if (!token) return base;
  return `${base}${base.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`;
}

async function readSunoJson(response) {
  const payload = await response.json().catch(() => ({}));
  const code = Number(payload?.code);
  const ok = response.ok && (!Number.isFinite(code) || code === 200);
  return { ok, payload, code, message: String(payload?.msg || payload?.message || '') };
}

/**
 * Reanime une voix depuis son echantillon.
 *
 * `sampleUrl` est injecte par l'appelant: c'est a lui de savoir sous quelle URL
 * publique l'echantillon est joignable, ce module n'a pas a deviner le routage. Sans
 * URL atteignable par Suno, la reanimation est impossible et on le dit franchement.
 */
async function recoverPersonaFromSample(nameOrAlias, options = {}, env = process.env) {
  const {
    apiKey,
    baseUrl,
    sampleUrl,
    model = 'V5',
    fetchImpl = globalThis.fetch,
    timeoutMs = 60000,
  } = options;

  const entry = findVoiceInCatalog(nameOrAlias, env);
  if (!entry) return { ok: false, reason: 'voice_not_found' };
  if (!entry.sampleFile) return { ok: false, reason: 'no_sample_dna', voice: entry.name };
  if (!apiKey) return { ok: false, reason: 'missing_api_key', voice: entry.name };
  if (!sampleUrl) return { ok: false, reason: 'sample_not_reachable', voice: entry.name };
  if (!canAttemptRecovery(entry, env)) {
    return { ok: false, reason: 'recovery_not_due', voice: entry.name };
  }
  if (reanimationEnCours) return { ok: false, reason: 'recovery_busy', voice: entry.name };

  const sample = readVoiceSample(entry.name, env);
  if (!sample?.path || !fs.existsSync(sample.path)) {
    return { ok: false, reason: 'sample_file_missing', voice: entry.name };
  }

  reanimationEnCours = true;
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  // La fenetre vocale sert DEUX fois : ici pour dire a Suno ou reprendre l'audio,
  // et plus bas pour decouper l'ADN de la persona. On la calcule donc avant l'upload.
  const fenetre = resolveVocalWindow(entry.sampleDurationSeconds || sample.durationSeconds);
  // `continueAt` est obligatoire sur /generate/upload-extend : sans lui l'API rend
  // « continueAt cannot be null » et la reanimation echoue avant meme de commencer.
  // Constate le 2026-08-03 sur la voix de Djeff, morte depuis le 30/07 — la recette
  // n'avait donc jamais pu aboutir depuis qu'elle existe. On reprend a la fin de la
  // fenetre vocale : la continuation prolonge la voix qu'on veut capturer, pas le
  // silence qui la precede.
  const continueAt = Math.max(0, Number(fenetre.vocalEnd) || VOCAL_WINDOW_SECONDS);

  // Manquant, il fait echouer l'appel apres coup, en consommant une tentative sur
  // les deux autorisees. On s'arrete AVANT de la depenser.
  const callBackUrl = resolveRecoveryCallbackUrl(options.callBackUrl, env);
  if (!callBackUrl) {
    reanimationEnCours = false;
    return { ok: false, reason: 'missing_callback_url', voice: entry.name };
  }

  try {
    // 1. Reinjecter l'ADN. On repasse par upload-extend, deja eprouve ici, plutot que
    //    par une voie non testee: il rend un taskId a partir d'une simple URL.
    const upload = await fetchImpl(`${baseUrl}/generate/upload-extend`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        uploadUrl: sampleUrl,
        defaultParamFlag: false,
        instrumental: false,
        continueAt,
        model,
        callBackUrl,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const uploadRes = await readSunoJson(upload);
    if (!uploadRes.ok) {
      markRecoveryAttempt(entry, `upload:${uploadRes.code || upload.status}:${uploadRes.message}`, env);
      return { ok: false, reason: 'upload_failed', detail: uploadRes.message, voice: entry.name };
    }
    const taskId = String(uploadRes.payload?.data?.taskId || uploadRes.payload?.data?.task_id || '').trim();
    if (!taskId) {
      markRecoveryAttempt(entry, 'upload:no_task_id', env);
      return { ok: false, reason: 'upload_no_task', voice: entry.name };
    }

    // 2. Attendre que le clip existe reellement: generate-persona refuse un taskId
    //    dont la generation n'est pas terminee.
    let audioId = '';
    let dernierStatut = '';
    for (let i = 0; i < MAX_POLLS && !audioId; i += 1) {
      await sleep(POLL_INTERVAL_MS);
      const info = await fetchImpl(
        `${baseUrl}/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(timeoutMs) }
      );
      const infoRes = await readSunoJson(info);
      const data = infoRes.payload?.data || {};
      dernierStatut = String(data.status || data.state || '').toUpperCase();
      if (/FAILED|ERROR|SENSITIVE/.test(dernierStatut)) break;
      const pistes = data?.response?.sunoData || data?.response?.data || data?.sunoData || [];
      const piste = Array.isArray(pistes) ? pistes.find((p) => p?.id || p?.audioId) : null;
      if (piste && /SUCCESS/.test(dernierStatut)) audioId = String(piste.id || piste.audioId || '').trim();
    }
    if (!audioId) {
      markRecoveryAttempt(entry, `clip:${dernierStatut || 'timeout'}`, env);
      return { ok: false, reason: 'clip_not_ready', detail: dernierStatut, voice: entry.name };
    }

    // 3. Refabriquer la persona depuis ce clip neuf.
    // Meme fenetre que celle passee a l'upload : deux calculs separes pourraient
    // diverger si la duree de l'echantillon changeait entre-temps.
    const { vocalStart, vocalEnd } = fenetre;
    const persona = await fetchImpl(`${baseUrl}/generate/generate-persona`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        taskId,
        audioId,
        name: entry.label || entry.name,
        description: entry.note
          || `Voix ${entry.label || entry.name} du catalogue Funesterie, reanimee depuis son echantillon de reference.`,
        vocalStart,
        vocalEnd,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const personaRes = await readSunoJson(persona);
    const nouveauVoiceId = normalizeVoiceId(
      personaRes.payload?.data?.personaId || personaRes.payload?.data?.persona_id || ''
    );
    if (!personaRes.ok || !nouveauVoiceId) {
      markRecoveryAttempt(entry, `persona:${personaRes.code || persona.status}:${personaRes.message}`, env);
      return { ok: false, reason: 'persona_not_created', detail: personaRes.message, voice: entry.name };
    }

    // 4. Nouvelle identite, meme ADN. On repasse sampleFile explicitement: sans lui,
    //    upsertVoiceInCatalog effacerait l'echantillon en voyant changer le voiceId,
    //    et la voix deviendrait irreanimable au deces suivant.
    const reanimee = upsertVoiceInCatalog({
      ...entry,
      voiceId: nouveauVoiceId,
      sampleFile: entry.sampleFile,
      sampleDurationSeconds: entry.sampleDurationSeconds,
      sampleAt: entry.sampleAt,
      personaExpiredAt: '',
      recoveryAttempts: 0,
      recoveryLastError: '',
      recoveryLastAttemptAt: new Date().toISOString(),
      recoveredAt: new Date().toISOString(),
    }, env);

    console.info('[PersonaRecovery] voix=%s reanimee persona=%s...', reanimee.name, nouveauVoiceId.slice(0, 4));
    return { ok: true, voice: reanimee.name, idMask: reanimee.idMask, recoveredAt: reanimee.recoveredAt };
  } catch (error) {
    markRecoveryAttempt(entry, error?.message || error, env);
    return { ok: false, reason: 'recovery_error', detail: String(error?.message || error).slice(0, 200), voice: entry.name };
  } finally {
    reanimationEnCours = false;
  }
}

module.exports = {
  looksLikeExpiredPersona,
  markPersonaExpired,
  canAttemptRecovery,
  resolveRecoveryCallbackUrl,
  resolveVocalWindow,
  recoverPersonaFromSample,
  buildSampleShareUrl,
  verifySampleShare,
};
