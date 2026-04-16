const test = require('node:test');
const assert = require('node:assert/strict');

const compileMaskToImagePrompt = require('../src/mask/compile-mask-to-image-prompt.cjs');

test('compileMaskToImagePrompt keeps french prompts free of imperative negative instructions', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image d un pokemon dragon feu',
    inputs: {
      subject: ['pokemon dragon feu'],
      environment: [],
      style: ['haute qualité'],
      composition: ['silhouette lisible', 'effets lumineux bien séparés du sujet'],
      lighting: [],
      palette: ['orange', 'red'],
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /pokemon dragon feu/i);
  assert.match(String(compiled.prompt || ''), /silhouette lisible/i);
  assert.match(String(compiled.prompt || ''), /effets lumineux bien séparés du sujet/i);
  assert.match(String(compiled.prompt || ''), /un seul sujet principal/i);
  assert.match(String(compiled.negative_prompt || ''), /plusieurs sujets/i);
  assert.match(String(compiled.negative_prompt || ''), /watermark/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\bNe pas\b/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\bdo not\b/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /pas au fond|pas au background|not to the background/i);
});

test('compileMaskToImagePrompt stays simple and keeps user wording for soda cans', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image d une canette de soda',
    inputs: {
      subject: ['canette de soda'],
      environment: [],
      style: ['haute qualité'],
      composition: [],
      lighting: [],
      palette: [],
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /canette de soda/i);
  assert.match(String(compiled.negative_prompt || ''), /objets multiples/i);
  assert.match(String(compiled.negative_prompt || ''), /décor encombré|arrière-plan chargé/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /aluminium|silhouette cylindrique/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\bNe pas\b/i);
});

test('compileMaskToImagePrompt includes positive profile instructions for single reference characters', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image de gohan',
    inputs: {
      subject: ['gohan'],
      environment: ['fond simple cohérent avec le personnage'],
      style: ['illustration nette', 'haute qualité'],
      composition: ['un seul personnage complet', 'visage unique bien lisible'],
      lighting: [],
      palette: [],
    },
    meta: {
      subjectProfile: {
        type: 'reference_character',
        promptInstruction: 'Représenter un seul personnage complet et reconnaissable.',
      },
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /fond simple cohérent avec le personnage/i);
  assert.match(String(compiled.prompt || ''), /personnage complet et reconnaissable/i);
  assert.match(String(compiled.negative_prompt || ''), /plusieurs sujets/i);
  assert.match(String(compiled.negative_prompt || ''), /visages dupliqués/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\bNe pas\b/i);
});

test('compileMaskToImagePrompt keeps explicit named reference character cues for bugs bunny like prompts', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image de bugsbunny avec une cigarette',
    inputs: {
      subject: ['Bugs Bunny'],
      environment: ['fond simple cohérent avec le personnage'],
      style: ['dessin animé classique', 'illustration nette', 'haute qualité'],
      composition: ['un seul personnage complet', 'visage unique bien lisible'],
      lighting: [],
      palette: [],
    },
    meta: {
      subjectProfile: {
        type: 'reference_character',
        promptInstruction: 'Représenter un seul personnage de lapin de dessin animé gris et blanc, avec de longues oreilles et un visage reconnaissable.',
      },
      promptInstructions: [
        'Inclure clairement une cigarette avec le sujet principal.',
      ],
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /bugsbunny avec une cigarette/i);
  assert.match(String(compiled.prompt || ''), /dessin animé classique/i);
  assert.match(String(compiled.prompt || ''), /personnage complet et reconnaissable/i);
  assert.match(String(compiled.prompt || ''), /sans texte lisible/i);
});

