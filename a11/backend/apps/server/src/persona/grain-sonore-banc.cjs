'use strict';

// Banc gratuit de la signature sonore (27/09/2026), avant tout credit Suno. Protocole de ChatGPT :
//   A  ancien tirage uniforme par morceau (grainChoix)
//   B  affinites fixes derivees du grain (grainPrefere) : controle POSITIF, pas le canon —
//      une preference posee a priori, que l'on retrouve forcement
//   C  profil latent : rien n'est ecrit a la main. Le choix d'un morceau combine
//        - le contexte   : la proximite entre le morceau et chaque element de palette ;
//        - le prompt initial : la proximite entre l'ADN de la persona et chaque element ;
//        - l'histoire    : ses propres choix passes, qui s'estompent (repetition_count / event_age),
//      et le grain ne fait que la bifurcation (le tirage). Tout passe par des plongements de
//      texte (nomic-embed-text), jamais par des traits annotes.
//   Ablations : C sans ADN, C sans histoire ; controle : contexte seul (doit rester au hasard).
// Parametres FIXES avant le premier lancement, jamais regles apres avoir vu les resultats
// (fuite experimentale). Reconnaissance : apprise sur la premiere moitie des morceaux, testee
// sur l'autre moitie, jamais vue.
//
// Usage : node src/persona/grain-sonore-banc.cjs [--morceaux 400] [--runtime <dossier runtime>]

const fs = require('node:fs');
const path = require('node:path');
const { grainChoix, grainPrefere, grainValeur, tauxSaut } = require('./persona-grain.cjs');
const { TEXTURES, MOUVEMENTS, deriveSonicSignature } = require('../music/vivy-prime-color.cjs');

const PERSONAS = ['vivy', 'djeff', 'k44', 'a11'];
const PROFIL = { vivy: 'vivy', djeff: 'djeff', k44: 'kaen44', a11: 'a11' };
const PARAMS = Object.freeze({ contexte: 1, adn: 0.5, histoire: 0.7, concentration: 2, oubli: 0.97 });

function argument(nom, defaut) {
  const i = process.argv.indexOf(`--${nom}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
}

async function plonger(textes, base = 'http://localhost:11434') {
  const sortie = [];
  for (let i = 0; i < textes.length; i += 32) {
    const r = await fetch(`${base}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', input: textes.slice(i, i + 32).map((t) => `clustering: ${t}`) }),
    });
    if (!r.ok) throw new Error(`embed ${r.status}`);
    sortie.push(...(await r.json()).embeddings);
  }
  return sortie;
}

function cosinus(a, b) {
  let p = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) { p += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return p / Math.sqrt(na * nb);
}

function centrerReduire(valeurs) {
  const m = valeurs.reduce((s, v) => s + v, 0) / valeurs.length;
  const e = Math.sqrt(valeurs.reduce((s, v) => s + (v - m) ** 2, 0) / valeurs.length) || 1;
  return valeurs.map((v) => (v - m) / e);
}

/**
 * Choix latent d'un element (condition C). Le grain ne tire que la bifurcation : les
 * probabilites viennent du contexte, du prompt initial et de l'histoire.
 */
function choixLatent(persona, espace, { contexte, adn, histoire }, cle, params = PARAMS) {
  const h = centrerReduire(histoire.map((x) => x || 0));
  const score = contexte.map((c, j) => params.contexte * c + params.adn * (adn ? adn[j] : 0) + params.histoire * (histoire.some(Boolean) ? h[j] : 0));
  const poids = score.map((s) => Math.exp(params.concentration * s));
  // Run 2 (pre-enregistre le 27/09 dans le fil MCP) : l'habitude est une norme molle. Plus
  // l'element dominant pese dans l'histoire estompee (repetition_count), plus le grain saute la
  // cloture : l'element dominant est alors exclu et le tirage se refait sur les autres.
  if (params.saut) {
    const somme = histoire.reduce((a, x) => a + (x || 0), 0);
    if (somme > 0) {
      const dominant = histoire.indexOf(Math.max(...histoire));
      const part = histoire[dominant] / somme;
      const taux = Math.min(1, tauxSaut(persona, 'creation') * (1 + part));
      if (grainValeur(persona, `latent-saut:${espace}`, cle) < taux) poids[dominant] = 0;
    }
  }
  const total = poids.reduce((s, p) => s + p, 0);
  const tirage = grainValeur(persona, `latent:${espace}`, cle);
  let cumul = 0;
  for (let j = 0; j < poids.length; j += 1) {
    cumul += poids[j] / total;
    if (tirage < cumul) return j;
  }
  return poids.length - 1;
}

function reconnaissance(choix, n) {
  // choix[persona][i] = [texture, mouvement] ; apprend sur [0, n/2), teste sur [n/2, n)
  const moitie = Math.floor(n / 2);
  const freq = Object.fromEntries(PERSONAS.map((p) => [p, {}]));
  for (const p of PERSONAS) for (let i = 0; i < moitie; i += 1) for (const k of [`t${choix[p][i][0]}`, `m${choix[p][i][1]}`]) freq[p][k] = (freq[p][k] || 0) + 1;
  let ok = 0; let total = 0;
  for (const p of PERSONAS) {
    for (let i = moitie; i < n; i += 1) {
      const [t, m] = choix[p][i];
      const score = (q) => Math.log(((freq[q][`t${t}`] || 0) + 1) / (moitie + TEXTURES.length)) + Math.log(((freq[q][`m${m}`] || 0) + 1) / (moitie + MOUVEMENTS.length));
      const best = Math.max(...PERSONAS.map(score));
      const gagnants = PERSONAS.filter((q) => score(q) === best);
      if (gagnants.includes(p)) ok += 1 / gagnants.length;
      total += 1;
    }
  }
  return ok / total;
}

