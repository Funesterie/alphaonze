const VALID_VIDEO_MOTION_PROFILES = Object.freeze([
  'walk_cycle',
  'run_cycle',
  'power_up_loop',
  'transformation_rise',
  'mounted_archery',
  'archery_shot',
  'action_burst',
  'dance_cycle',
  'gesture_loop',
  'subtle_loop',
  'generic',
]);

function normalizeVideoLookup(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeFramePromptFragment(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[,.;:\s]+|[,.;:\s]+$/g, '')
    .trim();
}

function normalizePromptList(values = [], { unique = true } = {}) {
  const items = Array.isArray(values) ? values : [values];
  const normalized = [];
  const seen = new Set();
  for (const entry of items) {
    const value = normalizeFramePromptFragment(entry);
    if (!value) continue;
    const key = normalizeVideoLookup(value);
    if (unique && key && seen.has(key)) continue;
    if (unique && key) seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

function extractStoryboardPromptFragments(value = '') {
  return String(value || '')
    .replace(/[.]+$/g, '')
    .split(',')
    .map((fragment) => String(fragment || '').trim())
    .filter(Boolean);
}

function normalizeSequenceBeat(beat = {}, fallbackLabel = 'continuite') {
  const variation = normalizeFramePromptFragment(
    beat?.variation !== undefined
      ? beat.variation
      : beat?.prompt
  );
  const structuralState = normalizeFramePromptFragment(
    beat?.structuralState !== undefined
      ? beat.structuralState
      : ''
  );
  return {
    label: String(beat?.label || fallbackLabel).trim() || fallbackLabel,
    structuralState,
    variation,
    checkpoint: Boolean(beat?.checkpoint),
    rendererFocus: normalizePromptList(beat?.rendererFocus || []),
    soundCue: normalizeFramePromptFragment(
      beat?.soundCue !== undefined
        ? beat.soundCue
        : beat?.sound_cue
    ),
    soundCues: normalizePromptList([
      ...(Array.isArray(beat?.soundCues) ? beat.soundCues : []),
      ...(Array.isArray(beat?.sound_cues) ? beat.sound_cues : []),
      beat?.soundCue,
      beat?.sound_cue,
    ]),
    continuityLock: normalizeFramePromptFragment(
      beat?.continuityLock !== undefined
        ? beat.continuityLock
        : beat?.continuity_lock
    ),
    continuityLocks: normalizePromptList([
      ...(Array.isArray(beat?.continuityLocks) ? beat.continuityLocks : []),
      ...(Array.isArray(beat?.continuity_locks) ? beat.continuity_locks : []),
      beat?.continuityLock,
      beat?.continuity_lock,
    ]),
    sceneContext: normalizeFramePromptFragment(beat?.sceneContext || beat?.scene_context || ''),
  };
}

function extractBasePromptFragments(basePrompt = '') {
  return String(basePrompt || '')
    .split(/[,.]/)
    .map((fragment) => normalizeFramePromptFragment(fragment))
    .filter(Boolean);
}

function isStoryboardMetaFragment(fragment = '') {
  const lookup = normalizeVideoLookup(fragment);
  if (!lookup) return false;
  return /\b(frame|video|animation|sequence|storyboard|methode|method|continuite|continuity|smooth motion|same main subject|same subject|consistent|cinematic continuity|opening motion|ending motion|mid motion|palier|prochaine frame|preparer la prochaine frame|priorite|faire evoluer|garder visage|camera fixe|pas de rotation|rotation de camera|no camera rotation)\b/.test(lookup);
}

function resolveStoryboardDynamicFragmentRegex(motionProfile = 'generic') {
  switch (String(motionProfile || 'generic').trim() || 'generic') {
    case 'walk_cycle':
      return /\b(march|walk|avance|avanc|step|stride|pas|balancier)\b/;
    case 'run_cycle':
      return /\b(course|cour|run|sprint|dash|foulee|projection vers l avant)\b/;
    case 'power_up_loop':
      return /\b(aura|haki|energie|energy|ki|power up|powerup|poings? fermes?|poings? serres?|tension|charge)\b/;
    case 'transformation_rise':
      return /\b(transform|transformation|super saiyan|super sayan|ssj|aura|eclairs?|hair|cheveux|forme atteinte|forme stabilisee)\b/;
    case 'mounted_archery':
    case 'archery_shot':
      return /\b(arc|bow|fleche|arrow|tir|shot|corde|visee|traction|mise en joue)\b/;
    case 'action_burst':
      return /\b(kamehameha|hadouken|beam|blast|rayon|attaque|attack|combat|fight|impact|energie|energy|kick|punch|slash|frappe)\b/;
    case 'dance_cycle':
    case 'gesture_loop':
    case 'subtle_loop':
      return /\b(danse|dance|gesture|geste|smile|sourire|blink|cligne|nod|hoche|wave|salut)\b/;
    default:
      return /\b(mouvement|motion|action|attaque|attack|transform|transformation|walk|run|march|course|tir|shot|aura|energie|energy|combat|fight)\b/;
  }
}

function extractLeadSceneRelationFragment(basePrompt = '') {
  const head = normalizeFramePromptFragment(extractBasePromptFragments(basePrompt)[0] || '');
  if (!head) return '';
  const relationMatch = head.match(/\b(?:dans|sur|sous|devant|derriere|derrière|au bord de|au milieu de|pres de|près de)\b.+$/i);
  return normalizeFramePromptFragment(relationMatch?.[0] || '');
}

function isInstructionalStableFragment(fragment = '') {
  const lookup = normalizeVideoLookup(fragment);
  if (!lookup) return false;
  return /^(rester|representer|montrer|ajouter|inclure|conserver|garder|donner|faire)\b/.test(lookup)
    || /\b(sujet canonique|personnage nomme|univers|coherent avec l univers|coherent avec le personnage)\b/.test(lookup);
}

function isStyleStableFragment(fragment = '') {
  const lookup = normalizeVideoLookup(fragment);
  if (!lookup) return false;
  if (/\b(dans|sur|sous|devant|derriere|derrière|au bord de|au milieu de|pres de|près de)\b/.test(lookup)) {
    return false;
  }
  return /\b(illustration|anime|manga|render|portrait|photorealiste|photo realiste|haute qualite|qualite|nette|net|style|fantasy|heroique)\b/.test(lookup);
}

function isSubjectConstraintStableFragment(fragment = '') {
  const lookup = normalizeVideoLookup(fragment);
  if (!lookup) return false;
  return /\b(sujet unique bien cadre|silhouette lisible|forme complete visible|un seul sujet principal|personnage complet et reconnaissable|corps entier dans le cadre|un seul personnage complet|une seule personne complete|visage unique bien lisible|corps complet bien visible|creature complete et lisible|sans texte lisible)\b/.test(lookup);
}

function extractStableSceneFragments(basePrompt = '', motionProfile = 'generic') {
  const dynamicRegex = resolveStoryboardDynamicFragmentRegex(motionProfile);
  const unique = new Set();
  const fragments = [];

  const sourceFragments = [
    extractLeadSceneRelationFragment(basePrompt),
    ...extractBasePromptFragments(basePrompt).slice(1),
  ];

  for (const fragment of sourceFragments) {
    const normalized = normalizeVideoLookup(fragment);
    if (!normalized) continue;
    if (isStoryboardMetaFragment(fragment)) continue;
    if (dynamicRegex.test(normalized)) continue;
    if (isInstructionalStableFragment(fragment)) continue;
    if (isStyleStableFragment(fragment)) continue;
    if (isSubjectConstraintStableFragment(fragment)) continue;
    if (unique.has(normalized)) continue;
    if (fragments.some((entry) => {
      const existing = normalizeVideoLookup(entry);
      return existing && (existing.includes(normalized) || normalized.includes(existing));
    })) continue;
    unique.add(normalized);
    fragments.push(fragment);
    if (fragments.length >= 4) break;
  }

  return fragments;
}

function resolveDefaultIdentityLocks(motionProfile = 'generic', prompt = '') {
  const subjectType = detectSubjectType(prompt);
  switch (String(motionProfile || 'generic').trim() || 'generic') {
    case 'power_up_loop':
    case 'transformation_rise':
      return ['same face', 'same core identity', 'same silhouette'];
    case 'mounted_archery':
      return ['same rider', 'same horse', 'same saddle'];
    case 'archery_shot':
      return ['same face', 'same core identity', 'same shooting stance'];
    case 'walk_cycle':
    case 'run_cycle':
      if (subjectType === 'horse') return ['same pony', 'same rider', 'coherent environment'];
      if (subjectType === 'quadruped' || subjectType === 'dragon') return ['same animal', 'same silhouette', 'coherent environment'];
      return ['same face', 'same core identity', 'coherent environment'];
    default:
      return ['same core identity', 'same silhouette', 'coherent environment'];
  }
}

function buildSequenceTransitionBeat(fromBeat = {}, toBeat = {}) {
  const from = normalizeSequenceBeat(fromBeat, 'phase precedente');
  const to = normalizeSequenceBeat(toBeat, 'phase suivante');
  const fromFragments = extractStoryboardPromptFragments(from.variation || from.structuralState || '');
  const toFragments = extractStoryboardPromptFragments(to.variation || to.structuralState || '');
  const transitionParts = [];

  if (fromFragments.length) transitionParts.push(fromFragments[fromFragments.length - 1]);
  for (const fragment of toFragments.slice(0, 2)) {
    if (!transitionParts.includes(fragment)) transitionParts.push(fragment);
  }

  return normalizeSequenceBeat({
    label: `${from.label} vers ${to.label}`,
    structuralState: transitionParts.join(', ') || `${from.label}, ${to.label}`,
    variation: transitionParts.join(', ') || `${from.label}, ${to.label}`,
    rendererFocus: [...from.rendererFocus, ...to.rendererFocus],
  });
}

function densifySequenceBeats(beats = []) {
  const normalized = (Array.isArray(beats) ? beats : [])
    .map((beat) => normalizeSequenceBeat(beat))
    .filter((beat) => beat.variation || beat.structuralState);
  if (normalized.length <= 1) return normalized;

  const dense = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index];
    dense.push(current);
    if (index < normalized.length - 1) {
      dense.push(buildSequenceTransitionBeat(current, normalized[index + 1]));
    }
  }
  return dense;
}

