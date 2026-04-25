const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFramePromptPlan,
} = require('../src/video/video-sequence-translator.cjs');

test('buildFramePromptPlan preserves early subject identity cues from the compiled base prompt', () => {
  const plan = buildFramePromptPlan(
    'mario marchant devant un chateau, Représenter clairement Mario, un seul personnage moustachu de jeu vidéo, reconnaissable et complet, illustration de jeu vidéo nette, chateau, sujet unique bien cadré',
    {
      sequencePlan: {
        motionProfile: 'walk_cycle',
      },
      beat: {
        label: 'appui gauche',
        variation: 'poids sur la jambe gauche, pied droit commence a quitter le sol',
      },
    }
  );

  assert.match(String(plan.prompt || ''), /main subject pose continuity: mario/i);
  assert.match(String(plan.prompt || ''), /weight on the left leg/i);
  assert.match(String(plan.prompt_2 || ''), /scene camera decor continuity:/i);
  assert.match(String(plan.prompt_2 || ''), /in front of a castle/i);
  assert.match(String(plan.prompt_2 || ''), /keep same face, same outfit, same background/i);
  assert.doesNotMatch(String(plan.prompt || ''), /\bpoids\b|\bjambe\b|\bpied\b/i);
  assert.doesNotMatch(String(plan.prompt || ''), /stable base structure|base structure stable/i);
  assert.doesNotMatch(String(plan.prompt_2 || ''), /Représenter clairement|reconnaissable et complet|decor et composition stables/i);
});

test('buildFramePromptPlan keeps true Zelda scene locks and filters instruction-style fragments', () => {
  const plan = buildFramePromptPlan(
    'Princesse Zelda marchant sur un sentier dans la foret, Représenter clairement le personnage nommé Zelda, une seule femme héroïne fantasy complète et reconnaissable, Rester cohérent avec l univers The Legend Of Zelda, illustration fantasy nette, foret, sujet unique bien cadré, sans texte lisible',
    {
      sequencePlan: {
        motionProfile: 'walk_cycle',
      },
      beat: {
        label: 'appui gauche',
        variation: 'poids sur la jambe gauche, pied droit commence a quitter le sol',
      },
    }
  );

  assert.match(String(plan.prompt_2 || ''), /on a path in the forest/i);
  assert.match(String(plan.prompt_2 || ''), /scene camera decor continuity:/i);
  assert.doesNotMatch(String(plan.prompt_2 || ''), /Rester cohérent avec l univers/i);
  assert.doesNotMatch(String(plan.prompt_2 || ''), /illustration fantasy nette/i);
  assert.doesNotMatch(String(plan.prompt_2 || ''), /sujet unique bien cadré/i);
  assert.doesNotMatch(String(plan.prompt_2 || ''), /sans texte lisible/i);
  assert.doesNotMatch(String(plan.prompt_2 || ''), /\bforet\b|\bsentier\b/i);
});

test('buildFramePromptPlan keeps knight and golden sword on the main layer and organizes SD3 prompt bands cleanly', () => {
  const plan = buildFramePromptPlan(
    'the knight in dark armor bends toward the golden sword inside a torch-lit stone hall',
    {
      sequencePlan: {
        motionProfile: 'action_burst',
        canonicalSubject: 'the knight in dark armor',
        sceneContext: 'low angle camera inside a torch-lit stone hall',
        identityLocks: ['same knight', 'same golden sword', 'same dark armor'],
        continuityLocks: ['same torch-lit stone hall', 'same low angle camera'],
      },
      beat: {
        label: 'reach',
        structuralState: 'The knight in dark armor leans toward the golden sword with one gauntleted hand reaching for the hilt',
        variation: 'structure bends lower toward the golden sword as the blade catches warm light',
        soundCue: 'metal clang',
        rendererFocus: ['golden sword hilt clearly visible', 'dark gauntlet near the blade'],
      },
    }
  );

  assert.match(String(plan.prompt || ''), /main subject pose continuity:/i);
  assert.match(String(plan.prompt || ''), /knight in dark armor/i);
  assert.match(String(plan.prompt || ''), /golden sword/i);
  assert.match(String(plan.prompt_2 || ''), /scene camera decor continuity:/i);
  assert.match(String(plan.prompt_2 || ''), /torch-lit stone hall/i);
  assert.match(String(plan.prompt_2 || ''), /same dark armor/i);
  assert.match(String(plan.prompt_2 || ''), /same golden sword/i);
  assert.match(String(plan.prompt_3 || ''), /visible frame delta anatomy prop detail:/i);
  assert.match(String(plan.prompt_3 || ''), /golden sword hilt clearly visible/i);
  assert.match(String(plan.prompt_3 || ''), /dark gauntlet near the blade/i);
  assert.match(String(plan.prompt_3 || ''), /clear anatomy:/i);
  assert.doesNotMatch(String(plan.prompt || ''), /\bstructure\b/i);
  assert.doesNotMatch(String(plan.prompt_2 || ''), /\bstable scene and composition\b|\bdecor et composition stables\b/i);
  assert.doesNotMatch(String(plan.prompt_3 || ''), /\bvisual checkpoint of this frame\b|\bvisible change in this frame\b/i);
  assert.doesNotMatch(String(plan.prompt_3 || ''), /\bclang\b/i);
});

test('buildFramePromptPlan normalizes mixed French-English frame fragments into clean English layers', () => {
  const plan = buildFramePromptPlan(
    'goku se transformant en super saiyan divin, fond simple',
    {
      sequencePlan: {
        motionProfile: 'transformation_rise',
        canonicalSubject: 'goku',
        sceneContext: 'anime combat illustration with a simple background',
        identityLocks: ['same face', 'same outfit', 'same silhouette'],
      },
      beat: {
        label: 'lift',
        variation: 'goku raises both arms while cheveux se dressent davantage and first glow of energy becomes visible',
        rendererFocus: ['tenue orange et bleue lisible'],
      },
    }
  );

  assert.match(String(plan.prompt || ''), /goku/i);
  assert.match(String(plan.prompt_2 || ''), /anime combat illustration/i);
  assert.match(String(plan.prompt_3 || ''), /hair rises further|hair rises/i);
  assert.match(String(plan.prompt_3 || ''), /first glow of energy/i);
  assert.match(String(plan.prompt_3 || ''), /readable orange and blue outfit/i);
  assert.doesNotMatch(String(plan.prompt || ''), /\bcheveux\b|\btenue\b|\bfond\b/i);
  assert.doesNotMatch(String(plan.prompt_2 || ''), /\bmeme\b|\bvisage\b|\btenue\b/i);
  assert.doesNotMatch(String(plan.prompt_3 || ''), /\bcheveux\b|\btenue\b/i);
});

test('buildFramePromptPlan derives an English subject anchor from a French compiled prompt before SD layers are built', () => {
  const plan = buildFramePromptPlan(
    'mario heroique sur un sentier fantastique',
    {
      sequencePlan: {
        motionProfile: 'walk_cycle',
      },
      beat: {
        label: 'depart neutre',
        variation: 'poids reparti sur les deux jambes, posture neutre de marche',
      },
    }
  );

  assert.match(String(plan.prompt || ''), /main subject pose continuity: mario/i);
  assert.match(String(plan.prompt_2 || ''), /fantasy path|on a path/i);
  assert.doesNotMatch(String(plan.prompt || ''), /\bheroique\b|\bsentier\b|\bfantastique\b|\bsur\b/i);
  assert.doesNotMatch(String(plan.prompt_2 || ''), /\bsentier\b|\bfantastique\b|\bsur\b/i);
});
