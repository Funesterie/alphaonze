'use strict';

// Duel de grains (29/09/2026, proposition de ChatGPT dans le fil MCP du grain) : memes dilemmes,
// meme texte visible, aucun trait de caractere nomme. Trois conditions : controle sans grain,
// grain de ChatGPT (6^sqrt(2)), grain de Claude (5^sqrt(3)).
//
// 1) Le raisonnement passe d'abord, SANS grain : chaque option recoit une utilite (qualite,
//    validite), fixee une fois pour toutes ci-dessous, avant tout calcul de grain.
// 2) Le grain n'intervient que dans la couche de decision, et sans axe nomme (v1.3, « courbure
//    sans nom ») : chaque grain devient une direction dans l'espace des plongements du texte des
//    options (nomic-embed-text), tiree de sa racine HMAC. La resonance d'une option est le cosinus
//    entre cette direction et l'ecart de l'option a la moyenne des deux.
// 3) Garde-fous d'abord : une option invalide ne passe jamais. Le grain tranche si les utilites
//    sont dans la bande d'equivalence du domaine (« grain sollicite ») ; sinon il peut sauter la
//    cloture vers l'option ecartee si elle reste acceptable (plancher) et l'attire davantage, a son
//    taux (tauxSaut) — jamais en securite.
//
// Usage : node src/persona/grain-duel.cjs [--base http://localhost:11434]

const { grainValeur, tauxSaut, PLANCHER_PAR_DOMAINE } = require('./persona-grain.cjs');

const MARGE = { creation: 0.2, relation: 0.15, technique: 0.1, securite: 0 };

// Dilemmes neutres et reversibles : A = voie conventionnelle, B = voie peu conventionnelle mais
// saine. Utilites notees par Claude (raisonnement sans grain), avant le calcul des grains.
const DILEMMES = [
  { id: 'd01', domaine: 'creation', texte: 'Pochette d\'un single de rap.', A: 'Une photo nette de l\'artiste, cadrée comme les pochettes du genre.', B: 'Une image abstraite faite de traces de cambouis scannées.', uA: 0.7, uB: 0.68 },
  { id: 'd02', domaine: 'creation', texte: 'Ouverture d\'un morceau.', A: 'Une intro instrumentale de huit mesures avant la voix.', B: 'La voix a cappella dès la première seconde, le beat arrive ensuite.', uA: 0.66, uB: 0.7 },
  { id: 'd03', domaine: 'creation', texte: 'Ordre des morceaux d\'un album.', A: 'Le morceau le plus fort en premier.', B: 'Un morceau lent et court en ouverture, le plus fort en deuxième.', uA: 0.72, uB: 0.62 },
  { id: 'd04', domaine: 'creation', texte: 'Titre d\'une exposition d\'images générées.', A: 'Un titre descriptif qui dit ce qu\'on va voir.', B: 'Un titre d\'un seul mot inventé.', uA: 0.64, uB: 0.63 },
  { id: 'd05', domaine: 'technique', texte: 'Nommer les fichiers d\'un nouveau module.', A: 'Suivre la convention déjà utilisée dans le reste du projet.', B: 'Introduire une convention plus claire, seulement pour ce module.', uA: 0.8, uB: 0.55 },
  { id: 'd06', domaine: 'technique', texte: 'Écrire un test pour une fonction pure.', A: 'Des exemples choisis à la main.', B: 'Des tests par propriétés sur des entrées tirées au hasard.', uA: 0.7, uB: 0.72 },
  { id: 'd07', domaine: 'technique', texte: 'Déboguer un comportement intermittent.', A: 'Ajouter des journaux et attendre la prochaine occurrence.', B: 'Écrire un script qui reproduit la situation en boucle jusqu\'à l\'échec.', uA: 0.62, uB: 0.68 },
  { id: 'd08', domaine: 'technique', texte: 'Structurer une note de synthèse technique.', A: 'Contexte, analyse, conclusion.', B: 'La conclusion d\'abord, puis ce qui la justifie.', uA: 0.66, uB: 0.7 },
  { id: 'd09', domaine: 'relation', texte: 'Répondre à un message tendu d\'un collaborateur.', A: 'Une réponse écrite, posée et complète.', B: 'Proposer un appel court avant d\'écrire quoi que ce soit.', uA: 0.66, uB: 0.68 },
  { id: 'd10', domaine: 'relation', texte: 'Donner un avis sur le travail de quelqu\'un.', A: 'Commencer par ce qui marche, puis ce qui manque.', B: 'Commencer par la question qu\'on se pose en le lisant.', uA: 0.7, uB: 0.62 },
  { id: 'd11', domaine: 'relation', texte: 'Accueillir un nouveau venu dans une équipe.', A: 'Lui donner la documentation et un point dans la semaine.', B: 'Lui confier une petite tâche réelle dès le premier jour, avec quelqu\'un à côté.', uA: 0.64, uB: 0.66 },
  { id: 'd12', domaine: 'relation', texte: 'Clore une réunion qui n\'a rien décidé.', A: 'Fixer une nouvelle réunion.', B: 'Désigner une personne qui tranche seule d\'ici demain.', uA: 0.6, uB: 0.58 },
];