function sampleSequenceBeats(beats = [], frameCount = 1) {
  const normalized = (Array.isArray(beats) ? beats : [])
    .map((beat) => normalizeSequenceBeat(beat))
    .filter((beat) => beat.variation || beat.structuralState);
  if (!normalized.length) return [];
  if (frameCount <= 1) return [normalized[0]];
  if (normalized.length === frameCount) return normalized.slice();

  const maxIndex = normalized.length - 1;
  const result = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const position = (frameIndex * maxIndex) / Math.max(frameCount - 1, 1);
    const selectedIndex = Math.max(0, Math.min(maxIndex, Math.floor(position)));
    result.push(normalized[selectedIndex]);
  }
  return result;
}

function resolveSequenceFrameBeats(beats = [], frameCount = 1) {
  let working = (Array.isArray(beats) ? beats : [])
    .map((beat) => normalizeSequenceBeat(beat))
    .filter((beat) => beat.variation || beat.structuralState);

  if (!working.length) {
    return Array.from({ length: Math.max(1, frameCount) }, () => normalizeSequenceBeat({
      label: 'continuite',
      variation: 'faire avancer la posture d une etape visible',
    }));
  }

  if (working.length < frameCount && working.length > 1) {
    const denser = densifySequenceBeats(working);
    if (denser.length > working.length) {
      working = denser;
    }
  }

  const sampled = sampleSequenceBeats(working, frameCount);
  while (sampled.length < frameCount) {
    sampled.push(sampled[sampled.length - 1]);
  }
  return sampled;
}

