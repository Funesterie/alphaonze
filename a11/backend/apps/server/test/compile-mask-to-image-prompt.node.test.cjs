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

test('compileMaskToImagePrompt defers english localization for image runtime prompts when requested', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'utilise ma photo comme reference et transforme moi en joker cinematographique',
    compiler: {
      target: 'image-prompt-en',
      version: '1.0',
    },
    inputs: {
      subject: ['portrait homme'],
      environment: ['decor sombre'],
      style: ['haute qualité'],
      composition: ['portrait propre'],
      lighting: [],
      palette: [],
    },
    meta: {
      deferEnglishPromptLocalization: true,
      webImageDraft: {
        initImageUrl: 'https://images.example.com/portrait-ref.png',
      },
      subjectProfile: {
        type: 'single_human_figure',
      },
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.equal(compiled.prompt_language, 'fr');
  assert.match(String(compiled.prompt || ''), /joker cinematographique/i);
  assert.match(String(compiled.prompt || ''), /decor sombre/i);
  assert.match(String(compiled.prompt || ''), /garder exactement le même visage, la même structure faciale et la même identité/i);
  assert.match(String(compiled.prompt || ''), /garder les mêmes yeux, les mêmes sourcils, le même nez, la même mâchoire et le même sourire/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /the same person from the reference image|cinematic joker/i);
});

test('compileMaskToImagePrompt rebuilds canonical image prompts from english structured fields only', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'Utilise l image de reference et transforme la personne en joker avec maquillage inquietant.',
    compiler: {
      target: 'image-prompt-en',
      version: '1.0',
    },
    inputs: {
      subject: ['placeholder sujet'],
      environment: ['decor pollue'],
      style: ['style pollue'],
      composition: ['composition polluee'],
      lighting: [],
      palette: [],
    },
    meta: {
      originalSourceText: 'Texte brut français qui ne doit plus servir au prompt final.',
      sourceText: 'Autre texte français interdit.',
      promptSeedText: 'Encore du français brut.',
      promptText: 'Toujours du français brut.',
      webImageDraft: {
        initImageUrl: 'https://images.example.com/joker-ref.png',
      },
      subjectProfile: {
        type: 'single_human_figure',
      },
      promptInstructions: [
        'preserve the body angle, arm placement, same-side hand laterality, and visible hand pose from the reference image',
      ],
      imageReferenceManifests: [
        {
          image_id: 'ref-1',
          detected_content: 'same man holding a bat over the shoulders with a wrapped left hand',
          probable_role: 'identity',
          confidence: 0.91,
          quality_flags: ['screenshot_ui', 'crop_needed'],
        },
      ],
      imageReferenceDecision: {
        primaryImageId: 'ref-1',
        primaryRole: 'identity',
        primaryConfidence: 0.91,
        clarificationRequired: false,
        clarificationQuestion: '',
        conflicts: [],
      },
      canonicalizedRequest: {
        canonicalEnglishInput: 'Use the input image as an identity, pose, and framing reference. Transform the person into a dark cinematic Joker-inspired character with the same face, the same build, and a visible custom bat in a Harlem-inspired street.',
        structuredFields: {
          subject: ['dark cinematic Joker-inspired character'],
          environment: ['Harlem-inspired street with graffiti and worn building textures'],
          style: ['realistic live-action noir comic-book portrait'],
          composition: ['full body visible', 'custom decorated bat clearly visible'],
          lighting: ['dramatic lighting', 'neon reflections'],
          palette: ['purple', 'green', 'dirty red'],
          constraints: {
            promptInstructions: [
              'preserve the same recognizable face, build, posture, and overall presence from the reference image',
              'keep the background secondary but immersive',
            ],
            negativeHints: ['blurry face', 'bad hands'],
            noText: true,
            safeMode: true,
          },
        },
        scenePolicy: {
          subjectMode: 'single',
          explicitSubjectCount: 1,
        },
        audit: {
          rawUserInput: 'Utilise l image de reference et transforme la personne en joker avec maquillage inquietant.',
        },
      },
      promptNegativeHints: ['visage deformé'],
      negativeHints: ['decor vide'],
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  const prompt = String(compiled.prompt || '');
  const singleSubjectCount = (prompt.match(/single clearly visible main subject/gi) || []).length;
  const fullBodyCount = (prompt.match(/full body visible/gi) || []).length;

  assert.equal(compiled.prompt_language, 'en');
  assert.match(prompt, /^the exact same person from the reference image in a Joker-style transformation/i);
  assert.match(prompt, /keep exactly the same face, facial structure, and identity/i);
  assert.match(prompt, /keep the same eyes, eyebrows, nose, jawline, and smile from the reference image/i);
  assert.match(prompt, /preserve the body angle, arm placement, same-side hand laterality, and visible hand pose from the reference image/i);
  assert.match(prompt, /preserve these distinctive visible cues from the reference image: same man holding a bat over the shoulders with a wrapped hand on the same side as in the reference image/i);
  assert.match(prompt, /same recognizable face/i);
  assert.match(prompt, /Harlem-inspired street/i);
  assert.match(prompt, /custom decorated bat clearly visible/i);
  assert.ok(prompt.indexOf('keep exactly the same face, facial structure, and identity') > prompt.indexOf('Joker-style transformation'));
  assert.ok(prompt.indexOf('preserve the pose and framing from the reference image') > prompt.indexOf('keep the same eyes, eyebrows, nose, jawline, and smile from the reference image'));
  assert.ok(prompt.indexOf('custom decorated bat clearly visible') > prompt.indexOf('preserve the body angle, arm placement, same-side hand laterality, and visible hand pose from the reference image'));
  assert.ok(prompt.indexOf('Harlem-inspired street') > prompt.indexOf('custom decorated bat clearly visible'));
  assert.ok(prompt.indexOf('realistic live-action noir comic-book portrait') > prompt.indexOf('Harlem-inspired street'));
  assert.equal(singleSubjectCount, 1);
  assert.equal(fullBodyCount, 1);
  assert.match(String(compiled.negative_prompt || ''), /blurry face/i);
  assert.match(String(compiled.negative_prompt || ''), /bad hands/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /joker-inspired character/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\b(?:utilise|transforme|personne|maquillage|decor|lumiere)\b/i);
  assert.doesNotMatch(String(compiled.negative_prompt || ''), /\b(?:visage|decor)\b/i);
});

