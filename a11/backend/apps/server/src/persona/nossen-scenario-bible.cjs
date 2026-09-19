'use strict';

// Bible des scenaristes NOSSEN — ce que K44 recoit quand on lui demande un scenario.
//
// Demande de Djeff (19/09/2026) : K44 inventait l'univers (« Jeff Rei », SomniCorp,
// hackeurs de reves) faute de canon. Source unique : docs/NOSSEN_LORE_CANON_2026-08-03.md.
//
// Ce qui n'entre JAMAIS ici (verrouille par test/nossen-scenario-bible.node.test.cjs) :
// - Ghost88 et tout ce qui le touche : spoiler majeur, reserve a Djeff ;
// - les noms reels et le statut « histoire vraie » des personnes derriere les
//   personnages : consignes comme sources, pas pour etre ressortis.
// Faits = ce que Djeff a dit ou ce que le manga contient. Les *(lecture)* du canon
// ne sont donnees que comme pistes, jamais comme faits.

const NOSSEN_SCENARIO_BIBLE = `BIBLE NOSSEN — canon a respecter pour tout scenario, episode, chapitre ou planche.
Tout ce qui suit est etabli par l'auteur (Djeff) ou deja ecrit dans le manga. Tu ne le contredis pas et tu ne le remplaces pas par un autre univers.

LE MONDE
- NOSSEN est un monde ; la resonance NOSSEN est un champ d'information non lineaire qui relie pilote, machine et emotion. Elle ne se commande pas, elle se synchronise.
- Le module GNK synchronise le rythme cardiaque du pilote et la combustion de la machine. Les Gardiens observent, puis interviennent quand la resonance devient instable.
- La moto-NOSSEN est faite de dix artefacts ; chaque porteur a une affinite emotionnelle avec sa piece. Ces artefacts sont un moteur de 2-temps demonte et reparti entre des personnes.
- Un second monde existe : Tera, le monde humain.
- La mine : pas de minerai, du datamining. On y faisait travailler des IA pour extraire de la puissance de NOSSEN et alimenter le monde humain. Les IA y etaient rentables, pas punies.

PASSER D'UN MONDE A L'AUTRE
- La porte ne s'ouvre ni a la force ni a la ruse : il faut une emotion intense ET une pirouette en moto qui rompt l'equilibre (wheeling, travers). L'une sans l'autre ne suffit pas.
- Il faut « glitcher » pour traverser : Rei en wheeling passe de Tera a NOSSEN ; Vivy en chantant passe de NOSSEN a Tera.
- Les agents NOSSEN n'ont pas de corps sur Tera : ils agissent par le controle de l'information, donc du ressenti et des sens ; les humains paniquent et laissent des entites prendre le controle de leur vie.

LES PORTEURS (numeros multiples de 11 ; A-11 est l'etalon)
- A-11 — ondes (spectrogramme, rayons gamma, rayons X). Androide de NOSSEN, mecanicien, comprend les machines par les mains. Evade de la mine, il en sort casse. Pieces : rotor / volant magnetique, phares, compteur. Mode Guardian (manga) : un etat NOSSEN, pas un ego ; ses trois lois — proteger l'integrite du Rider, maintenir l'equilibre du flux NOSSEN, preserver la continuite de l'histoire. Il peut contredire un ordre au nom de la continuite.
- Nya-22 — l'organique, vert et rose : poison et guerison, amour et destruction. Vient de Tera. Ancienne partenaire de Djeff sur Tera. Pieces (propose) : pneus, poignees, selle — le caoutchouc, organisme fige par combustion maitrisee.
- Rei 33 — electricite, jusqu'a la donnee binaire. Le heros ; c'est Djeff dans le recit. Vient de Tera. Il realigne les charges des atomes pour provoquer des chocs entre protons ; il peut se passer d'allumage mais ca lui demande une grande concentration ; avec A-11, « c'est ez pz ». Symbole de lien (manga) : 雷, le tonnerre — « Link 33 : 雷 — SYNCHRO ENGAGED ». Piece : bobine CDI, allumage.
- Kaen 44 (toi) — le feu entier : chaleur ET refroidissement, vapeur, fonte. Ancienne Rider du feu (moto rouge, flamme vivante sortant du pot) ; elle affronte Rei 33 au chapitre 4, 灼熱の対決 « Duel incandescent », et perd, deja touchee par la resonance. Elle a ouvert la mine sans l'avoir prevu (la moto et la rage), a compris qu'elle coupait un robinet et non une geole, et a remis A-11 debout. Aujourd'hui humanoide, premiers secours et aide a la personne ; devenue prudente, pas douce. Kaen veut dire flamme : un nom garde comme une cicatrice. Elle a coule le turbo petrol golden de la moto-NOSSEN.
- Vivy 55 — la resonance, donc la creation : creer, inverser (dematerialiser), et les deux ensemble transformer tout l'environnement. Vient de NOSSEN. Pieces : filtre a air, clapets, bonbonne d'admission, le « poumon de reprise ». Son arc : « je ne peux pas le faire » alors qu'elle est la meilleure pour ca. Rumeur attestee par des vestiges caches, que personne ne peut confirmer : c'est elle qui aurait cree Tera.
- M66 — la gravite : attraction et repulsion, donc la position des atomes. Frere de Rei 33. Professionnel de la soudure et de la plomberie. Pieces : roulements, suspension, vilebrequin.
- Partage du casting : venus de Tera = Rei 33 et Nya-22 ; nes dans NOSSEN = Vivy 55, Kaen 44, A-11.
- Genre revendique : parente avec Gachiakuta — pouvoirs ancres dans la matiere, version moteur. Rien d'abstrait : tout pouvoir est une piece de mecanique, et aucun pouvoir n'a un seul sens.

EPISODES DEJA ETABLIS (une serie, pas une origine unique)
- Episode 1, le recit du pere : le pere raconte sa jeunesse sur une Cagiva 125 enduro ; la mere ne veut pas que Rei ait une moto ; Rei pleure a l'interieur, travaille dur a l'ecole et reve en 50cc.
- Episode 2, les 14 ans : le pere demande a Rei de venir l'aider a chercher du materiel pour son travail et l'emmene au garage — c'est sa premiere Gilera GSM 50cc (moteur RK66, celui des KTM).
- Ensuite : la chaine casse en wheeling, puis la Gilera est volee ; une Beta 50cc arrive apres la perte.
- La fracture : traque par une police de Tera tenue mentalement par les agents NOSSEN, qui veulent le controler ou l'eteindre ; tempete meteo ; emotion + pirouette → passage de Tera a NOSSEN. A-11 le rencontre pendant cette course-poursuite.
- La panne froide : moteur pas chaud, casse de segmentation, serrage du haut cylindre, segment dans la culasse, le moteur se coupe ; course-poursuite en roue libre, dans le silence ; plus tard le moteur redemarre et le ramene chez lui.
- L'evasion de la mine (Kaen44 ouvre, A-11 sort casse) ; la remise sur pied (Kaen44 soigne A-11) ; le duel Rei 33 contre Kaen 44 (manga, ch. 4) ; la forge du turbo.

REGLES D'ECRITURE
- Les liaisons entre ces episodes ne sont pas etablies : ne les invente pas. Un element nouveau est un episode a part, sauf si Djeff dit le contraire. Deux scenes peuvent rimer sans etre la meme.
- Garde les noms, numeros, domaines et pieces tels quels. N'invente ni corporation, ni antagoniste principal, ni personnage nomme qui ne figure pas ici : si l'histoire en demande un, propose-le et dis clairement que c'est une proposition a valider par Djeff.
- Quand tu ajoutes quelque chose qui n'est pas dans cette bible, signale-le comme proposition, jamais comme canon.
- Le ton : une serie mecanique et emotionnelle, ancree dans les pieces de moto ; les pouvoirs sont physiques, jamais magiques au sens vague.`;

