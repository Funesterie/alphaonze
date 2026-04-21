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

  assert.match(String(plan.prompt || ''), /stable base structure: mario/i);
  assert.match(String(plan.prompt || ''), /weight on the left leg/i);
  assert.match(String(plan.prompt_2 || ''), /stable scene and composition:/i);
  assert.match(String(plan.prompt_2 || ''), /in front of a castle/i);
  assert.match(String(plan.prompt_2 || ''), /keep same face, same outfit, same background/i);
  assert.doesNotMatch(String(plan.prompt || ''), /\bpoids\b|\bjambe\b|\bpied\b/i);
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
  assert.match(String(plan.prompt_2 || ''), /stable scene and composition:/i);
  assert.doesNotMatch(String(plan.prompt_2 || ''), /Rester cohérent avec l univers/i);
  assert.doesNotMatch(String(plan.prompt_2 || ''), /illustration fantasy nette/i);
  assert.doesNotMatch(String(plan.prompt_2 || ''), /sujet unique bien cadré/i);
  assert.doesNotMatch(String(plan.prompt_2 || ''), /sans texte lisible/i);
  assert.doesNotMatch(String(plan.prompt_2 || ''), /\bforet\b|\bsentier\b/i);
});