test('compileMaskToImagePrompt preserves long rich reference prompts instead of collapsing to a minimal subject', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'Utilise l image d entree comme reference d identite, de pose et de cadrage. Transforme la personne en personnage inspire du Joker, dans un style sombre, cinematographique et realiste, tout en conservant un visage reconnaissable, la meme structure faciale, la meme corpulence, la meme posture et la meme presence generale. Remplace la batte en bois par une batte custom menaceante et theatrale, et transforme le decor en rue brute inspiree de Harlem avec graffitis, immeubles uses, sol sale, reflets de neons et lumiere dramatique.',
    compiler: {
      target: 'image-prompt-en',
      version: '1.0',
    },
    inputs: {
      subject: ['portrait homme'],
      environment: ['decor urbain inspire de Harlem', 'rue brute avec graffitis', 'immeubles uses'],
      style: ['portrait live action sombre et credible', 'cinematographique', 'haute qualité'],
      composition: ['personnage entier visible', 'batte custom clairement visible', 'composition propre'],
      lighting: ['lumiere dramatique', 'reflets de neons violets et verts'],
      palette: ['violet', 'vert', 'rouge'],
    },
    meta: {
      deferEnglishPromptLocalization: true,
      webImageDraft: {
        initImageUrl: 'https://images.example.com/joker-ref.png',
      },
      subjectProfile: {
        type: 'single_human_figure',
      },
      promptInstructions: [
        'costume joker elegant mais chaotique',
        'maquillage de clown inquietant mais credible',
        'la batte custom doit etre bien visible',
        'le decor doit rester secondaire mais immersif',
      ],
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.equal(compiled.prompt_language, 'fr');
  assert.ok(String(compiled.prompt || '').length >= 320);
  assert.match(String(compiled.prompt || ''), /joker/i);
  assert.match(String(compiled.prompt || ''), /Harlem/i);
  assert.match(String(compiled.prompt || ''), /batte custom/i);
  assert.match(String(compiled.prompt || ''), /préserver la pose et le cadrage de l image de référence/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /^portrait homme$/i);
});

