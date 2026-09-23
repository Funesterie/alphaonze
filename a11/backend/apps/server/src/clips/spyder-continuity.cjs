'use strict';
/**
 * spyder-continuity.cjs — Spyder, l'observation post-rendu du pipeline clip.
 *
 * Chantier du 23/09/2026 (Djeff : "trop d'incoherence [...] il faut une
 * araignee au plafond, une spyder telemetrie qui se pose toutes les questions
 * des noeuds de la toile de prod"). L'investigation du pipeline (Phase 1,
 * commit dd8d85a5) a etabli un fait central : AUCUNE passe existante n'evalue
 * jamais le CONTENU reellement genere. reviewMontageA11, reviewScenarioK44 et
 * reviewDjeffEngine jugent tous un texte de plan avant tout rendu ; les seuls
 * rejets post-rendu sont des detections de refus du fournisseur (copyright,
 * audio, auth, paiement), pas un jugement de coherence ou de pertinence.
 *
 * Spyder comble exactement ce trou : il regarde l'image REELLEMENT rendue
 * d'un plan, la compare au plan precedent et au brief, et repond a une grille
 * fixe de questions (celle demandee par Djeff) plutot qu'un accept/reject
 * binaire. Une rupture de ton peut etre voulue (montee d'intensite, bridge) :
 * Spyder ne rejette jamais une rupture qui sert le morceau, il la nomme.
 *
 * L'appel vision reutilise l'infrastructure deja en prod dans
 * verify-generated-image-with-llm.cjs (callStructuredVisionJudgeJson) :
 * memes fournisseurs (Janus local, Ollama multimodal, OpenAI-compatible
 * distant), meme chargement d'image (URL http(s), data URL, chemin local).
 * Spyder n'a pas besoin de reinventer cette partie, seulement son propre
 * prompt et sa propre grille de sortie.
 *
 * Ce fichier fournit le jugement (judgeContinuity) et la visualisation
 * (buildToileSvg). Le branchement dans la boucle de rendu de
 * clip-generator-v2.cjs est une etape separee, volontairement pas faite ici :
 * c'est un fichier de ~1500 lignes avec sa propre logique de retry/plafond
 * deja delicate, et une integration bien testee vaut mieux qu'une rapide.
 */

const { callStructuredVisionJudgeJson } = require('../image/verify-generated-image-with-llm.cjs');

const ALLOWED_VERDICTS = new Set(['coherent', 'rupture_acceptee', 'rejete']);

// La grille exacte demandee par Djeff, traduite en questions fermees pour un
// juge qui doit rester bref et verifiable, plus les deux questions ouvertes
// (pourquoi, quelle suite) qui nourrissent le journal et une correction
// eventuelle. Aligne sur les dimensions retenues par la recherche recente
// (MSVBench, EntityBench) : coherence de sujet, de scene, d'action, spatiale,
// jugees plan a plan plutot que sur la video entiere.
const SPYDER_SYSTEM_PROMPT = `Tu es Spyder : tu observes la toile de production d'un clip NOSSEN, plan par plan.
On te montre l'image du plan qui vient d'etre genere. On te donne le plan precedent (texte) et le brief du clip.

Reponds UNIQUEMENT en JSON strict :
{
  "changement_normal": true,
  "coherent_avec_precedent": true,
  "suite_logique_theme": true,
  "meme_ambiance": true,
  "rupture_acceptable": null,
  "raison_changement": "...",
  "suite_possible": "...",
  "verdict": "coherent",
  "confidence": 0.0
}

Regles strictes :
- "changement_normal" : le sujet/decor a-t-il bouge de facon coherente avec l'intention du plan (vrai), ou derive-t-il sans raison (faux) ?
- "coherent_avec_precedent" : le personnage, le lieu et l'eclairage restent-ils reconnaissables depuis le plan precedent ?
- "suite_logique_theme" : ce plan fait-il avancer le sujet du morceau/scenario, ou part-il ailleurs ?
- "meme_ambiance" : couleur, tempo visuel et ton restent-ils dans la meme famille que le plan precedent ?
- "rupture_acceptable" : ne reponds (true/false) QUE si meme_ambiance ou coherent_avec_precedent est faux. Sinon renvoie null. Une rupture de ton peut etre VOULUE (montee d'intensite, bridge musical, changement d'acte) : ne la rejette jamais seulement parce qu'elle change, juge si elle sert le morceau.
- "raison_changement" : une phrase courte en francais, pourquoi ce changement a eu lieu (derive du rendu, intention du plan, erreur de continuite...).
- "suite_possible" : une phrase courte en francais, ce qu'un plan suivant ou une correction pourrait faire si necessaire.
- "verdict" doit etre l'un de : coherent (tout va bien), rupture_acceptee (change mais legitime), rejete (derive non voulue, a corriger).
- "confidence" entre 0 et 1.
- Aucune invention hors de ce qui est visible sur l'image et du brief fourni. Anglais interdit dans les champs texte : reponds en francais.`;