test('compileMaskToImagePrompt keeps explicit named reference character cues for zelda like prompts', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image de zelda',
    inputs: {
      subject: ['Princesse Zelda'],
      environment: ['fond simple cohérent avec le personnage'],
      style: ['illustration fantasy nette', 'illustration nette', 'haute qualité'],
      composition: ['un seul personnage complet', 'visage unique bien lisible'],
      lighting: [],
      palette: [],
    },
    meta: {
      subjectProfile: {
        type: 'reference_character',
        promptInstruction: 'Représenter clairement le personnage nommé Zelda, une seule femme héroïne fantasy complète et reconnaissable.',
      },
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /\bzelda\b/i);
  assert.match(String(compiled.prompt || ''), /illustration fantasy nette/i);
  assert.match(String(compiled.prompt || ''), /personnage complet et reconnaissable/i);
  assert.match(String(compiled.prompt || ''), /corps entier dans le cadre/i);
  assert.match(String(compiled.negative_prompt || ''), /hors cadre/i);
  assert.match(String(compiled.negative_prompt || ''), /gros plan|plan poitrine/i);
});

test('compileMaskToImagePrompt includes single human instructions for warrior prompts', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'génère une image de guerriere nordique',
    inputs: {
      subject: ['guerriere nordique'],
      environment: ['fond simple cohérent avec le personnage'],
      style: ['illustration nette', 'haute qualité'],
      composition: ['une seule personne complète', 'visage unique bien lisible', 'silhouette humaine complète'],
      lighting: [],
      palette: [],
    },
    meta: {
      subjectProfile: {
        type: 'single_human_figure',
        promptInstruction: 'Représenter une seule personne complète et reconnaissable.',
      },
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /personnage complet et reconnaissable/i);
  assert.match(String(compiled.negative_prompt || ''), /plusieurs sujets/i);
  assert.match(String(compiled.negative_prompt || ''), /visages dupliqués/i);
});

test('compileMaskToImagePrompt includes extra prompt instructions for elemental creatures', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une photo d un phoenix glacé',
    inputs: {
      subject: ['phoenix glacé'],
      environment: ['atmosphère froide et cristalline'],
      style: ['photorealiste', 'textures cristallines', 'haute qualité'],
      composition: ['un seul phénix complet', 'ailes bien lisibles', 'givre visible sur le sujet'],
      lighting: [],
      palette: [],
    },
    meta: {
      subjectProfile: {
        type: 'phoenix_creature',
        promptInstruction: 'Représenter un seul phénix complet avec des ailes bien lisibles.',
      },
      promptInstructions: [
        'Montrer clairement la matière glacée sur le sujet.',
        'Représenter un phénix de glace avec des ailes claires, complètes et bien visibles.',
      ],
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /photorealiste/i);
  assert.match(String(compiled.prompt || ''), /textures cristallines/i);
  assert.match(String(compiled.prompt || ''), /phoenix glacé/i);
  assert.match(String(compiled.negative_prompt || ''), /créatures multiples|animaux multiples/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\bNe pas\b/i);
});

test('compileMaskToImagePrompt hardens fire instructions for animate subjects', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image de cheval en feu',
    inputs: {
      subject: ['cheval'],
      environment: ['décor naturel simple'],
      style: ['haute qualité', 'énergie chaude lisible'],
      composition: ['un seul animal complet', 'silhouette lisible', 'flammes lisibles autour du sujet'],
      lighting: [],
      palette: ['feu'],
    },
    meta: {
      subjectProfile: {
        type: 'single_animal',
      },
      semantic: {
        elements: [{ label: 'feu', family: 'fire' }],
      },
      promptInstructions: [
        'Montrer clairement le feu autour du sujet sans le rendre confus.',
      ],
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /flammes lisibles autour du sujet|flammes nettes autour du sujet/i);
  assert.match(String(compiled.prompt || ''), /créature complète et lisible/i);
});