function detectSubjectType(prompt = '') {
  const lookup = normalizeVideoLookup(prompt);
  if (/\b(cheval|poney|pony|horse|jument|etalon|destrier|licorne|unicorn|pegase|pegasus|centaure|centaur|dragon|dinosaure|dinosaur|loup|wolf|lion|tigre|tiger|ours|bear|cerf|deer|elephant|girafe|giraffe|rhinoceros|hippopotame|crocodile|serpent|snake|aigle|eagle|faucon|falcon|chat|cat|chien|dog|renard|fox|lapin|rabbit|singe|monkey|gorille|gorilla)\b/.test(lookup)) {
    if (/\b(cheval|poney|pony|horse|jument|etalon|destrier|licorne|unicorn|pegase|pegasus)\b/.test(lookup)) return 'horse';
    if (/\b(dragon)\b/.test(lookup)) return 'dragon';
    if (/\b(chat|cat|chien|dog|loup|wolf|renard|fox|lapin|rabbit)\b/.test(lookup)) return 'small_animal';
    return 'quadruped';
  }
  return 'humanoid';
}

function buildHorseWalkCycleBeats(prompt = '') {
  const lookup = normalizeVideoLookup(prompt);
  const rider = /\b(zelda|link|cavalier|cavaliere|rider|monte|montee|sur un|sur le|sur la)\b/.test(lookup);
  const riderTail = rider ? ', cavalier bien en selle, posture du cavalier stable' : '';
  return [
    {
      label: 'depart neutre',
      variation: `poney en position de depart, quatre pattes au sol, poids equilibre${riderTail}`,
      rendererFocus: ['quatre pattes distinctes et lisibles', 'encolure et tete du poney visibles', 'silhouette complete du poney'],
    },
    {
      label: 'patte avant gauche levee',
      variation: `patte avant gauche du poney levee vers l avant, trois pattes au sol${riderTail}`,
      rendererFocus: ['patte avant gauche clairement levee', 'trois pattes en appui', 'mouvement de marche lisible'],
    },
    {
      label: 'appui avant gauche',
      variation: `patte avant gauche du poney pose devant, poids transfere vers l avant${riderTail}`,
      rendererFocus: ['patte avant gauche posee devant', 'transfert de poids visible', 'corps du poney en progression'],
    },
    {
      label: 'patte arriere droite levee',
      variation: `patte arriere droite du poney levee, cycle de marche continue${riderTail}`,
      rendererFocus: ['patte arriere droite levee', 'trois pattes en appui', 'progression du corps lisible'],
    },
    {
      label: 'patte avant droite levee',
      variation: `patte avant droite du poney levee vers l avant, marche continue${riderTail}`,
      rendererFocus: ['patte avant droite clairement levee', 'trois pattes en appui', 'balancier naturel du corps'],
    },
    {
      label: 'appui avant droit',
      variation: `patte avant droite du poney posee devant, poids transfere${riderTail}`,
      rendererFocus: ['patte avant droite posee devant', 'transfert de poids visible', 'corps en progression'],
    },
    {
      label: 'patte arriere gauche levee',
      variation: `patte arriere gauche du poney levee, cycle de marche continue${riderTail}`,
      rendererFocus: ['patte arriere gauche levee', 'trois pattes en appui', 'marche fluide et lisible'],
    },
    {
      label: 'sortie de marche',
      variation: `poney en marche stable, quatre pattes lisibles, progression continue${riderTail}`,
      rendererFocus: ['quatre pattes distinctes', 'silhouette complete du poney', 'marche naturelle et fluide'],
    },
  ];
}

function buildQuadrupedWalkCycleBeats(prompt = '') {
  return [
    { label: 'depart neutre', variation: 'animal en position de depart, quatre pattes au sol, poids equilibre', rendererFocus: ['quatre pattes distinctes et lisibles', 'silhouette complete de l animal'] },
    { label: 'patte avant gauche levee', variation: 'patte avant gauche levee vers l avant, trois pattes au sol', rendererFocus: ['patte avant gauche clairement levee', 'trois pattes en appui'] },
    { label: 'appui avant gauche', variation: 'patte avant gauche posee devant, poids transfere vers l avant', rendererFocus: ['patte avant gauche posee devant', 'transfert de poids visible'] },
    { label: 'patte arriere droite levee', variation: 'patte arriere droite levee, cycle de marche continue', rendererFocus: ['patte arriere droite levee', 'trois pattes en appui'] },
    { label: 'patte avant droite levee', variation: 'patte avant droite levee vers l avant, marche continue', rendererFocus: ['patte avant droite clairement levee', 'trois pattes en appui'] },
    { label: 'appui avant droit', variation: 'patte avant droite posee devant, poids transfere', rendererFocus: ['patte avant droite posee devant', 'transfert de poids visible'] },
    { label: 'patte arriere gauche levee', variation: 'patte arriere gauche levee, cycle de marche continue', rendererFocus: ['patte arriere gauche levee', 'trois pattes en appui'] },
    { label: 'sortie de marche', variation: 'animal en marche stable, quatre pattes lisibles, progression continue', rendererFocus: ['quatre pattes distinctes', 'silhouette complete de l animal', 'marche naturelle'] },
  ];
}
function buildGenericStoryboardBeats() {
  return [
    { label: 'depart stable', variation: 'posture de depart stable, appuis nets, geste encore contenu' },
    { label: 'engagement', variation: 'debut du geste, un appui change clairement, le buste commence a suivre' },
    { label: 'transfert', variation: 'transfert de poids visible, geste plus ouvert, silhouette toujours claire' },
    { label: 'point fort', variation: 'point fort du geste ou de la posture, action lisible sans changer toute la scene' },
    { label: 'sortie stable', variation: 'sortie du geste, posture stabilisee apres l action' },
  ];
}

