const test = require('node:test');
const assert = require('node:assert/strict');

const {
  scoreImageCandidate,
  selectBestImageCandidate,
} = require('../lib/image-search.cjs');

test('scoreImageCandidate heavily penalizes coloring-page and lineart sources', () => {
  const scored = scoreImageCandidate({
    image_url: 'https://coloriage.info/images/zelda-coloring.jpg',
    source_url: 'https://coloriage.info/zelda-coloriage',
    title: 'Princesse Zelda coloring page line art',
    width: 1001,
    height: 1200,
  }, 'Princess Zelda character art');

  assert.match(String(scored.selection_reason || ''), /lineart_penalty/i);
  assert.match(String(scored.selection_reason || ''), /coloring_domain_penalty/i);
  assert.ok(Number(scored.selection_score) < 0);
});

test('selectBestImageCandidate prefers character art over coloring-page lookalikes', () => {
  const selected = selectBestImageCandidate([
    {
      image: 'https://coloriage.info/images/zelda-coloring.jpg',
      url: 'https://coloriage.info/zelda-coloriage',
      title: 'Princesse Zelda coloring page line art',
      width: 1001,
      height: 1200,
    },
    {
      image: 'https://images.example.com/zelda-character-art.jpg',
      url: 'https://example.com/zelda-character-art',
      title: 'Princess Zelda official character art illustration',
      width: 1200,
      height: 1600,
    },
  ], 'Princess Zelda character art');

  assert.equal(selected.source_domain, 'example.com');
  assert.match(String(selected.title || ''), /character art/i);
});

test('selectBestImageCandidate strongly downranks poster and collage results for solo reference queries', () => {
  const selected = selectBestImageCandidate([
    {
      image: 'https://yourartpath.com/wp-content/uploads/2018/05/Harry-Potter-2.png',
      url: 'https://yourartpath.com/legend-of-zelda-fan-art',
      title: 'The Legend of Zelda fan art poster all characters collage',
      width: 1200,
      height: 900,
    },
    {
      image: 'https://images.example.com/zelda-solo-art.jpg',
      url: 'https://example.com/zelda-solo-art',
      title: 'Princess Zelda solo character art illustration',
      width: 1200,
      height: 1600,
    },
  ], 'Princess Zelda solo character art');

  assert.equal(selected.source_domain, 'example.com');
  assert.match(String(selected.selection_reason || ''), /solo_subject_bias/i);
});

test('scoreImageCandidate heavily penalizes 3d-model marketplace results', () => {
  const scored = scoreImageCandidate({
    image_url: 'https://files.cults3d.com/uploaders/24667956/illustration-file/1bb5d1ea-cc55-4d4b-967d-478350f9c570/2-Linkle.jpg',
    source_url: 'https://cults3d.com/fr/modele-3d/jeu/the-legend-of-zelda-princesa-zelda-arquera',
    title: 'Fichier STL La Legende de Zelda - Princesse Zelda Archer - Modele 3D',
    width: 709,
    height: 791,
  }, 'Princesse Zelda archer pose full body character art', {
    subject: 'Princesse Zelda',
  });

  assert.match(String(scored.selection_reason || ''), /model3d_penalty/i);
  assert.ok(Number(scored.selection_score) < 10);
});

test('selectBestImageCandidate prefers exact subject matches over franchise-near misses', () => {
  const selected = selectBestImageCandidate([
    {
      image: 'https://i.pinimg.com/originals/a2/84/c0/a284c0b1d7a5f5867fddf62b61656fc0.jpg',
      url: 'https://www.pinterest.fr/pin/archer-queen-clashofclan--312015080415037631/',
      title: 'Archer Queen (ClashOfClan) | Archer queen, Clash royale, Queen anime',
      width: 774,
      height: 1032,
    },
    {
      image: 'https://images.example.com/princess-zelda-archer.jpg',
      url: 'https://example.com/princess-zelda-archer',
      title: 'Princesse Zelda Archer full body character art',
      width: 751,
      height: 1063,
    },
  ], 'Princesse Zelda archer pose full body character art', {
    subject: 'Princesse Zelda',
  });

  assert.equal(selected.source_domain, 'example.com');
  assert.match(String(selected.selection_reason || ''), /full_subject_match/i);
});

test('selectBestImageCandidate does not let generic pose words outrank the actual Mario subject', () => {
  const selected = selectBestImageCandidate([
    {
      image: 'https://images.example.com/historical-rider.jpg',
      url: 'https://example.org/historical-rider',
      title: 'Historical rider full body pose illustration with horse',
      width: 1200,
      height: 1600,
    },
    {
      image: 'https://images.example.com/mario-full-body-art.jpg',
      url: 'https://example.com/mario-full-body-art',
      title: 'Super Mario Nintendo full body character art',
      width: 1200,
      height: 1600,
    },
  ], 'Mario Nintendo full body pose character art', {
    subject: 'Mario',
  });

  assert.equal(selected.source_domain, 'example.com');
  assert.match(String(selected.title || ''), /super mario/i);
});

test('scoreImageCandidate heavily penalizes birthday-card celebrity pages for character lookups', () => {
  const scored = scoreImageCandidate({
    image_url: 'https://mail.anniversaire-celebrite.com/upload/250x333/princesse-zelda-250.jpg',
    source_url: 'https://mail.anniversaire-celebrite.com/celebrite/princesse-zelda',
    title: 'Princesse Zelda a 39 ans, anniversaire le 21 fevrier',
    width: 250,
    height: 333,
  }, 'Princesse Zelda Nintendo full body character art', {
    subject: 'Princesse Zelda',
    universe: 'Nintendo',
  });

  assert.match(String(scored.selection_reason || ''), /birthday_card_penalty/i);
  assert.match(String(scored.selection_reason || ''), /small_image_penalty/i);
  assert.ok(Number(scored.selection_score) < 0);
});