test('compileMaskToImagePrompt hardens phoenix prompts against flowers and duplicated anatomy', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image de phoenix violet',
    inputs: {
      subject: ['phoenix violet'],
      environment: ['ciel simple avec profondeur'],
      style: ['haute qualité'],
      composition: ['un seul phénix complet', 'ailes bien lisibles', 'silhouette majestueuse'],
      lighting: [],
      palette: ['violet'],
    },
    meta: {
      subjectProfile: {
        type: 'phoenix_creature',
        promptInstruction: 'Représenter un seul phénix complet, clairement comme un oiseau mythique unique, avec une seule tête, une seule paire d ailes et des plumes bien lisibles.',
      },
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /phoenix violet/i);
  assert.match(String(compiled.prompt || ''), /ailes bien lisibles/i);
  assert.match(String(compiled.prompt || ''), /créature complète et lisible/i);
  assert.match(String(compiled.negative_prompt || ''), /plusieurs têtes/i);
  assert.match(String(compiled.negative_prompt || ''), /ailes supplémentaires|ailes dupliquées/i);
  assert.match(String(compiled.negative_prompt || ''), /forme de fleur|pétales|bouquet/i);
});

test('compileMaskToImagePrompt keeps single plant prompts constrained to one visible plant', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image de sapin blanc en hiver',
    inputs: {
      subject: ['sapin'],
      environment: ['hiver', 'décor naturel simple'],
      style: ['haute qualité'],
      composition: ['une seule plante complète', 'forme complète visible', 'sujet centré'],
      lighting: [],
      palette: ['blanc'],
    },
    meta: {
      subjectProfile: {
        type: 'single_plant_object',
        promptInstruction: 'Montrer une seule plante ou un seul arbre complet, bien lisible et centré.',
      },
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /sapin blanc en hiver/i);
  assert.match(String(compiled.prompt || ''), /une seule plante complète/i);
  assert.match(String(compiled.negative_prompt || ''), /plusieurs plantes/i);
});

test('compileMaskToImagePrompt keeps smoking prompts explicit and positive', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image de pikachu fumant une cigarette',
    inputs: {
      subject: ['pikachu'],
      environment: ['fond simple cohérent avec le personnage'],
      style: ['illustration nette', 'haute qualité'],
      composition: ['un seul personnage complet', 'cigarette bien visible près de la bouche'],
      lighting: [],
      palette: [],
    },
    meta: {
      subjectProfile: {
        type: 'reference_character',
        promptInstruction: 'Représenter un seul personnage complet et reconnaissable.',
      },
      promptInstructions: [
        'Montrer clairement le sujet principal en train de fumer avec cigarette visible près de la bouche.',
      ],
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /pikachu fumant une cigarette/i);
  assert.match(String(compiled.prompt || ''), /cigarette bien visible près de la/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\bNe pas\b/i);
});

test('compileMaskToImagePrompt keeps accessory instructions as positive subject details', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image d un lapin avec une carotte dans la bouche',
    inputs: {
      subject: ['lapin'],
      environment: ['décor naturel simple'],
      style: ['haute qualité'],
      composition: ['un seul animal complet', 'corps complet bien visible'],
      lighting: [],
      palette: [],
    },
    meta: {
      subjectProfile: {
        type: 'single_animal',
        promptInstruction: 'Montrer un seul animal complet et bien lisible.',
      },
      promptInstructions: [
        'Montrer clairement une carotte dans la bouche du sujet principal.',
      ],
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /lapin avec une carotte dans la bouche/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /Environnement : dans la bouche/i);
});

test('compileMaskToImagePrompt keeps relational pair prompts explicit for role plus patient scenes', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image de mario docteur avec un patient skeletrex',
    inputs: {
      subject: ['Mario'],
      environment: ['cabinet médical simple'],
      style: ['illustration nette', 'haute qualité'],
      composition: ['deux sujets distincts et lisibles'],
      lighting: [],
      palette: [],
    },
    meta: {
      subjectProfile: {
        type: 'reference_character',
        promptInstruction: 'Représenter clairement Mario, un seul personnage moustachu de jeu vidéo, reconnaissable et complet.',
      },
      promptInstructions: [
        'Montrer clairement Mario en docteur avec un patient skeletrex distinct et lisible.',
      ],
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /mario docteur avec un patient skeletrex/i);
  assert.match(String(compiled.prompt || ''), /deux sujets distincts et lisibles/i);
  assert.match(String(compiled.negative_prompt || ''), /clone du premier sujet|dupliquer le premier personnage/i);
});