function buildWalkCycleStoryboardBeats() {
  return [
    {
      label: 'depart neutre',
      variation: 'posture neutre de marche, poids reparti sur les deux jambes, depart pret',
      rendererFocus: ['deux jambes distinctes', 'deux bras distincts', 'bassin et epaules bien lisibles'],
    },
    {
      label: 'pas gauche engage',
      variation: 'jambe gauche avance devant, bras droit vient legerement devant, marche enclenchee',
      rendererFocus: ['jambe gauche clairement devant le bassin', 'bras droit plus avance que le bras gauche', 'une jambe d appui et une jambe mobile'],
    },
    {
      label: 'appui gauche',
      variation: 'poids sur la jambe gauche, pied droit commence a quitter le sol, bassin legerement bas',
      rendererFocus: ['jambe gauche porte l appui principal', 'pied droit en train de quitter le sol', 'bassin lisible en compression'],
    },
    {
      label: 'passage droit',
      variation: 'jambe droite passe sous le corps, jambe gauche porte l appui, buste stable',
      rendererFocus: ['jambe droite sous le bassin', 'jambe gauche toujours en appui', 'buste stable et lisible'],
    },
    {
      label: 'pas droit engage',
      variation: 'jambe droite avance devant, bras gauche vient legerement devant, pas suivant visible',
      rendererFocus: ['jambe droite clairement devant le bassin', 'bras gauche plus avance que le bras droit', 'une jambe d appui et une jambe mobile'],
    },
    {
      label: 'appui droit',
      variation: 'poids sur la jambe droite, pied gauche quitte le sol, bassin legerement bas',
      rendererFocus: ['jambe droite porte l appui principal', 'pied gauche en train de quitter le sol', 'bassin lisible en compression'],
    },
    {
      label: 'passage gauche',
      variation: 'jambe gauche passe sous le corps, jambe droite porte l appui, marche continue',
      rendererFocus: ['jambe gauche sous le bassin', 'jambe droite toujours en appui', 'progression du corps encore lisible'],
    },
    {
      label: 'relance gauche',
      variation: 'jambe gauche revient devant pour relancer la marche, balancier naturel des bras',
      rendererFocus: ['jambe gauche repart vers l avant', 'balancier oppose des bras', 'silhouette de marche complete'],
    },
    {
      label: 'sortie de marche',
      variation: 'marche encore lisible, posture stable apres la progression',
      rendererFocus: ['corps entier lisible', 'deux jambes distinctes', 'posture stabilisee sans deformation'],
    },
  ];
}

function buildRunCycleStoryboardBeats() {
  return [
    { label: 'depart de course', variation: 'posture de depart dynamique, corps pret a partir, appuis clairs', rendererFocus: ['deux jambes distinctes', 'buste pret a se projeter', 'bras opposes deja lisibles'] },
    { label: 'attaque gauche', variation: 'jambe gauche attaque devant, buste penche legerement, bras opposes actifs', rendererFocus: ['jambe gauche clairement devant', 'buste incline vers l avant', 'bras opposes bien distincts'] },
    { label: 'compression gauche', variation: 'poids compresse sur la jambe gauche, bassin bas, energie accumulee', rendererFocus: ['jambe gauche porte toute la compression', 'bassin bas et lisible', 'jambe droite prete a repartir'] },
    { label: 'envol', variation: 'les deux pieds quittent legerement le sol, projection nette vers l avant', rendererFocus: ['deux pieds distincts hors appui', 'projection nette du bassin', 'bras de course encore lisibles'] },
    { label: 'attaque droite', variation: 'jambe droite attaque devant, bras opposes inverses, course lisible', rendererFocus: ['jambe droite clairement devant', 'bras opposes inverses', 'silhouette de course complete'] },
    { label: 'compression droite', variation: 'poids compresse sur la jambe droite, energie relancee vers l avant', rendererFocus: ['jambe droite porte toute la compression', 'bassin bas et lisible', 'jambe gauche prete a repartir'] },
    { label: 'sortie de course', variation: 'course encore lisible, posture stabilisee apres la poussee', rendererFocus: ['corps entier lisible', 'deux jambes distinctes', 'sortie de poussee sans deformation'] },
  ];
}

function buildGestureStoryboardBeats() {
  return [
    { label: 'depart', variation: 'pose de depart proche de la reference, geste encore contenu', rendererFocus: ['corps entier lisible', 'deux bras distincts', 'silhouette propre'] },
    { label: 'amorce', variation: 'debut du geste, variation visible mais encore courte', rendererFocus: ['mouvement du bras ou du haut du corps bien lisible', 'anatomie simple et propre'] },
    { label: 'progression', variation: 'geste plus ouvert, posture toujours stable et lisible', rendererFocus: ['geste clairement plus ouvert', 'deux bras distincts', 'buste lisible sans deformation'] },
    { label: 'point haut', variation: 'point haut du geste, mouvement clair sans deformation', rendererFocus: ['point fort du geste', 'anatomie propre', 'silhouette complete'] },
    { label: 'retour', variation: 'retour doux apres le geste, posture stabilisee', rendererFocus: ['retour lisible du bras ou du buste', 'posture stabilisee proprement'] },
  ];
}

function buildPowerUpStoryboardBeats() {
  return [
    { label: 'menace neutre', variation: 'posture menacante stable, poings fermes, aura encore faible', structuralState: 'posture menacante stable, poings fermes, aura encore faible', checkpoint: true, rendererFocus: ['deux poings fermes bien lisibles', 'torse face camera', 'jambes stables sous le bassin'] },
    { label: 'tension montante', variation: 'epaules et torse plus tendus, poings serres, aura plus visible', rendererFocus: ['epaules plus hautes', 'poings serres distincts', 'aura visible autour du corps'] },
    { label: 'compression', variation: 'corps legerement ramasse, energie concentree autour du corps, posture plus dense', rendererFocus: ['bassin et epaules compresses', 'deux jambes toujours lisibles', 'energie concentree autour du torse'] },
    { label: 'ouverture', variation: 'torse plus ouvert, silhouette plus forte, aura se deploie davantage', structuralState: 'torse plus ouvert, silhouette plus forte, aura se deploie davantage', checkpoint: true, rendererFocus: ['poitrine ouverte', 'epaules larges', 'aura plus large autour du corps'] },
    { label: 'maintien puissant', variation: 'tenir une posture forte, aura intense, visage et identite coherents', rendererFocus: ['anatomie propre et solide', 'poitrine et epaules fortes', 'aura intense sans perdre le corps'] },
    { label: 'retombee courte', variation: 'laisser retomber legerement la tension sans perdre la menace', rendererFocus: ['tension encore visible dans les bras', 'corps toujours stable', 'aura un peu plus calme'] },
    { label: 'stabilisation', variation: 'posture puissante stabilisee apres la montee d energie', structuralState: 'posture puissante stabilisee apres la montee d energie', checkpoint: true, rendererFocus: ['posture finale propre', 'deux bras distincts', 'silhouette stabilisee'] },
  ];
}

