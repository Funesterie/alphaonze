'use strict';

/**
 * fiche-compte.cjs — La fiche personnelle de chaque compte (13/09/2026).
 *
 * Créée à la première visite : les nouveaux comptes comme les anciens en ont une,
 * sans toucher à l'inscription. Elle porte un pseudo et un AVATAR : une photo de
 * la personne, analysée par Gemini 2.5 Flash, dont on tire une fiche vidéo en
 * anglais -- le même format que celle de Djeff (src/vivy/visual-identities.cjs).
 * Comfy n'a aucun modèle image-vers-vidéo : un personnage ne se décrit qu'en texte,
 * la ressemblance reste donc approximative.
 *
 * Vie privée : la photo reste dans le dossier du compte (0700/0600), jamais servie
 * en public ; seule la description part chez Comfy, dans les prompts des plans.
 * La photo quitte le serveur une fois, vers Google, le temps de l'analyse -- le
 * consentement (CONSENTEMENT_PHOTO) le dit. Une photo par compte, effaçable.
 *
 * La voix Suno n'est pas ici : elle vit dans voice-learning (Premium et plus).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');

const CONSENTEMENT_PHOTO = 'avatar-photo-v1';
const MODELE_VISION_DEFAUT = 'gemini-2.5-flash';
const ANALYSES_PAR_JOUR = 5;
const TAILLE_PHOTO_MAX = 6 * 1024 * 1024;
const TYPES_PHOTO = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });
// Libellé donné à Sol pour ce personnage : neutre, car un pseudo peut être le nom
// d'une personne connue, que le filtre de Seedance refuserait.
const LIBELLE_CLIP = 'the lead performer';
// Tailles (16/09/2026, demande de Djeff : la fiche était trop courte). La fiche
// française est la description complète, lue par la relecture du scénario ; le
// résumé anglais part dans CHAQUE plan vidéo et doit rester court, sinon il noie
// la description du plan (le cas des ~870 caractères du 12/09).
const FICHE_MAX = 2000;
const RESUME_PLAN_MAX = 600;

function racineFiches(env = process.env) {
  return env.A11_FICHES_DIR || path.join(getCanonicalRuntimeRoot(env), 'fiches');
}

// Jamais l'identifiant brut comme nom de dossier : une empreinte.
function cleCompte(user) {
  const id = String((user && (user.id || user.sub)) || '').trim();
  const email = String((user && user.email) || '').trim().toLowerCase();
  const base = id || email;
  if (!base) return '';
  return crypto.createHash('sha256').update(`fiche:${base}`).digest('hex').slice(0, 32);
}

function dossierCompte(user, env = process.env) {
  const cle = cleCompte(user);
  if (!cle) throw new Error('compte_inconnu');
  return path.join(racineFiches(env), cle);
}

function nettoyer(texte, max) {
  return String(texte == null ? '' : texte)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// La fiche longue garde ses retours à la ligne (« Visage : … », « Cheveux : … »).
function nettoyerFiche(texte) {
  return String(texte == null ? '' : texte)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ')
    .split('\n')
    .map((ligne) => ligne.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 20)
    .join('\n')
    .slice(0, FICHE_MAX);
}

function ecrire(dossier, fiche) {
  fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
  fiche.majA = new Date().toISOString();
  const tmp = path.join(dossier, `fiche.json.${process.pid}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(fiche, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, path.join(dossier, 'fiche.json'));
}

function lireFiche(user, { env = process.env } = {}) {
  const dossier = dossierCompte(user, env);
  try {
    return JSON.parse(fs.readFileSync(path.join(dossier, 'fiche.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const maintenant = new Date().toISOString();
  const fiche = {
    version: 1,
    pseudo: nettoyer(user && (user.username || user.displayName), 40),
    avatar: null,
    analyses: [],
    creeA: maintenant,
    majA: maintenant,
  };
  ecrire(dossier, fiche);
  return fiche;
}

function majFiche(user, { pseudo, videoPrompt, description } = {}, { env = process.env } = {}) {
  const fiche = lireFiche(user, { env });
  if (pseudo !== undefined) fiche.pseudo = nettoyer(pseudo, 40);
  if (videoPrompt !== undefined || description !== undefined) {
    if (!fiche.avatar) throw new Error('avatar_absent');
    if (videoPrompt !== undefined) {
      const texte = nettoyer(videoPrompt, RESUME_PLAN_MAX);
      if (texte.length < 20) throw new Error('description_trop_courte');
      fiche.avatar.videoPrompt = texte;
    }
    // La fiche longue peut être vidée : le résumé des plans suffit à un clip.
    if (description !== undefined) fiche.avatar.description = nettoyerFiche(description);
    fiche.avatar.corrigeeA = new Date().toISOString();
  }
  ecrire(dossierCompte(user, env), fiche);
  return fiche;
}

// Consigne réécrite le 16/09/2026 : plus longue, et respectueuse par construction.
// On décrit ce qui se voit et dure, avec des mots neutres ; jamais d'origine, de
// jugement sur le corps ou de conjecture sur la santé. « Mediterranean, olive
// skin » avait déjà fait inventer un autre homme au générateur (fiche de Djeff).
const CONSIGNE_VISION = [
  'You help a person create their own character for their music videos, from a photo they chose to share. Be accurate, kind and respectful: this person will read what you write about them.',
  'Look at the photo.',
  'If it does not clearly show exactly one real human face, or if the person could be under 18, answer {"ok": false, "raison": "<one short, polite sentence in French>"}.',
  'Otherwise answer {"ok": true, "description": "...", "videoPrompt": "..."}.',
  '"description": in French, 500 to 1500 characters, addressed to nobody, in short labelled parts: "Visage", "Cheveux", "Pilosité" (only if any), "Silhouette", "Tenue", "Signes distinctifs" (only visible, lasting ones such as glasses, piercings, tattoos). Plain, warm, precise vocabulary.',
  '"videoPrompt": in English, at most 500 characters, one affirmative sentence starting with "real adult man", "real adult woman" or "real adult person", listing only lasting physical features and the clothing style, so an actor matching this person can play them.',
  'Describe skin tone only with neutral shade words (light, medium, tan, deep; warm or cool undertone). Describe build only with neutral words (slim, medium, sturdy, broad-shouldered).',
  'Never mention or guess origin, ethnicity, nationality, religion, health, disability, weight judgement, attractiveness, an age number, emotions, the background, or a name. Never use a negation, a joke or a comparison with a celebrity.',
].join('\n');

async function decrireVisageGemini({ image, mimeType, fetchImpl = globalThis.fetch, env = process.env }) {
  const cle = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '';
  if (!cle || typeof fetchImpl !== 'function') throw new Error('vision_indisponible');
  const modele = env.A11_FICHE_VISION_MODEL || MODELE_VISION_DEFAUT;
  const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modele)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': cle },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: CONSIGNE_VISION }, { inline_data: { mime_type: mimeType, data: image.toString('base64') } }],
      }],
      // Réflexion coupée : sans ça, Gemini 2.5 Flash consomme le budget de jetons
      // à réfléchir et rend un JSON tronqué.
      // 1400 jetons : la fiche française longue en plus du résumé anglais.
      generationConfig: { temperature: 0.2, maxOutputTokens: 1400, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`vision_http_${r.status}`);
  const corps = await r.json();
  const parts = (((corps && corps.candidates) || [])[0] || {}).content?.parts || [];
  const texte = parts.map((p) => p.text || '').join('');
  try {
    return JSON.parse(texte);
  } catch (_) {
    throw new Error('vision_reponse_illisible');
  }
}

function interpreterAnalyse(reponse) {
  if (!reponse || reponse.ok !== true) {
    return { ok: false, raison: nettoyer(reponse && reponse.raison, 200) || 'Photo refusée : il faut un seul visage d’adulte, bien net.' };
  }
  const texte = nettoyer(reponse.videoPrompt, RESUME_PLAN_MAX);
  if (!/^real adult (man|woman|person)\b/i.test(texte) || texte.length < 40) {
    return { ok: false, raison: 'Description inexploitable : essaie une autre photo, de face et bien éclairée.' };
  }
  // Filet si le modèle glisse malgré la consigne : on ne garde pas un texte qui
  // parle d'origine ou juge le corps, on laisse la personne écrire le sien.
  const description = nettoyerFiche(reponse.description);
  const descriptionOk = description.length >= 80 && !MOTS_NON_RESPECTUEUX.test(description);
  return { ok: true, videoPrompt: MOTS_NON_RESPECTUEUX.test(texte) ? neutraliser(texte) : texte, description: descriptionOk ? description : '' };
}

// Ce que la consigne interdit, en français et en anglais. Liste courte et
// volontairement précise : elle vise les dérapages, pas les mots ordinaires.
const MOTS_NON_RESPECTUEUX = /\b(m[ée]diterran\w*|mediterranean|ethni\w*|origine\w*|arab\w*|africa\w*|asia\w*|latin[oa]s?|caucasi\w*|ob[èe]se|obese|overweight|surpoids|gros(?:se)?|fat|ugly|laid(?:e)?|moche|attractive|séduisant\w*|handicap\w*|disabled|malade|sick)\b/i;

function neutraliser(texte) {
  return texte
    .split(',')
    .filter((morceau) => !MOTS_NON_RESPECTUEUX.test(morceau))
    .join(',')
    .replace(/\s+,/g, ',')
    .trim();
}

function supprimerFichiersPhoto(dossier) {
  for (const ext of Object.values(TYPES_PHOTO)) fs.rmSync(path.join(dossier, `photo.${ext}`), { force: true });
}

async function enregistrerPhoto(user, { image, mimeType, consentement } = {}, {
  env = process.env,
  decrireImpl = decrireVisageGemini,
  maintenant = new Date(),
} = {}) {
  if (consentement !== CONSENTEMENT_PHOTO) throw new Error('consentement_manquant');
  const type = String(mimeType || '').toLowerCase();
  const ext = TYPES_PHOTO[type];
  if (!ext) throw new Error('format_photo');
  if (!Buffer.isBuffer(image) || !image.length || image.length > TAILLE_PHOTO_MAX) throw new Error('taille_photo');

  const dossier = dossierCompte(user, env);
  const fiche = lireFiche(user, { env });
  // Le compteur est écrit AVANT l'appel : une analyse ratée compte aussi.
  const jour = maintenant.toISOString().slice(0, 10);
  const duJour = (fiche.analyses || []).filter((d) => String(d).slice(0, 10) === jour);
  if (duJour.length >= ANALYSES_PAR_JOUR) throw new Error('trop_d_analyses');
  fiche.analyses = [...duJour, maintenant.toISOString()];
  ecrire(dossier, fiche);

  const analyse = interpreterAnalyse(await decrireImpl({ image, mimeType: type, env }));
  if (!analyse.ok) return { ok: false, raison: analyse.raison, fiche };

  supprimerFichiersPhoto(dossier);
  const photo = `photo.${ext}`;
  fs.writeFileSync(path.join(dossier, photo), image, { mode: 0o600 });
  fiche.avatar = {
    videoPrompt: analyse.videoPrompt,
    proposee: analyse.videoPrompt,
    description: analyse.description,
    descriptionProposee: analyse.description,
    photo,
    mimeType: type,
    consentement: CONSENTEMENT_PHOTO,
    analyseeA: maintenant.toISOString(),
    fournisseur: 'gemini',
  };
  ecrire(dossier, fiche);
  return { ok: true, fiche };
}

function supprimerAvatar(user, { env = process.env } = {}) {
  const fiche = lireFiche(user, { env });
  const dossier = dossierCompte(user, env);
  supprimerFichiersPhoto(dossier);
  fiche.avatar = null;
  ecrire(dossier, fiche);
  return fiche;
}

function cheminPhoto(user, { env = process.env } = {}) {
  const fiche = lireFiche(user, { env });
  if (!fiche.avatar || !fiche.avatar.photo) return null;
  const chemin = path.join(dossierCompte(user, env), path.basename(fiche.avatar.photo));
  return fs.existsSync(chemin) ? { chemin, mimeType: fiche.avatar.mimeType } : null;
}

/** Ce que la page reçoit : jamais le chemin de la photo. */
function vuePublique(fiche) {
  const a = fiche && fiche.avatar;
  return {
    pseudo: (fiche && fiche.pseudo) || '',
    avatar: a
      ? { videoPrompt: a.videoPrompt, proposee: a.proposee, description: a.description || '', analyseeA: a.analyseeA, corrigeeA: a.corrigeeA || null, aPhoto: Boolean(a.photo) }
      : null,
    analysesRestantesAujourdhui: Math.max(0, ANALYSES_PAR_JOUR - ((fiche && fiche.analyses) || [])
      .filter((d) => String(d).slice(0, 10) === new Date().toISOString().slice(0, 10)).length),
  };
}

/** Pour un clip en casting « Moi » : la fiche vidéo du compte, ou null. */
function identiteClipDuCompte(user, { env = process.env } = {}) {
  if (!cleCompte(user)) return null;
  const fiche = lireFiche(user, { env });
  const texte = fiche.avatar && fiche.avatar.videoPrompt;
  if (!texte) return null;
  const identite = { label: LIBELLE_CLIP, videoPrompt: texte };
  if (fiche.avatar.description) identite.description = fiche.avatar.description;
  return identite;
}

module.exports = {
  ANALYSES_PAR_JOUR,
  CONSENTEMENT_PHOTO,
  CONSIGNE_VISION,
  FICHE_MAX,
  RESUME_PLAN_MAX,
  LIBELLE_CLIP,
  TAILLE_PHOTO_MAX,
  TYPES_PHOTO,
  cheminPhoto,
  cleCompte,
  decrireVisageGemini,
  enregistrerPhoto,
  identiteClipDuCompte,
  interpreterAnalyse,
  lireFiche,
  majFiche,
  supprimerAvatar,
  vuePublique,
};