test('compileMaskToImagePrompt promotes the canonical Zelda subject in the prompt lead', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image de zelda marchant sur un sentier dans la foret',
    inputs: {
      subject: ['Princesse Zelda'],
      environment: ['foret', 'sentier'],
      style: ['illustration fantasy nette'],
      composition: ['un seul personnage complet'],
      lighting: [],
      palette: [],
    },
    meta: {
      canonicalSubject: 'Princesse Zelda',
      subjectProfile: {
        type: 'reference_character',
        canonicalSubject: 'Princesse Zelda',
      },
      imageEntityContext: {
        canonicalSubject: 'Princesse Zelda',
        aliases: ['Zelda'],
      },
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /Princesse Zelda marchant sur un sentier dans la foret/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /^zelda marchant/i);
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

test('compileMaskToImagePrompt strips placeholder source-file wording from init-image style prompts', () => {
  const compiled = compileMaskToImagePrompt({
    raw: "Créer une image épique de 'contenu du fichier' dans un style Dragon Ball Z",
    inputs: {
      subject: ['sujet de référence'],
      environment: ['décor cohérent avec le sujet décrit'],
      style: ['style dragonball z', 'photorealiste'],
      composition: ['sujet unique bien cadré', 'silhouette lisible'],
      lighting: [],
      palette: [],
    },
    meta: {
      webImageDraft: {
        initImageUrl: 'http://127.0.0.1:3000/files/runtime/files/uploads/demo.png',
        fromChatSourceImage: true,
      },
      subjectProfile: {
        type: 'single_human_figure',
      },
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /style dragonball z/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /contenu du fichier/i);
  assert.match(String(compiled.negative_prompt || ''), /capture d écran|interface mobile/i);
  assert.match(String(compiled.negative_prompt || ''), /texte incrusté|date incrustée/i);
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

test('compileMaskToImagePrompt strips video phrasing and promotes reference-character identity hints', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une video de mario marchant devant un chateau',
    inputs: {
      subject: ['Mario'],
      environment: ['chateau'],
      style: ['illustration de jeu vidéo nette', 'illustration nette'],
      composition: ['sujet unique bien cadré', 'silhouette lisible'],
      lighting: [],
      palette: [],
    },
    meta: {
      subjectProfile: {
        type: 'reference_character',
        promptInstruction: 'Représenter clairement Mario, un seul personnage moustachu de jeu vidéo, reconnaissable et complet.',
      },
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.doesNotMatch(String(compiled.prompt || ''), /\bune video de\b/i);
  assert.match(String(compiled.prompt || ''), /^mario marchant devant un chateau/i);
  assert.match(String(compiled.prompt || ''), /mario, un seul personnage moustachu de jeu vidéo|personnage moustachu de jeu vidéo/i);
  assert.match(String(compiled.prompt || ''), /illustration de jeu vidéo nette/i);
});

test('compileMaskToImagePrompt removes solo framing constraints for versus prompts', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image de goku faisant un kamehameha contre broly',
    inputs: {
      subject: ['Goku', 'Broly'],
      environment: ['energie bleue dramatique'],
      style: ['illustration nette', 'haute qualité'],
      composition: ['sujet unique bien cadré', 'silhouette lisible', 'corps entier dans le cadre'],
      lighting: [],
      palette: [],
    },
    meta: {
      subjectProfile: {
        type: 'reference_character',
      },
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /goku faisant un kamehameha contre broly/i);
  assert.match(String(compiled.prompt || ''), /deux sujets distincts et lisibles/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /sujet unique bien cadré/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /un seul sujet principal/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /corps entier dans le cadre/i);
  assert.match(String(compiled.negative_prompt || ''), /fusion des personnages|clone du premier sujet/i);
});

test('compileMaskToImagePrompt removes solo framing constraints for named group scenes', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image des Mugiwaras',
    inputs: {
      subject: ['Mugiwaras'],
      environment: ['fond simple cohérent avec le personnage'],
      style: ['illustration nette', 'haute qualité'],
      composition: ['sujet unique bien cadré', 'silhouette lisible', 'forme complète visible'],
      lighting: [],
      palette: [],
    },
    meta: {
      subjectProfile: {
        type: 'reference_character',
      },
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /mugiwaras/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /sujet unique bien cadré/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /silhouette lisible/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /forme complète visible/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /un seul sujet principal/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /personnage complet et reconnaissable/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /corps entier dans le cadre/i);
});

test('compileMaskToImagePrompt filters negative imperative prompt instructions from the positive prompt', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image de lapin blanc',
    inputs: {
      subject: ['lapin blanc'],
      environment: ['décor naturel simple'],
      style: ['haute qualité'],
      composition: ['un seul animal complet'],
      lighting: [],
      palette: [],
    },
    meta: {
      promptInstructions: [
        'Ne pas ajouter de foule derrière le sujet.',
        'Montrer clairement le sujet principal avec une pose simple.',
      ],
      subjectProfile: {
        type: 'single_animal',
      },
    },
    constraints: {
      no_text: true,
    },
    options: {},
  });

  assert.match(String(compiled.prompt || ''), /lapin blanc/i);
  assert.match(String(compiled.prompt || ''), /Montrer clairement le sujet principal avec une pose simple/i);
  assert.doesNotMatch(String(compiled.prompt || ''), /\bNe pas ajouter de foule\b/i);
});

test('compileMaskToImagePrompt normalizes invalid numeric options to safe defaults', () => {
  const compiled = compileMaskToImagePrompt({
    raw: 'genere une image de renard',
    inputs: {
      subject: ['renard'],
      environment: [],
      style: ['haute qualité'],
      composition: [],
      lighting: [],
      palette: [],
    },
    constraints: {
      no_text: true,
    },
    options: {
      width: -32,
      height: '999999',
      steps: 'abc',
      guidance_scale: -4,
      seed: 'not-a-number',
    },
  });

  assert.equal(compiled.width, 64);
  assert.equal(compiled.height, 4096);
  assert.equal(compiled.num_inference_steps, 40);
  assert.equal(compiled.guidance_scale, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(compiled, 'seed'), false);
});