function lireMorceaux(runtime, limite) {
  const dossier = path.join(runtime, 'vivy-stream', 'history');
  return fs.readdirSync(dossier)
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8')); } catch { return null; } })
    .filter((x) => x && String(x.lyrics || '').length > 80)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(0, limite)
    .map((x) => `${x.title || x.trackTitle || ''}\n${String(x.lyrics).slice(0, 600)}`);
}

async function main() {
  const runtime = argument('runtime', 'D:/Funesterie/local/a11-data/runtime');
  const n = Number(argument('morceaux', '400'));
  const env = { ...process.env, A11_RUNTIME_ROOT: runtime, RUNTIME_ROOT: runtime };
  const { buildPersonaSystemPrompt } = require('./persona-engine.cjs');
  const morceaux = lireMorceaux(runtime, n);
  const adnTextes = PERSONAS.map((p) => buildPersonaSystemPrompt(PROFIL[p], env) || p);
  const [eT, eM, eAdn, eMorceaux] = [
    await plonger(TEXTURES), await plonger(MOUVEMENTS), await plonger(adnTextes), await plonger(morceaux),
  ];
  const proximite = (vecteur, palette) => centrerReduire(palette.map((e) => cosinus(vecteur, e)));
  const adn = Object.fromEntries(PERSONAS.map((p, k) => [p, { t: proximite(eAdn[k], eT), m: proximite(eAdn[k], eM) }]));

  const conditions = {
    A_uniforme: () => null,
    B_affinitesFixes: () => null,
    C_latent: PARAMS,
    C_latentSaut: { ...PARAMS, saut: true },
    C_sansAdn: { ...PARAMS, adn: 0 },
    C_sansHistoire: { ...PARAMS, histoire: 0 },
    controle_contexteSeul: { ...PARAMS, adn: 0, histoire: 0 },
  };
  const resultats = {};
  for (const [nom, params] of Object.entries(conditions)) {
    const choix = Object.fromEntries(PERSONAS.map((p) => [p, []]));
    let pertinence = 0;
    for (const p of PERSONAS) {
      const histoire = { t: new Array(TEXTURES.length).fill(0), m: new Array(MOUVEMENTS.length).fill(0) };
      for (let i = 0; i < morceaux.length; i += 1) {
        const ctx = { t: proximite(eMorceaux[i], eT), m: proximite(eMorceaux[i], eM) };
        const seed = deriveSonicSignature(morceaux[i]).seed;
        let t; let m;
        if (nom === 'A_uniforme') { t = grainChoix(p, `texture:${seed}`, TEXTURES.length); m = grainChoix(p, `mouvement:${seed}`, MOUVEMENTS.length); }
        else if (nom === 'B_affinitesFixes') { t = grainPrefere(p, 'sonore:texture', TEXTURES, seed); m = grainPrefere(p, 'sonore:mouvement', MOUVEMENTS, seed); }
        else {
          const aP = params.adn ? adn[p] : { t: null, m: null };
          t = choixLatent(p, 'texture', { contexte: ctx.t, adn: aP.t, histoire: histoire.t }, String(seed), params);
          m = choixLatent(p, 'mouvement', { contexte: ctx.m, adn: aP.m, histoire: histoire.m }, String(seed), params);
          for (const cle of ['t', 'm']) histoire[cle] = histoire[cle].map((x) => x * params.oubli);
          histoire.t[t] += 1; histoire.m[m] += 1;
        }
        choix[p].push([t, m]);
        pertinence += ctx.t[t];
      }
    }
    // Profil observe a posteriori : les trois textures les plus choisies, jamais reinjectees.
    const profil = Object.fromEntries(PERSONAS.map((p) => {
      const compte = TEXTURES.map((_, j) => choix[p].filter(([t]) => t === j).length);
      return [p, compte.map((c, j) => [c, j]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([c, j]) => `${TEXTURES[j]} (${Math.round(100 * c / morceaux.length)} %)`)];
    }));
    resultats[nom] = { reconnaissance: reconnaissance(choix, morceaux.length), pertinenceContexte: pertinence / (PERSONAS.length * morceaux.length), profil };
  }
  const lignes = [
    `# Banc sonore gratuit — ${new Date().toISOString()}`,
    '',
    `${morceaux.length} vrais morceaux du jukebox (ordre chronologique), 4 personas, hasard 25 %. Paramètres fixés avant lancement : ${JSON.stringify(PARAMS)}.`,
    'Pertinence : proximité moyenne (centrée réduite) entre le morceau et la texture choisie ; 0 = au hasard.',
    '',
    '| Condition | Reconnaissance à l’aveugle | Pertinence au morceau |',
    '|---|---|---|',
    ...Object.entries(resultats).map(([nom, r]) => `| ${nom} | ${Math.round(100 * r.reconnaissance)} % | ${r.pertinenceContexte.toFixed(2)} |`),
    '',
    '## Profil observé a posteriori (C_latent), jamais réinjecté comme consigne',
    '',
    ...PERSONAS.map((p) => `- ${p} : ${resultats.C_latent.profil[p].join(' · ')}`),
    '',
    '## Profil observé a posteriori (C_latentSaut, run 2 pré-enregistré)',
    '',
    ...PERSONAS.map((p) => `- ${p} : ${resultats.C_latentSaut.profil[p].join(' · ')}`),
  ];
  const out = path.join(runtime, 'grain-bench', `sonore-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  fs.writeFileSync(out, lignes.join('\n'));
  console.log(lignes.join('\n'));
  console.log(`\nRAPPORT ${out}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { PARAMS, choixLatent, centrerReduire, cosinus, reconnaissance };
