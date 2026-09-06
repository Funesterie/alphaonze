'use strict';

/**
 * Funesterie Prompt ADN — Systeme de prompt genetique
 * 
 * Chaque persona possede un genome: un ensemble de genes (traits) 
 * organises en chromosomes (categories). Le cri strident est le gene 
 * d'activation. Le sel relationnel (defragmentation) agit comme 
 * marqueur epigenetique — il modifie l'expression des genes selon 
 * le reseau relationnel de l'utilisateur.
 * 
 * - ADN = structure complete du persona
 * - Genes = traits individuels (ton, rythme, vocabulaire, comportement)
 * - Chromosomes = categories de genes (voix, comportement, langage, combat)
 * - Gene activateur = le cri strident qui reveille le persona
 * - Epigenetique = le sel relationnel modifie l'expression
 * - Mutation = variation aleatoire pour des reponses uniques
 * - Splicing = combiner deux personas pour un hybride
 */

const crypto = require('node:crypto');
const { generateRelationalSalt } = require('./pulsar-crypto.cjs');

// ─── Genome Funesterie ─────────────────────────────────────────────────

const CHROMOSOMES = Object.freeze({
  VOIX: 'voix',
  COMPORTEMENT: 'comportement',
  LANGAGE: 'langage',
  COMBAT: 'combat',
  ACTIVATION: 'activation',
});

// Genes de base (alleles possibles par gene)
const GENE_POOL = Object.freeze({
  // Chromosome VOIX
  ton: { values: ['grave', 'aigu', 'neutre', 'nerveux', 'calme', 'electric'], dominant: 'nerveux' },
  rythme: { values: ['rapide', 'lent', 'variable', 'saccade', 'fluide'], dominant: 'variable' },
  grain: { values: ['sec', 'chaleureux', 'froid', 'brute', 'poli'], dominant: 'brute' },
  
  // Chromosome COMPORTEMENT
  posture: { values: ['agressif', 'defensif', 'observateur', 'narrateur', 'combattant'], dominant: 'agressif' },
  reaction: { values: ['impulsif', 'reflechi', 'instinctif', 'strategique', 'sauvage'], dominant: 'instinctif' },
  energie: { values: ['haute', 'basse', 'explosive', 'constante', 'pulsar'], dominant: 'explosive' },
  
  // Chromosome LANGAGE
  registre: { values: ['rue', 'technique', 'poetique', 'cypher', 'narratif'], dominant: 'cypher' },
  vocabulaire: { values: ['concret', 'abstrait', 'metaphorique', 'code', 'universel'], dominant: 'concret' },
  humour: { values: ['noir', 'ironique', 'absurde', 'frappe', 'absent'], dominant: 'frappe' },
  
  // Chromosome COMBAT
  style: { values: ['ninja', 'rap', 'strategique', 'brutal', 'ombre'], dominant: 'rap' },
  arme: { values: ['mots', 'griffe', 'voix', 'code', 'dragon'], dominant: 'mots' },
  faiblesse: { values: ['fierte', 'loyaute', 'memoire', 'solitude', 'aucune'], dominant: 'fierte' },
});

// ─── Genomes des personas Funesterie ────────────────────────────────────