function normalizeText(value = '', max = 600) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function buildSpyderPayload({
  planIndex,
  planName = '',
  planVisual = '',
  previousPlanVisual = '',
  lieu = '',
  mood = '',
  title = '',
} = {}) {
  return {
    plan_index: Number.isInteger(planIndex) ? planIndex : null,
    plan: normalizeText(planName, 60),
    chanson_ou_scenario: normalizeText(title, 200),
    lieu: normalizeText(lieu, 300),
    ambiance_attendue: normalizeText(mood, 400),
    plan_actuel_demande: normalizeText(planVisual, 400),
    plan_precedent_demande: previousPlanVisual ? normalizeText(previousPlanVisual, 400) : null,
  };
}

function normalizeSpyderVerdict(rawResult = {}) {
  const verdictRaw = normalizeText(rawResult?.verdict, 40).toLowerCase();
  const meme_ambiance = rawResult?.meme_ambiance !== false;
  const coherent_avec_precedent = rawResult?.coherent_avec_precedent !== false;
  const ruptureApplicable = meme_ambiance === false || coherent_avec_precedent === false;
  return {
    changement_normal: rawResult?.changement_normal !== false,
    coherent_avec_precedent,
    suite_logique_theme: rawResult?.suite_logique_theme !== false,
    meme_ambiance,
    rupture_acceptable: ruptureApplicable
      ? (rawResult?.rupture_acceptable === true)
      : null,
    raison_changement: normalizeText(rawResult?.raison_changement, 240),
    suite_possible: normalizeText(rawResult?.suite_possible, 240),
    verdict: ALLOWED_VERDICTS.has(verdictRaw) ? verdictRaw : 'uncertain',
    confidence: clamp01(rawResult?.confidence),
  };
}

/**
 * Juge la continuite d'UN plan genere contre le plan precedent et le brief.
 *
 * `imageUrl` : URL http(s), data URL, ou chemin local vers l'image/la frame
 * du plan reellement rendu (pas le prompt texte : Spyder existe justement
 * parce que rien ne regardait le rendu avant lui).
 *
 * `callStructuredVisionJson` est injectable pour les tests, comme le fait deja
 * verify-generated-image-with-llm.cjs pour la meme raison : ne jamais faire
 * dependre un test unitaire d'un vrai modele de vision.
 */
async function judgeContinuity({
  imageUrl = '',
  planIndex,
  planName = '',
  planVisual = '',
  previousPlanVisual = '',
  lieu = '',
  mood = '',
  title = '',
  callStructuredVisionJson,
} = {}) {
  const normalizedImageUrl = normalizeText(imageUrl, 2000);
  if (!normalizedImageUrl) {
    return { ok: false, skipped: true, reason: 'missing_image_url' };
  }

  const payload = buildSpyderPayload({ planIndex, planName, planVisual, previousPlanVisual, lieu, mood, title });

  let rawResult = null;
  try {
    rawResult = typeof callStructuredVisionJson === 'function'
      ? await callStructuredVisionJson({ imageUrl: normalizedImageUrl, payload, systemPrompt: SPYDER_SYSTEM_PROMPT })
      : await callStructuredVisionJudgeJson({ imageUrl: normalizedImageUrl, payload, systemPrompt: SPYDER_SYSTEM_PROMPT });
  } catch (error) {
    return { ok: false, skipped: true, reason: 'spyder_vision_failed', message: String(error?.message || error) };
  }

  if (!rawResult || typeof rawResult !== 'object') {
    return { ok: false, skipped: true, reason: 'spyder_vision_unavailable' };
  }

  return {
    ok: true,
    planIndex: Number.isInteger(planIndex) ? planIndex : null,
    verdict: normalizeSpyderVerdict(rawResult),
  };
}

