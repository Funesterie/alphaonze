'use strict';
/**
 * demander-a-djeff-unity.cjs — Poser une question sur le code Unity a Djeff.
 *
 * POURQUOI PAS DE RECHERCHE VECTORIELLE
 *
 * Mesure le 2026-08-16 : le projet Unity actif fait 6 158 tokens. Djeff Engine
 * en accepte 32 768. Le code tient donc CINQ FOIS dans sa fenetre.
 *
 * Un index d'embeddings aurait ajoute des embeddings a calculer, un stockage a
 * maintenir, un decoupage a regler -- et surtout un mode de panne qu'on n'a pas
 * ici : la recuperation qui rate. Un extrait manquant produit une reponse fausse
 * avec l'aplomb d'une reponse juste. En donnant TOUT le code, cette question ne
 * se pose pas.
 *
 * Le jour ou le projet depassera ~25 000 tokens, il faudra decouper. Le script
 * le dira au lieu de tronquer en silence : une reponse batie sur un code
 * amdpute est pire qu'un refus.
 *
 * USAGE
 *   node demander-a-djeff-unity.cjs "pourquoi la moto derape au demarrage ?"
 *   node demander-a-djeff-unity.cjs --inventaire      liste ce qui serait envoye
 *
 * Variables : DJEFF_UNITY_PROJECT (chemin), DJEFF_MODEL, OLLAMA_BASE.
 */

const fs = require('node:fs');
const path = require('node:path');

const PROJET = process.env.DJEFF_UNITY_PROJECT || 'D:/Unity/My project';
const MODELE = process.env.DJEFF_MODEL || 'djeff-toretto';
const OLLAMA = process.env.OLLAMA_BASE || 'http://127.0.0.1:11434';

/** Au-dela, la fenetre de 32k devient serree une fois la question et la reponse comptees. */
const TOKENS_MAX = 25000;
const OCTETS_PAR_TOKEN = 3.5;

const EXTENSIONS = ['.cs', '.shader', '.compute'];

/**
 * Ce qu'on ne lit jamais.
 *
 * `Library` et `Temp` sont des caches regeneres par Unity : des centaines de Mo
 * qui ne disent rien du jeu. TextMeshPro et les paquets tiers sont du code que
 * Djeff n'a pas ecrit et ne modifiera pas -- sur l'autre projet ils pesaient a
 * eux seuls la moitie du total, en shaders de rendu de police.
 */
const DOSSIERS_EXCLUS = [
  'Library', 'Temp', 'Obj', 'Build', 'Builds', 'Logs', 'UserSettings',
  '.git', 'node_modules', 'TextMesh Pro', 'TextMeshPro', 'Packages',
];

function collecter(racine) {
  const fichiers = [];
  const pile = [racine];
  while (pile.length) {
    const dir = pile.pop();
    let entrees;
    try { entrees = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entrees) {
      const complet = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!DOSSIERS_EXCLUS.includes(e.name)) pile.push(complet);
      } else if (EXTENSIONS.includes(path.extname(e.name).toLowerCase())) {
        let taille = 0;
        try { taille = fs.statSync(complet).size; } catch { continue; }
        fichiers.push({ chemin: complet, relatif: path.relative(racine, complet), taille });
      }
    }
  }
  // Les plus gros d'abord : si un jour il faut couper, on coupe la queue, pas la tete.
  return fichiers.sort((a, b) => b.taille - a.taille);
}

function construireContexte(fichiers) {
  const morceaux = [];
  for (const f of fichiers) {
    let contenu;
    try { contenu = fs.readFileSync(f.chemin, 'utf8'); } catch { continue; }
    morceaux.push(`===== ${f.relatif.replace(/\\/g, '/')} =====\n${contenu}`);
  }
  return morceaux.join('\n\n');
}

async function main() {
  const args = process.argv.slice(2);
  const inventaire = args.includes('--inventaire');
  const question = args.filter((a) => !a.startsWith('--')).join(' ').trim();

  if (!fs.existsSync(PROJET)) {
    console.error(`Projet introuvable : ${PROJET}`);
    console.error('Definir DJEFF_UNITY_PROJECT pour en viser un autre.');
    process.exitCode = 1;
    return;
  }

  const fichiers = collecter(path.join(PROJET, 'Assets'));
  const octets = fichiers.reduce((s, f) => s + f.taille, 0);
  const tokens = Math.round(octets / OCTETS_PAR_TOKEN);

  if (inventaire || !question) {
    console.log(`Projet : ${PROJET}`);
    console.log(`${fichiers.length} fichiers, ${octets.toLocaleString('fr-FR')} octets, ~${tokens.toLocaleString('fr-FR')} tokens\n`);
    for (const f of fichiers) {
      console.log(`  ${String(Math.round(f.taille / 1024)).padStart(4)} Ko  ${f.relatif.replace(/\\/g, '/')}`);
    }
    if (!question) console.log('\nUsage : node demander-a-djeff-unity.cjs "ta question"');
    return;
  }

  if (tokens > TOKENS_MAX) {
    // On s'arrete plutot que d'envoyer un code ampute : une reponse batie sur la
    // moitie du projet a l'air aussi sure qu'une reponse juste.
    console.error(`Le projet fait ~${tokens.toLocaleString('fr-FR')} tokens, au-dela de la limite de ${TOKENS_MAX.toLocaleString('fr-FR')}.`);
    console.error('Il faut maintenant selectionner les fichiers pertinents plutot que tout envoyer.');
    process.exitCode = 1;
    return;
  }

  const contexte = construireContexte(fichiers);
  const prompt = [
    'Voici le code source complet du projet Unity NOSSEN.',
    '',
    contexte,
    '',
    '===== QUESTION =====',
    question,
    '',
    'Reponds en te basant UNIQUEMENT sur le code ci-dessus. Si la reponse ne s y trouve pas,',
    'dis-le franchement au lieu de supposer. Cite les fichiers et les lignes quand tu peux.',
  ].join('\n');

  console.log(`${fichiers.length} fichiers, ~${tokens.toLocaleString('fr-FR')} tokens envoyes a ${MODELE}...\n`);
  const t0 = Date.now();

  const reponse = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELE,
      prompt,
      stream: false,
      options: { num_ctx: 32768, temperature: 0.3 },
    }),
    signal: AbortSignal.timeout(600000),
  });

  const data = await reponse.json();
  if (!reponse.ok || !data?.response) {
    console.error('Echec :', data?.error || `HTTP ${reponse.status}`);
    process.exitCode = 1;
    return;
  }

  console.log(data.response.trim());
  console.log(`\n[${((Date.now() - t0) / 1000).toFixed(1)} s]`);
}

main().catch((e) => {
  console.error('Interruption :', e?.message || e);
  process.exitCode = 1;
});