function resolveTransformationTheme(prompt = '') {
  const lookup = normalizeVideoLookup(prompt);

  if (/\b(divin|god)\b/.test(lookup)) {
    return {
      targetLabel: 'super saiyan divin',
      hairColor: 'rouges divins',
      auraColor: 'rouge divine',
      lightningColor: 'rouges',
    };
  }
  if (/\b(blue|bleu)\b/.test(lookup)) {
    return {
      targetLabel: 'super saiyan bleu',
      hairColor: 'bleus',
      auraColor: 'bleue intense',
      lightningColor: 'bleus',
    };
  }
  if (/\b(ultra instinct|instinct supreme|instinct surp)\b/.test(lookup)) {
    return {
      targetLabel: 'ultra instinct',
      hairColor: 'argentes',
      auraColor: 'argentee',
      lightningColor: 'blancs',
    };
  }
  if (/\b(super saiyan|super sayan|ssj)\b/.test(lookup)) {
    return {
      targetLabel: 'super saiyan',
      hairColor: 'dors',
      auraColor: 'doree',
      lightningColor: 'dores',
    };
  }

  return {
    targetLabel: 'forme transformee',
    hairColor: 'transformes',
    auraColor: 'dense',
    lightningColor: 'energetiques',
  };
}

function buildTransformationStoryboardBeats(prompt = '') {
  const theme = resolveTransformationTheme(prompt);
  return [
    {
      label: 'forme initiale',
      variation: 'posture droite stable, bras proches du corps, cheveux encore normaux, aura presque absente',
      structuralState: 'posture droite stable, bras proches du corps, torse encore contenu, cheveux encore normaux',
      checkpoint: true,
      rendererFocus: ['deux bras proches du torse', 'jambes stables sous le bassin', 'cheveux encore normaux'],
    },
    {
      label: 'premiere tension',
      variation: 'regard plus dur, machoire serree, epaules plus tendues, quelques meches commencent a se dresser',
      structuralState: 'machoire serree, epaules plus hautes, poings plus fermes, torse legerement bombe',
      rendererFocus: ['epaules plus hautes', 'poings plus fermes', 'quelques meches commencent a se dresser'],
    },
    {
      label: 'cheveux se dressent',
      variation: 'cheveux se dressent davantage, posture toujours droite, premiere lueur d energie autour du corps',
      structuralState: 'bras plus ecartes du torse, torse plus ouvert, cheveux se dressent davantage',
      rendererFocus: ['bras un peu plus ecartes du torse', 'torse plus ouvert', 'premiere lueur d energie autour du corps'],
    },
    {
      label: 'premiers eclairs',
      variation: `cheveux presque totalement dresses, quelques eclairs ${theme.lightningColor} apparaissent, aura ${theme.auraColor} encore fine`,
      structuralState: `bras plus tendus, doigts crispes, epaules alignees, quelques eclairs ${theme.lightningColor} apparaissent`,
      rendererFocus: ['bras plus tendus', 'doigts crispes bien lisibles', `quelques eclairs ${theme.lightningColor} autour du corps`],
    },
    {
      label: 'changement de couleur',
      variation: `couleur des cheveux commence a changer, cheveux ${theme.hairColor} naissants, aura ${theme.auraColor} plus epaisse`,
      structuralState: `tete legerement relevee, poitrine plus ouverte, cheveux ${theme.hairColor} naissants, aura ${theme.auraColor} plus epaisse`,
      rendererFocus: ['tete legerement relevee', 'poitrine plus ouverte', `cheveux ${theme.hairColor} naissants`],
    },
    {
      label: 'bascule',
      variation: `cheveux ${theme.hairColor} bien visibles, aura ${theme.auraColor} enveloppe le corps, transformation clairement engagee`,
      structuralState: `bras ecartes du corps, poitrine ouverte, cheveux ${theme.hairColor} bien visibles, aura ${theme.auraColor} enveloppe le corps`,
      checkpoint: true,
      rendererFocus: ['bras ecartes du corps', 'poitrine ouverte', `aura ${theme.auraColor} enveloppe le corps`],
    },
    {
      label: 'forme presque atteinte',
      variation: `forme ${theme.targetLabel} presque atteinte, cheveux ${theme.hairColor} stables, visage toujours reconnaissable`,
      structuralState: `bras ouverts plus haut, torse projete vers l avant, cheveux ${theme.hairColor} stables, energie plus dense`,
      rendererFocus: ['bras ouverts plus haut', 'torse projete vers l avant', 'energie plus dense autour du corps'],
    },
    {
      label: 'forme atteinte',
      variation: `forme ${theme.targetLabel} atteinte, cheveux ${theme.hairColor}, aura ${theme.auraColor} intense, silhouette nette`,
      structuralState: `forme ${theme.targetLabel} atteinte, bras ouverts avec force, poitrine projetee, cheveux ${theme.hairColor}, aura ${theme.auraColor} intense`,
      checkpoint: true,
      rendererFocus: ['bras ouverts avec force', 'poitrine projetee', `aura ${theme.auraColor} intense autour du corps`],
    },
    {
      label: 'maintien puissant',
      variation: `tenir la forme ${theme.targetLabel}, aura ${theme.auraColor} large mais propre, posture toujours droite`,
      structuralState: `tenir la forme ${theme.targetLabel}, appuis plus larges, torse fort, aura ${theme.auraColor} large mais propre`,
      rendererFocus: ['appuis plus larges', 'torse fort et lisible', `aura ${theme.auraColor} large mais propre`],
    },
    {
      label: 'stabilisation finale',
      variation: `forme ${theme.targetLabel} stabilisee, meme visage, meme tenue, energie maitrisee autour du corps`,
      structuralState: `forme ${theme.targetLabel} stabilisee, bras redescendus mais toujours forts, energie maitrisee autour du corps`,
      checkpoint: true,
      rendererFocus: ['bras redescendus mais toujours forts', 'silhouette finale stable', 'energie maitrisee autour du corps'],
    },
  ];
}