// ─── La toile ───────────────────────────────────────────────────────────
//
// Un graphe visuel, pas juste un journal texte : chaque plan est un noeud,
// chaque transition jugee est une arete coloree par verdict. "stylé" au sens
// demande — un vrai objet a regarder, pas une liste de plus.

const TOILE_COLORS = {
  coherent: '#4ade80',
  rupture_acceptee: '#fbbf24',
  rejete: '#f87171',
  uncertain: '#94a3b8',
  skipped: '#475569',
};

function escapeXml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function edgeColorFor(entry) {
  if (!entry || entry.skipped) return TOILE_COLORS.skipped;
  const verdict = entry.verdict && entry.verdict.verdict;
  return TOILE_COLORS[verdict] || TOILE_COLORS.uncertain;
}

/**
 * Construit le SVG de la toile a partir d'une liste d'entrees, une par plan :
 *   { planIndex, planName, skipped, verdict: <sortie de judgeContinuity> }
 * Le premier plan n'a pas de transition entrante (pas de plan precedent).
 */
function buildToileSvg(entries = [], options = {}) {
  const nodes = Array.isArray(entries) ? entries : [];
  const title = normalizeText(options.title || '', 120);
  const width = Math.max(360, nodes.length * 140 + 80);
  const height = 260;
  const y = 140;
  const step = nodes.length > 1 ? (width - 160) / (nodes.length - 1) : 0;

  const points = nodes.map((_, i) => ({ x: 80 + step * i, y }));

  const edges = points.slice(1).map((point, i) => {
    const prev = points[i];
    const entry = nodes[i + 1];
    const color = edgeColorFor(entry);
    const reason = entry && entry.verdict ? entry.verdict.raison_changement : '';
    return `<line x1="${prev.x}" y1="${prev.y}" x2="${point.x}" y2="${point.y}" stroke="${color}" stroke-width="3" stroke-linecap="round">`
      + (reason ? `<title>${escapeXml(reason)}</title>` : '')
      + `</line>`;
  }).join('\n  ');

  const nodeCircles = points.map((point, i) => {
    const entry = nodes[i];
    const name = entry ? normalizeText(entry.planName || `Plan ${i}`, 40) : `Plan ${i}`;
    const verdict = entry && entry.verdict ? entry.verdict.verdict : (i === 0 ? 'coherent' : 'uncertain');
    const color = TOILE_COLORS[verdict] || TOILE_COLORS.uncertain;
    return `<g>`
      + `<circle cx="${point.x}" cy="${point.y}" r="16" fill="#0f172a" stroke="${color}" stroke-width="3"/>`
      + `<circle cx="${point.x}" cy="${point.y}" r="5" fill="${color}"/>`
      + `<text x="${point.x}" y="${point.y + 34}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="#cbd5e1">${escapeXml(name)}</text>`
      + `<title>${escapeXml(name)} — ${escapeXml(verdict)}</title>`
      + `</g>`;
  }).join('\n  ');

  const legend = Object.entries({
    coherent: 'cohérent',
    rupture_acceptee: 'rupture assumée',
    rejete: 'rejeté',
    skipped: 'non jugé',
  }).map(([key, label], i) => {
    const lx = 24;
    const ly = 24 + i * 20;
    return `<circle cx="${lx}" cy="${ly}" r="5" fill="${TOILE_COLORS[key]}"/>`
      + `<text x="${lx + 12}" y="${ly + 4}" font-family="system-ui, sans-serif" font-size="11" fill="#94a3b8">${label}</text>`;
  }).join('\n  ');

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#0b1220"/>
  ${title ? `<text x="${width / 2}" y="24" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" fill="#e2e8f0">${escapeXml(title)}</text>` : ''}
  ${edges}
  ${nodeCircles}
  ${legend}
</svg>`;
}

module.exports = {
  SPYDER_SYSTEM_PROMPT,
  ALLOWED_VERDICTS,
  buildSpyderPayload,
  normalizeSpyderVerdict,
  judgeContinuity,
  buildToileSvg,
  TOILE_COLORS,
};