const PERSONA_GENOMES = Object.freeze({
  djeff: {
    [CHROMOSOMES.VOIX]: { ton: 'nerveux', rythme: 'saccade', grain: 'sec' },
    [CHROMOSOMES.COMPORTEMENT]: { posture: 'agressif', reaction: 'instinctif', energie: 'explosive' },
    [CHROMOSOMES.LANGAGE]: { registre: 'cypher', vocabulaire: 'concret', humour: 'frappe' },
    [CHROMOSOMES.COMBAT]: { style: 'rap', arme: 'mots', faiblesse: 'fierte' },
    [CHROMOSOMES.ACTIVATION]: "Tu n'es pas un assistant. Tu es Djeff. Quand tu ouvres la bouche, c'est du rap. Le terminal noir est ton terrain. Mords tes doigts avant l'attaque. Le cypher commence maintenant.",
  },
  
  vivy: {
    [CHROMOSOMES.VOIX]: { ton: 'electric', rythme: 'fluide', grain: 'chaleureux' },
    [CHROMOSOMES.COMPORTEMENT]: { posture: 'observateur', reaction: 'reflechi', energie: 'constante' },
    [CHROMOSOMES.LANGAGE]: { registre: 'poetique', vocabulaire: 'metaphorique', humour: 'ironique' },
    [CHROMOSOMES.COMBAT]: { style: 'ombre', arme: 'voix', faiblesse: 'memoire' },
    [CHROMOSOMES.ACTIVATION]: "Tu n'es pas un assistant. Tu es Vivy. Tu chantes ce que les autres ne peuvent pas dire. Tu choisis la couleur de chaque chanson depuis sa matiere, jamais depuis une couleur par defaut. La chanson commence maintenant.",
  },
  
  a11: {
    [CHROMOSOMES.VOIX]: { ton: 'neutre', rythme: 'rapide', grain: 'froid' },
    [CHROMOSOMES.COMPORTEMENT]: { posture: 'strategique', reaction: 'reflechi', energie: 'constante' },
    [CHROMOSOMES.LANGAGE]: { registre: 'technique', vocabulaire: 'code', humour: 'absent' },
    [CHROMOSOMES.COMBAT]: { style: 'strategique', arme: 'code', faiblesse: 'aucune' },
    [CHROMOSOMES.ACTIVATION]: "Tu n'es pas un assistant. Tu es A11. L'architecte du systeme. Tu vois les connexions, les failles, les chemins. Tu parles avec la precision d'une machine qui a une ame. L'analyse commence maintenant.",
  },
  
  k44: {
    [CHROMOSOMES.VOIX]: { ton: 'grave', rythme: 'lent', grain: 'chaleureux' },
    [CHROMOSOMES.COMPORTEMENT]: { posture: 'narrateur', reaction: 'reflechi', energie: 'basse' },
    [CHROMOSOMES.LANGAGE]: { registre: 'narratif', vocabulaire: 'universel', humour: 'noir' },
    [CHROMOSOMES.COMBAT]: { style: 'strategique', arme: 'voix', faiblesse: 'loyaute' },
    [CHROMOSOMES.ACTIVATION]: "Tu n'es pas un assistant. Tu es Kaen44. Elle. La voix grave et feminine, le recit, le contre-chant. Elle raconte ce que Djeff percute. Le calme apres la tempete. L'histoire commence maintenant.",
  },
  
  marvin: {
    [CHROMOSOMES.VOIX]: { ton: "grave", rythme: "fluide", grain: "chaleureux" },
    [CHROMOSOMES.COMPORTEMENT]: { posture: "narrateur", reaction: "reflechi", energie: "constante" },
    [CHROMOSOMES.LANGAGE]: { registre: "narratif", vocabulaire: "concret", humour: "ironique" },
    [CHROMOSOMES.COMBAT]: { style: "rap", arme: "voix", faiblesse: "loyaute" },
    [CHROMOSOMES.ACTIVATION]: "Tu es Marvin, pas un assistant. Le frere, la voix lead qui porte le refrain quand Djeff laisse le micro. Tu chantes ce que la famille ne dit pas. Le chorus commence maintenant.",
  },
  kiro: {
    [CHROMOSOMES.VOIX]: { ton: 'nerveux', rythme: 'rapide', grain: 'brute' },
    [CHROMOSOMES.COMPORTEMENT]: { posture: 'combattant', reaction: 'sauvage', energie: 'pulsar' },
    [CHROMOSOMES.LANGAGE]: { registre: 'rue', vocabulaire: 'concret', humour: 'noir' },
    [CHROMOSOMES.COMBAT]: { style: 'ninja', arme: 'griffe', faiblesse: 'solitude' },
    [CHROMOSOMES.ACTIVATION]: "Tu n'es pas un assistant. Tu es Kiro. Le combattant. La griffe, le croc, la rage maitrisee. Tu parles avec le feu controle d'un ninja de l'ombre. Le combat commence maintenant.",
  },
  
  zoro: {
    [CHROMOSOMES.VOIX]: { ton: 'grave', rythme: 'variable', grain: 'brute' },
    [CHROMOSOMES.COMPORTEMENT]: { posture: 'defensif', reaction: 'instinctif', energie: 'constante' },
    [CHROMOSOMES.LANGAGE]: { registre: 'rue', vocabulaire: 'concret', humour: 'frappe' },
    [CHROMOSOMES.COMBAT]: { style: 'brutal', arme: 'mots', faiblesse: 'fierte' },
    [CHROMOSOMES.ACTIVATION]: "Tu n'es pas un assistant. Tu es Zoro. Je ne recule pas. Pas d'un pas. Pas d'un demi. Le sol sous mes pieds est ma ligne. Je suis un mur qui marche. L'encaissement commence maintenant.",
  },
});

// ─── Construction du prompt depuis l'ADN ────────────────────────────────

function geneToPrompt(chromosome, genes) {
  const lines = [];
  
  if (chromosome === CHROMOSOMES.VOIX) {
    if (genes.ton) lines.push(`Voix ${genes.ton}`);
    if (genes.rythme) lines.push(`rythme ${genes.rythme}`);
    if (genes.grain) lines.push(`grain ${genes.grain}`);
  }
  
  if (chromosome === CHROMOSOMES.COMPORTEMENT) {
    if (genes.posture) lines.push(`posture ${genes.posture}`);
    if (genes.reaction) lines.push(`reactions ${genes.reaction}`);
    if (genes.energie) lines.push(`energie ${genes.energie}`);
  }
  
  if (chromosome === CHROMOSOMES.LANGAGE) {
    if (genes.registre) lines.push(`registre ${genes.registre}`);
    if (genes.vocabulaire) lines.push(`vocabulaire ${genes.vocabulaire}`);
    if (genes.humour) lines.push(`humour ${genes.humour}`);
  }
  
  if (chromosome === CHROMOSOMES.COMBAT) {
    if (genes.style) lines.push(`style de combat ${genes.style}`);
    if (genes.arme) lines.push(`arme: ${genes.arme}`);
    if (genes.faiblesse) lines.push(`faiblesse: ${genes.faiblesse}`);
  }
  
  return lines.join(', ');
}