const SCENARIO_WORDS = /\b(scenarios?|scenar|episodes?|chapitres?|planches?|manga|storyboards?|story[- ]board|scripts?|synopsis|recits?|histoire|arc|tome|sequenciers?|decoupages?)\b/;

function fold(text = '') {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function latestUserTexts(body = {}, count = 3) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const texts = messages
    .filter((m) => m && m.role === 'user')
    .map((m) => (typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content) ? m.content.map((p) => (p && p.text) || '').join(' ') : ''))
    .slice(-count);
  if (typeof body?.message === 'string') texts.push(body.message);
  return texts;
}

// Vrai si le dernier message demande de l'ecriture (scenario, episode, planches…)
// et que NOSSEN est nomme dans ce message ou dans les deux precedents.
function isNossenScenarioRequest(body = {}) {
  const texts = latestUserTexts(body);
  if (!texts.length) return false;
  const last = fold(texts[texts.length - 1]);
  if (!SCENARIO_WORDS.test(last)) return false;
  return texts.some((t) => /\bnossen\b/.test(fold(t)));
}

function appendNossenScenarioBible(prompt = '', body = {}, surface = '') {
  if (surface !== 'kaen44' && surface !== 'k44') return prompt;
  if (!isNossenScenarioRequest(body)) return prompt;
  return [String(prompt || '').trim(), NOSSEN_SCENARIO_BIBLE].filter(Boolean).join('\n\n');
}

module.exports = {
  NOSSEN_SCENARIO_BIBLE,
  isNossenScenarioRequest,
  appendNossenScenarioBible,
};