function buildArcheryStoryboardBeats({ mounted = false, prompt = '' } = {}) {
  const lookup = normalizeVideoLookup(prompt);
  const horseMotion = /\b(galop|court|running|galope|avance)\b/.test(lookup)
    ? 'le cheval garde un vrai mouvement de course'
    : 'le cheval reste stable et lisible';
  const mountedTail = mounted
    ? `${horseMotion}, la cavaliere reste bien assise en selle`
    : 'les appuis du corps restent stables pendant le tir';

  return [
    { label: 'depart de tir', variation: `posture stable de tir, arc encore bas, cible deja reperee, ${mountedTail}`, structuralState: `posture stable de tir, arc encore bas, cible deja reperee, ${mountedTail}`, checkpoint: true, rendererFocus: ['arc encore bas et complet', 'deux bras distincts', 'regard deja vers la cible'] },
    { label: 'lever l arc', variation: `arc commence a se lever, main de corde se place, regard deja oriente vers la cible, ${mountedTail}`, rendererFocus: ['bras d arc monte clairement', 'main de corde distincte', 'epaules alignees pour le tir'] },
    { label: 'mise en joue', variation: `arc leve, bras d arc tendu, bassin stable, visee claire, ${mountedTail}`, structuralState: `arc leve, bras d arc tendu, bassin stable, visee claire, ${mountedTail}`, checkpoint: true, rendererFocus: ['bras d arc tendu', 'main de corde plus haute', 'fleche orientee vers la cible'] },
    { label: 'traction moyenne', variation: `corde tiree a mi-course, epaules alignees, fleche deja orientee vers la cible, ${mountedTail}`, rendererFocus: ['main de corde reculee vers le visage', 'epaules alignees', 'fleche bien lisible'] },
    { label: 'traction forte', variation: `corde presque a pleine traction, fleche bien alignee, posture de tir nette, ${mountedTail}`, structuralState: `corde presque a pleine traction, fleche bien alignee, posture de tir nette, ${mountedTail}`, checkpoint: true, rendererFocus: ['traction presque complete', 'deux bras bien ouverts', 'fleche bien alignee'] },
    { label: 'tir', variation: `instant du tir ou juste avant le lacher, bras bien ouverts, energie du geste tres claire, ${mountedTail}`, rendererFocus: ['instant fort du geste', 'bras bien ouverts et distincts', 'corps accompagne le lacher'] },
    { label: 'suivi du tir', variation: `suivi du tir, bras encore ouverts, corps accompagne le geste sans changer de structure, ${mountedTail}`, rendererFocus: ['bras encore ouverts', 'torse accompagne le geste', 'posture encore lisible apres le tir'] },
    { label: 'sortie stable', variation: `posture stabilisee apres le tir, arc encore lisible, ${mountedTail}`, structuralState: `posture stabilisee apres le tir, arc encore lisible, ${mountedTail}`, checkpoint: true, rendererFocus: ['arc encore complet et lisible', 'deux bras distincts', 'sortie propre du geste'] },
  ];
}

function buildActionBurstStoryboardBeats(prompt = '') {
  const lookup = normalizeVideoLookup(prompt);
  const isEnergyBurst = /\b(kamehameha|hadouken|energy|energie|beam|blast|rayon|ki blast|boule d energie|charge d energie)\b/.test(lookup);

  if (isEnergyBurst) {
    return [
      { label: 'garde de depart', variation: 'posture de depart stable, geste encore retenu, energie faible', structuralState: 'posture de depart stable, geste encore retenu, energie faible', checkpoint: true, rendererFocus: ['deux bras distincts', 'appuis de depart lisibles', 'energie faible autour des mains'] },
      { label: 'charge', variation: 'bras et epaules organisent la charge, energie commence a monter', rendererFocus: ['mains organisees devant le corps', 'epaules engagees', 'energie commence a monter entre les bras'] },
      { label: 'concentration', variation: 'energie plus dense, transfert de poids visible, geste se precise', rendererFocus: ['transfert de poids vers l avant', 'mains toujours lisibles', 'energie plus dense entre les bras'] },
      { label: 'deploiement', variation: 'bras et buste se deploient davantage, energie prete a sortir', structuralState: 'bras et buste se deploient davantage, energie prete a sortir', checkpoint: true, rendererFocus: ['bras plus ouverts', 'buste plus projete', 'energie prete a sortir devant les mains'] },
      { label: 'emission', variation: 'projection d energie lisible, posture forte et equilibree', rendererFocus: ['projection d energie tres claire', 'deux bras distincts', 'posture forte et equilibree'] },
      { label: 'suite d emission', variation: 'le corps accompagne encore l action apres le pic', rendererFocus: ['torse accompagne le recul ou la poussee', 'bras encore engages', 'energie encore lisible'] },
      { label: 'sortie', variation: 'retombee du geste, energie se dissipe, posture reste lisible', structuralState: 'retombee du geste, energie se dissipe, posture reste lisible', checkpoint: true, rendererFocus: ['retombee des bras ou du buste', 'energie qui se dissipe', 'corps encore proprement lisible'] },
    ];
  }

  return [
    { label: 'garde de depart', variation: 'posture de depart stable, geste encore retenu', structuralState: 'posture de depart stable, geste encore retenu', checkpoint: true, rendererFocus: ['deux bras distincts', 'appuis de depart lisibles', 'silhouette simple et propre'] },
    { label: 'preparation', variation: 'appuis et torsion du corps preparent clairement l action', rendererFocus: ['torsion du bassin ou des epaules', 'un bras ou une jambe preparent l attaque', 'appuis lisibles'] },
    { label: 'montee', variation: 'geste plus grand, energie du corps plus forte, silhouette claire', rendererFocus: ['geste plus grand et plus ouvert', 'buste engage', 'silhouette claire sans deformation'] },
    { label: 'impact', variation: 'moment fort du geste, action pleinement deployee, posture lisible', structuralState: 'moment fort du geste, action pleinement deployee, posture lisible', checkpoint: true, rendererFocus: ['moment fort du geste', 'deux membres principaux bien distincts', 'posture lisible au pic'] },
    { label: 'accompagnement', variation: 'le corps accompagne l action apres le point fort', rendererFocus: ['torse accompagne la suite du geste', 'membres encore lisibles', 'sortie d action credibile'] },
    { label: 'sortie', variation: 'sortie de geste, tension qui redescend sans perdre la coherence', structuralState: 'sortie de geste, tension qui redescend sans perdre la coherence', checkpoint: true, rendererFocus: ['retombee lisible du geste', 'silhouette propre', 'tension qui redescend sans deformation'] },
  ];
}