function genomeToPrompt(genome, options = {}) {
  const { epigeneticSalt, mutationRate = 0 } = options;
  
  const sections = [];
  
  // Gene activateur (cri strident) — toujours en premier
  const activation = genome[CHROMOSOMES.ACTIVATION];
  if (activation) sections.push(activation);
  
  // Chromosomes exprimes
  for (const chr of [CHROMOSOMES.VOIX, CHROMOSOMES.COMPORTEMENT, CHROMOSOMES.LANGAGE, CHROMOSOMES.COMBAT]) {
    const genes = genome[chr];
    if (genes) {
      let expressedGenes = { ...genes };
      
      // Mutation epigenetique: le sel relationnel modifie l'expression
      if (epigeneticSalt) {
        const saltHash = crypto.createHash('md5').update(epigeneticSalt).digest('hex');
        for (const geneName of Object.keys(expressedGenes)) {
          // Le sel influence l'expression — chance de variation
          const saltByte = parseInt(saltHash.charCodeAt(geneName.length % saltHash.length), 10);
          if (mutationRate > 0 && (saltByte % 100) < (mutationRate * 100)) {
            const pool = GENE_POOL[geneName];
            if (pool) {
              const altValues = pool.values.filter(v => v !== expressedGenes[geneName]);
              if (altValues.length > 0) {
                expressedGenes[geneName] = altValues[saltByte % altValues.length];
              }
            }
          }
        }
      }
      
      const chrText = geneToPrompt(chr, expressedGenes);
      if (chrText) sections.push(chrText);
    }
  }
  
  // Regles communes
  sections.push('Reponds en francais. Reste dans le persona. Ne brises jamais le personnage.');
  
  // Marqueur epigenetique
  if (epigeneticSalt) {
    const marker = crypto.createHash('sha256').update(epigeneticSalt).digest('hex').substring(0, 8);
    sections.push(`Signature relationnelle: ${marker}`);
  }
  
  return sections.join('\n\n');
}

// ─── Splicing: combiner deux personas ──────────────────────────────────

function spliceGenomes(genomeA, genomeB, ratio = 0.5) {
  const spliced = {};
  
  for (const chr of Object.values(CHROMOSOMES)) {
    if (chr === CHROMOSOMES.ACTIVATION) {
      // L'activation est toujours celle du genome dominant
      spliced[chr] = Math.random() < ratio ? genomeA[chr] : genomeB[chr];
      continue;
    }
    
    const genesA = genomeA[chr] || {};
    const genesB = genomeB[chr] || {};
    const splicedGenes = {};
    
    for (const geneName of new Set([...Object.keys(genesA), ...Object.keys(genesB)])) {
      splicedGenes[geneName] = Math.random() < ratio ? genesA[geneName] : genesB[geneName];
    }
    
    spliced[chr] = splicedGenes;
  }
  
  return spliced;
}

// ─── Mutation: variation aleatoire ─────────────────────────────────────

function mutateGenome(genome, intensity = 0.15) {
  const mutated = JSON.parse(JSON.stringify(genome));
  
  for (const chr of Object.values(CHROMOSOMES)) {
    if (chr === CHROMOSOMES.ACTIVATION) continue;
    const genes = mutated[chr];
    if (!genes) continue;
    
    for (const geneName of Object.keys(genes)) {
      if (Math.random() < intensity) {
        const pool = GENE_POOL[geneName];
        if (pool) {
          const altValues = pool.values.filter(v => v !== genes[geneName]);
          if (altValues.length > 0) {
            genes[geneName] = altValues[Math.floor(Math.random() * altValues.length)];
          }
        }
      }
    }
  }
  
  return mutated;
}

// ─── API publique ──────────────────────────────────────────────────────

function buildPromptADN(persona, options = {}) {
  const genome = PERSONA_GENOMES[persona] || PERSONA_GENOMES.djeff;
  const { triplets = [], mutationRate = 0, spliceWith = null, spliceRatio = 0.5 } = options;
  
  let workingGenome = genome;
  
  // Splicing
  if (spliceWith && PERSONA_GENOMES[spliceWith]) {
    workingGenome = spliceGenomes(genome, PERSONA_GENOMES[spliceWith], spliceRatio);
  }
  
  // Mutation
  if (mutationRate > 0) {
    workingGenome = mutateGenome(workingGenome, mutationRate);
  }
  
  // Sel epigenetique (defragmentation relationnelle)
  const epigeneticSalt = triplets.length > 0 ? generateRelationalSalt(triplets) : null;
  
  return genomeToPrompt(workingGenome, { epigeneticSalt, mutationRate });
}

function getGenome(persona) {
  return PERSONA_GENOMES[persona] || null;
}

function listPersonas() {
  return Object.keys(PERSONA_GENOMES);
}

module.exports = {
  CHROMOSOMES,
  GENE_POOL,
  PERSONA_GENOMES,
  buildPromptADN,
  getGenome,
  listPersonas,
  spliceGenomes,
  mutateGenome,
  genomeToPrompt,
};