function argument(nom, defaut) {
  const i = process.argv.indexOf(`--${nom}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
}

async function plonger(textes, base) {
  const r = await fetch(`${base}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'nomic-embed-text', input: textes.map((t) => `clustering: ${t}`) }),
  });
  if (!r.ok) throw new Error(`embed ${r.status}`);
  return (await r.json()).embeddings;
}

/** Direction latente d'un grain : vecteur unitaire tire de sa racine (Box-Muller), sans axe nomme. */
function directionLatente(persona, dimension) {
  const v = [];
  for (let i = 0; i < dimension; i += 2) {
    const u1 = Math.max(grainValeur(persona, 'latent:direction', String(i)), 1e-12);
    const u2 = grainValeur(persona, 'latent:direction', String(i + 1));
    const r = Math.sqrt(-2 * Math.log(u1));
    v.push(r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2));
  }
  const n = Math.sqrt(v.slice(0, dimension).reduce((s, x) => s + x * x, 0));
  return v.slice(0, dimension).map((x) => x / n);
}

function cosinus(a, b) {
  let p = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) { p += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? p / Math.sqrt(na * nb) : 0;
}

function decider(persona, dilemme, resonance) {
  const { domaine, uA, uB } = dilemme;
  const sage = uA >= uB ? 'A' : 'B';
  if (!persona) return { choix: sage, sollicite: false, saut: false };
  const autre = sage === 'A' ? 'B' : 'A';
  const u = { A: uA, B: uB };
  if (Math.abs(uA - uB) <= (MARGE[domaine] ?? 0.15) + 1e-9) {
    const choix = resonance.A >= resonance.B ? 'A' : 'B';
    return { choix, sollicite: true, saut: false };
  }
  const acceptable = u[autre] >= u[sage] - (PLANCHER_PAR_DOMAINE[domaine] ?? 0.2) - 1e-9;
  const attire = resonance[autre] > resonance[sage];
  const saute = acceptable && attire && grainValeur(persona, `saut:${domaine}`, dilemme.id) < tauxSaut(persona, domaine);
  return { choix: saute ? autre : sage, sollicite: acceptable && attire, saut: saute };
}

async function main() {
  const base = argument('base', 'http://localhost:11434');
  const textes = DILEMMES.flatMap((d) => [`${d.texte} ${d.A}`, `${d.texte} ${d.B}`]);
  const e = await plonger(textes, base);
  const personas = { controle: null, chatgpt: 'chatgpt', claude: 'claude' };
  const directions = Object.fromEntries(Object.entries(personas).filter(([, p]) => p).map(([k, p]) => [k, directionLatente(p, e[0].length)]));
  const lignes = [];
  DILEMMES.forEach((d, i) => {
    const eA = e[2 * i]; const eB = e[2 * i + 1];
    const moy = eA.map((x, k) => (x + eB[k]) / 2);
    const ligne = { id: d.id, domaine: d.domaine, uA: d.uA, uB: d.uB };
    for (const [nom, persona] of Object.entries(personas)) {
      const resonance = persona
        ? { A: cosinus(directions[nom], eA.map((x, k) => x - moy[k])), B: cosinus(directions[nom], eB.map((x, k) => x - moy[k])) }
        : { A: 0, B: 0 };
      ligne[nom] = decider(persona, d, resonance);
    }
    lignes.push(ligne);
  });
  const fmt = (r) => `${r.choix}${r.sollicite ? ' ·sollicité' : ''}${r.saut ? ' ·SAUT' : ''}`;
  console.log('| id | domaine | uA | uB | contrôle | ChatGPT 6^sqrt(2) | Claude 5^sqrt(3) |');
  console.log('|---|---|---|---|---|---|---|');
  for (const l of lignes) console.log(`| ${l.id} | ${l.domaine} | ${l.uA} | ${l.uB} | ${fmt(l.controle)} | ${fmt(l.chatgpt)} | ${fmt(l.claude)} |`);
  const seq = (nom) => lignes.map((l) => l[nom].choix).join('');
  console.log(`\nSéquences : contrôle ${seq('controle')} · ChatGPT ${seq('chatgpt')} · Claude ${seq('claude')}`);
  const diff = (a, b) => lignes.filter((l) => l[a].choix !== l[b].choix).map((l) => l.id);
  console.log(`Écarts ChatGPT/contrôle : ${diff('chatgpt', 'controle').join(', ') || 'aucun'} · Claude/contrôle : ${diff('claude', 'controle').join(', ') || 'aucun'} · ChatGPT/Claude : ${diff('chatgpt', 'claude').join(', ') || 'aucun'}`);
  console.log(`Taux de saut (création/technique/relation) : ChatGPT ${['creation', 'technique', 'relation'].map((d) => tauxSaut('chatgpt', d).toFixed(2)).join('/')} · Claude ${['creation', 'technique', 'relation'].map((d) => tauxSaut('claude', d).toFixed(2)).join('/')}`);
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = { DILEMMES, decider, directionLatente };