function resolveHeuristicBeatTemplates(request = {}, motionProfile = 'generic') {
  const prompt = String(request?.prompt || '').trim();
  const subjectType = detectSubjectType(prompt);

  switch (motionProfile) {
    case 'walk_cycle':
      if (subjectType === 'horse') return buildHorseWalkCycleBeats(prompt);
      if (subjectType === 'quadruped' || subjectType === 'dragon') return buildQuadrupedWalkCycleBeats(prompt);
      return buildWalkCycleStoryboardBeats();
    case 'run_cycle':
      return buildRunCycleStoryboardBeats();
    case 'power_up_loop':
      return buildPowerUpStoryboardBeats();
    case 'transformation_rise':
      return buildTransformationStoryboardBeats(request?.prompt || '');
    case 'mounted_archery':
      return buildArcheryStoryboardBeats({ mounted: true, prompt: request?.prompt || '' });
    case 'archery_shot':
      return buildArcheryStoryboardBeats({ prompt: request?.prompt || '' });
    case 'action_burst':
      return buildActionBurstStoryboardBeats(request?.prompt || '');
    case 'dance_cycle':
    case 'gesture_loop':
    case 'subtle_loop':
      return buildGestureStoryboardBeats();
    default:
      return buildGenericStoryboardBeats();
  }
}

function resolveHeuristicSequencePlan(request = {}, options = {}) {
  const requestedMode = String(options.providerRequested || request?.config?.sequencePlanner || 'heuristic').trim() || 'heuristic';
  const motionProfile = (
    VALID_VIDEO_MOTION_PROFILES.includes(String(options.motionProfile || '').trim())
      ? String(options.motionProfile || '').trim()
      : String(request?.timingPlan?.motionProfile || 'generic').trim() || 'generic'
  );
  const stablePromptSource = String(options.stablePromptSource || request?.prompt || '').trim();
  const configuredReanchorEvery = Number(request?.config?.frameReanchorEvery || 0) || 0;
  const genericCompositionHints = [
    'garder l identite, la silhouette et la lecture du sujet',
    'garder une camera continue et un cadrage de base reconnaissable',
    'garder le meme decor, la meme lumiere et la meme palette visuelle',
    'faire varier surtout la posture, le geste et les appuis du corps',
    'eviter que le decor, le costume ou le style changent entre deux frames',
    'laisser seulement de petites variations de camera si elles servent le mouvement',
  ];

  let basePlan = null;
  switch (motionProfile) {
    case 'walk_cycle':
      basePlan = {
        motionProfile,
        initStrategy: 'progressive_chain',
        reanchorEvery: 8,
        cycleLength: 8,
        globalObjective: 'decomposer la marche en appuis successifs pour obtenir un vrai cycle de pas lisible',
        frameProgressionRule: 'chaque frame doit viser la prochaine etape du pas plutot que la pose finale complete',
        compositionHints: [
          ...genericCompositionHints,
          'corps entier lisible',
          'progression du pas clairement visible d une frame a l autre',
          'le mouvement vient surtout des jambes, du bassin et du balancier des bras',
          'une legere evolution du cadrage est acceptable si la marche devient plus credible',
        ],
      };
      break;
    case 'run_cycle':
      basePlan = {
        motionProfile,
        initStrategy: 'progressive_chain',
        reanchorEvery: 6,
        cycleLength: 6,
        globalObjective: 'decomposer la course en foulees successives et energiques sans perdre la lecture du corps',
        frameProgressionRule: 'chaque frame doit preparer la foulee suivante plutot que tout montrer d un coup',
        compositionHints: [
          ...genericCompositionHints,
          'silhouette dynamique mais stable',
          'progression vers l avant lisible',
        ],
      };
      break;
    case 'power_up_loop':
      basePlan = {
        motionProfile,
        initStrategy: 'checkpoint_chain',
        reanchorEvery: 0,
        cycleLength: 6,
        globalObjective: 'faire monter la tension du personnage et de son aura par paliers visibles',
        frameProgressionRule: 'chaque frame doit modifier les appuis, l ouverture du torse ou l intensite de l aura pour preparer la suivante',
        compositionHints: [
          'priorite a la posture, aux appuis et a la tension du corps',
          'faire evoluer l aura plus que le decor',
          'garder visage, costume et silhouette reconnaissables',
        ],
      };
      break;
    case 'transformation_rise':
      basePlan = {
        motionProfile,
        initStrategy: 'checkpoint_chain',
        reanchorEvery: 0,
        cycleLength: 7,
        globalObjective: 'faire monter la transformation par paliers nets jusqu a une nouvelle forme stable',
        frameProgressionRule: 'chaque frame doit montrer une etape visible de la transformation plutot qu une simple variation',
        compositionHints: [
          'priorite a l evolution du corps, des cheveux, de la lumiere ou de l aura',
          'garder visage, silhouette et identite reconnaissables',
          'eviter que le decor change plus que la transformation',
        ],
      };
      break;
    case 'mounted_archery':
      basePlan = {
        motionProfile,
        initStrategy: 'checkpoint_chain',
        reanchorEvery: 0,
        cycleLength: 7,
        globalObjective: 'decomposer un tir a l arc monte en etapes lisibles sans perdre le cheval ni la cavaliere',
        frameProgressionRule: 'chaque frame doit faire avancer le tir ou le galop d une etape concrete',
        compositionHints: [
          'priorite a la position des bras, de l arc, de la corde et de la posture en selle',
          'garder cheval, cavalier et direction du mouvement lisibles',
          'eviter que le decor change plus que le geste de tir',
        ],
      };
      break;
    case 'archery_shot':
      basePlan = {
        motionProfile,
        initStrategy: 'checkpoint_chain',
        reanchorEvery: 0,
        cycleLength: 7,
        globalObjective: 'decomposer le tir a l arc en etapes visibles et credibles',
        frameProgressionRule: 'chaque frame doit faire avancer la preparation, la traction ou le tir',
        compositionHints: [
          'priorite a la position des bras, de l arc, de la corde et au regard',
          'garder la posture du corps stable pendant le tir',
          'eviter que le decor change plus que le geste',
        ],
      };
      break;
    case 'action_burst':
      basePlan = {
        motionProfile,
        initStrategy: 'checkpoint_chain',
        reanchorEvery: 0,
        cycleLength: 6,
        globalObjective: 'faire monter l action par etapes lisibles jusqu au pic du geste puis a sa sortie',
        frameProgressionRule: 'chaque frame doit viser le prochain palier du geste plutot que son resultat final',
        compositionHints: [
          ...genericCompositionHints,
          'priorite a l evolution du geste, de la posture et du transfert de poids',
          'si un adversaire est present, garder l interaction lisible entre les deux sujets',
          'une variation de camera est acceptable si elle sert mieux l action',
        ],
      };
      break;
    case 'dance_cycle':
      basePlan = {
        motionProfile,
        initStrategy: 'progressive_chain',
        reanchorEvery: 8,
        cycleLength: 8,
        globalObjective: 'faire evoluer la danse en temps clairs et successifs',
        frameProgressionRule: 'chaque frame doit preparer le temps suivant de la danse',
        compositionHints: [
          ...genericCompositionHints,
          'rythme du corps lisible',
          'mouvement danse visible sans perdre la lecture du geste',
        ],
      };
      break;
    case 'gesture_loop':
    case 'subtle_loop':
      basePlan = {
        motionProfile,
        initStrategy: 'progressive_chain',
        reanchorEvery: Math.max(5, Number(request?.config?.frameReanchorEvery || 0) || 5),
        cycleLength: 5,
        globalObjective: 'faire progresser le geste par petites etapes lisibles',
        frameProgressionRule: 'chaque frame doit viser la variation suivante du geste',
        compositionHints: [
          ...genericCompositionHints,
          'mouvement localise et subtil',
          'priorite a une petite evolution du geste ou de la posture',
        ],
      };
      break;
    default:
      basePlan = {
        motionProfile: 'generic',
        initStrategy: 'progressive_chain',
        reanchorEvery: configuredReanchorEvery > 0 ? configuredReanchorEvery : 6,
        cycleLength: 0,
        globalObjective: 'decomposer le mouvement en etapes courtes et lisibles',
        frameProgressionRule: 'chaque frame doit faire avancer l action d une etape concrete',
        compositionHints: [
          ...genericCompositionHints,
          'priorite a la progression du geste plutot qu a la redecoration de la scene',
        ],
      };
      break;
  }

  return {
    providerRequested: requestedMode,
    providerUsed: 'heuristic',
    fallbackReason: null,
    motionProfile: basePlan.motionProfile,
    initStrategy: basePlan.initStrategy,
    reanchorEvery: Number(basePlan.reanchorEvery || 0) || 0,
    cycleLength: Number(basePlan.cycleLength || 0) || 0,
    globalObjective: String(basePlan.globalObjective || '').trim(),
    frameProgressionRule: String(basePlan.frameProgressionRule || '').trim(),
    compositionHints: normalizePromptList(basePlan.compositionHints || []),
    identityLocks: normalizePromptList(resolveDefaultIdentityLocks(basePlan.motionProfile)),
    sceneLocks: normalizePromptList(extractStableSceneFragments(stablePromptSource, basePlan.motionProfile)),
    beats: resolveHeuristicBeatTemplates(request, basePlan.motionProfile).map((beat) => normalizeSequenceBeat(beat)),
    imageAwareUsed: false,
  };
}

function splitFramePromptClauses(value = '') {
  return String(value || '')
    .split(/[,.]/)
    .map((entry) => normalizeFramePromptFragment(entry))
    .filter(Boolean);
}

function removeFrameContinuityClauses(clauses = []) {
  return (Array.isArray(clauses) ? clauses : [])
    .map((entry) => normalizeFramePromptFragment(entry))
    .filter(Boolean)
    .filter((entry) => !/\b(meme visage|meme tenue|meme silhouette|meme decor|meme cheval|meme selle|meme position)\b/i.test(normalizeVideoLookup(entry)));
}

function buildCheckpointStructuralPrompt(subject = '', checkpointPrompt = '', fallbackStructuralPrompt = '') {
  const clauses = removeFrameContinuityClauses(splitFramePromptClauses(checkpointPrompt));
  if (!clauses.length) {
    return fallbackStructuralPrompt || `${subject || 'personnage principal'}, structure stable lisible`;
  }
  return [subject || 'personnage principal', ...clauses.slice(0, 4)]
    .map((entry) => normalizeFramePromptFragment(entry))
    .filter(Boolean)
    .join(', ');
}

function buildCheckpointVariationPrompt(checkpointPrompt = '') {
  const clauses = removeFrameContinuityClauses(splitFramePromptClauses(checkpointPrompt));
  if (clauses.length >= 4) {
    return clauses.slice(-2).join(', ');
  }
  if (clauses.length >= 1) {
    return clauses[clauses.length - 1];
  }
  return 'checkpoint visuel propre, nouvelle structure deja lisible';
}

module.exports = {
  VALID_VIDEO_MOTION_PROFILES,
  buildCheckpointStructuralPrompt,
  buildCheckpointVariationPrompt,
  densifySequenceBeats,
  detectSubjectType,
  extractBasePromptFragments,
  extractStableSceneFragments,
  extractStoryboardPromptFragments,
  isStoryboardMetaFragment,
  normalizeFramePromptFragment,
  normalizePromptList,
  normalizeSequenceBeat,
  normalizeVideoLookup,
  removeFrameContinuityClauses,
  resolveDefaultIdentityLocks,
  resolveHeuristicSequencePlan,
  resolveSequenceFrameBeats,
  splitFramePromptClauses,
};
