const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CANONICAL_IMAGE_GENERATE_REQUEST_SYSTEM_PROMPT,
  canonicalizeImageGenerateRequest,
  extractPreservedNamedEntityCandidates,
  findCardinalityConflict,
  findMissingNamedEntityCandidates,
  findRawSubjectCardinalityExpectation,
  normalizeCanonicalizedImageGenerateRequest,
  resolveCanonicalizerTimeoutMs,
  validateCanonicalizedImageGenerateRequest,
} = require('../src/mask/canonicalize-image-generate-request.cjs');

const setEnv = (name, value) => { process.env[name] = value; };

function collectCanonicalizedTextForTest(canonicalizedRequest = {}) {
  const fields = canonicalizedRequest.structuredFields || {};
  const constraints = fields.constraints || {};
  return [
    canonicalizedRequest.canonicalEnglishInput,
    ...(Array.isArray(fields.subject) ? fields.subject : []),
    ...(Array.isArray(fields.environment) ? fields.environment : []),
    ...(Array.isArray(fields.style) ? fields.style : []),
    ...(Array.isArray(fields.composition) ? fields.composition : []),
    ...(Array.isArray(fields.lighting) ? fields.lighting : []),
    ...(Array.isArray(fields.palette) ? fields.palette : []),
    ...(Array.isArray(constraints.promptInstructions) ? constraints.promptInstructions : []),
    ...(Array.isArray(constraints.negativeHints) ? constraints.negativeHints : []),
  ].filter(Boolean).join(' ');
}

test('canonicalizeImageGenerateRequest rejects non-canonical special-compiler payloads instead of falling back locally', async () => {
  await assert.rejects(
    () => canonicalizeImageGenerateRequest(
      'genere une image d un lapin avec une carotte dans la bouche',
      {
        stage: 'canonicalize-image-generate-request-test',
        callStructuredLlmJson: async () => ({
          composition_hints: ['accessoire bien visible'],
          environment_hints: ['décor simple et lisible'],
          style_hints: [],
          prompt_instructions: ['Montrer clairement une carotte dans la bouche du sujet principal.'],
        }),
      }
    ),
    (error) => {
      assert.equal(error?.code, 'image_request_canonicalizer_failed');
      assert.equal(error?.statusCode, 502);
      assert.equal(error?.payload?.details?.policy, 'llm_only_no_heuristic_fallback');
      assert.match(String(error?.payload?.details?.reasons?.[0] || ''), /missing_canonical_subject/i);
      return true;
    }
  );
});

test('canonicalizeImageGenerateRequest rejects empty LLM payloads instead of building a local heuristic prompt', async () => {
  await assert.rejects(
    () => canonicalizeImageGenerateRequest(
      'genere une image de samourai avec une epee enflammee',
      {
        stage: 'canonicalize-image-generate-request-test',
        allowCompatFallback: true,
        callStructuredLlmJson: async () => null,
      }
    ),
    (error) => {
      assert.equal(error?.code, 'image_request_canonicalizer_failed');
      assert.equal(error?.statusCode, 502);
      assert.equal(error?.payload?.details?.policy, 'llm_only_no_heuristic_fallback');
      assert.deepEqual(error?.payload?.details?.reasons, ['provided_structured_llm:empty_payload']);
      return true;
    }
  );
});

test('canonicalizeImageGenerateRequest surfaces strict structured-llm configuration failures without collapsing them to empty_payload', async () => {
  const previous = {
    A11_TRANSLATION_BASE_URL: process.env.A11_TRANSLATION_BASE_URL,
    LLM_ROUTER_URL: process.env.LLM_ROUTER_URL,
    A11_TRANSLATION_API_KEY: process.env.A11_TRANSLATION_API_KEY,
    A11_OPENAI_API_KEY: process.env.A11_OPENAI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    A11_TRANSLATION_ALLOW_GENERIC_OPENAI: process.env.A11_TRANSLATION_ALLOW_GENERIC_OPENAI,
  };

  process.env.A11_TRANSLATION_BASE_URL = '';
  process.env.LLM_ROUTER_URL = '';
  setEnv('A11_TRANSLATION_API_KEY', '');
  process.env.A11_OPENAI_API_KEY = '';
  process.env.OPENAI_API_KEY = '';
  process.env.A11_TRANSLATION_ALLOW_GENERIC_OPENAI = '';

  try {
    await assert.rejects(
      () => canonicalizeImageGenerateRequest('genere une image de pomme'),
      (error) => {
        assert.equal(error?.code, 'image_request_canonicalizer_failed');
        assert.equal(error?.statusCode, 503);
        assert.deepEqual(error?.payload?.details?.reasons, ['default_structured_llm:structured_llm_unconfigured']);
        assert.equal(error?.payload?.details?.upstream?.status, null);
        return true;
      }
    );
  } finally {
    process.env.A11_TRANSLATION_BASE_URL = previous.A11_TRANSLATION_BASE_URL;
    process.env.LLM_ROUTER_URL = previous.LLM_ROUTER_URL;
    setEnv('A11_TRANSLATION_API_KEY', previous.A11_TRANSLATION_API_KEY);
    process.env.A11_OPENAI_API_KEY = previous.A11_OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = previous.OPENAI_API_KEY;
    process.env.A11_TRANSLATION_ALLOW_GENERIC_OPENAI = previous.A11_TRANSLATION_ALLOW_GENERIC_OPENAI;
  }
});

test('validateCanonicalizedImageGenerateRequest rejects subjectless canonical payloads', () => {
  const payload = normalizeCanonicalizedImageGenerateRequest({
    canonicalEnglishInput: 'no readable text',
    structuredFields: {
      subject: [],
      environment: [],
      style: [],
      composition: [],
      lighting: [],
      palette: [],
      constraints: {
        promptInstructions: [],
        negativeHints: [],
        noText: true,
        safeMode: true,
      },
    },
  }, 'genere une image');

  assert.throws(
    () => validateCanonicalizedImageGenerateRequest(payload),
    /missing_canonical_subject/
  );
});

test('normalizeCanonicalizedImageGenerateRequest atomizes structured field paragraphs and comma-packed negative hints', () => {
  const payload = normalizeCanonicalizedImageGenerateRequest({
    canonicalEnglishInput: '',
    structuredFields: {
      subject: ['the same person from the reference image transformed into a Joker-style version'],
      environment: ['Harlem-inspired street with graffiti and worn building textures'],
      style: ['dark cinematic live-action portrait'],
      composition: ['single subject'],
      lighting: [],
      palette: ['purple'],
      constraints: {
        promptInstructions: [
          'keep exactly the same face and identity. preserve the pose and framing from the reference image. replace the wooden bat with a custom Joker bat.',
        ],
        negativeHints: [
          'different face, different identity, different person',
          'bad hands, extra fingers',
        ],
        noText: true,
        safeMode: true,
      },
    },
  }, 'joker request');

  assert.deepEqual(
    payload.structuredFields.constraints.promptInstructions,
    [
      'keep exactly the same face and identity',
      'preserve the pose and framing from the reference image',
      'replace the wooden bat with a custom Joker bat',
    ]
  );
  assert.deepEqual(
    payload.structuredFields.constraints.negativeHints,
    [
      'different face',
      'different identity',
      'different person',
      'bad hands',
      'extra fingers',
    ]
  );
});

test('validateCanonicalizedImageGenerateRequest accepts long promptInstructions without throwing non-atomic error', () => {
  // non-atomic validation removed — LLM decides structure, not heuristics
  assert.doesNotThrow(
    () => validateCanonicalizedImageGenerateRequest({
      needsClarification: false,
      clarificationQuestion: '',
      canonicalEnglishInput: 'the same person from the reference image',
      structuredFields: {
        subject: ['the same person from the reference image'],
        environment: [],
        style: [],
        composition: [],
        lighting: [],
        palette: [],
        constraints: {
          promptInstructions: [
            'keep exactly the same face and identity while preserving the pose and framing from the reference image and replacing the wooden bat with a custom Joker bat in a Harlem-inspired street with graffiti and worn building textures',
          ],
          negativeHints: [],
          noText: true,
          safeMode: true,
        },
      },
      scenePolicy: {
        subjectMode: 'single',
        explicitSubjectCount: 1,
      },
      audit: {
        rawUserInput: 'joker request',
        source: 'test',
        fallbackUsed: false,
        reason: '',
      },
    })
  );
});

test('canonicalizer prompt explicitly forbids named-entity substitution and contradictory subject counts', () => {
  assert.match(CANONICAL_IMAGE_GENERATE_REQUEST_SYSTEM_PROMPT, /proper names and named entities as immutable/i);
  assert.match(CANONICAL_IMAGE_GENERATE_REQUEST_SYSTEM_PROMPT, /Do not replace a named entity with a related/i);
  assert.match(CANONICAL_IMAGE_GENERATE_REQUEST_SYSTEM_PROMPT, /Do not emit "single subject" instructions for pair or group scenes/i);
  assert.match(CANONICAL_IMAGE_GENERATE_REQUEST_SYSTEM_PROMPT, /two separate subject entries/i);
  assert.match(CANONICAL_IMAGE_GENERATE_REQUEST_SYSTEM_PROMPT, /sole subject when the user requested actors/i);
});

test('validateCanonicalizedImageGenerateRequest accepts payloads where named entities differ from raw input', () => {
  // named entity validation removed — LLM decides preservation, not heuristics
  const payload = normalizeCanonicalizedImageGenerateRequest({
    canonicalEnglishInput: 'Generate an image of Darth Vader versus Obi-Wan Kenobi in combat on the Tatooine spaceport',
    structuredFields: {
      subject: ['Darth Vader', 'Obi-Wan Kenobi'],
      environment: ['Tatooine spaceport'],
      style: ['epic cinematic scene'],
      composition: ['combat duel'],
      lighting: ['intense lighting'],
      palette: ['dark', 'muted'],
      constraints: {
        promptInstructions: ['two full recognizable characters'],
        negativeHints: [],
        noText: true,
        safeMode: true,
      },
    },
    scenePolicy: {
      subjectMode: 'pair',
      explicitSubjectCount: 2,
    },
  }, 'genere une image de darkvador versus Qui-Gon Jinn, en plein combat, dans le spatioport de Tatooine');

  assert.deepEqual(
    extractPreservedNamedEntityCandidates(payload.audit.rawUserInput),
    ['Qui-Gon Jinn', 'Tatooine']
  );
  // findMissingNamedEntityCandidates still works as a utility but no longer blocks validation
  assert.deepEqual(findMissingNamedEntityCandidates(payload), ['Qui-Gon Jinn']);
  assert.doesNotThrow(() => validateCanonicalizedImageGenerateRequest(payload));
});

test('validateCanonicalizedImageGenerateRequest accepts pair scenes even with single-subject instructions — LLM decides cardinality', () => {
  // La cardinalité est décidée par le LLM canonicalizer, pas par validation heuristique.
  // Si le LLM produit subjectMode=pair avec une instruction "single subject", c'est
  // une incohérence interne du LLM — on lui fait confiance et on ne revalide pas.
  const payload = normalizeCanonicalizedImageGenerateRequest({
    canonicalEnglishInput: 'Darth Vader versus Qui-Gon Jinn in combat on the Tatooine spaceport',
    structuredFields: {
      subject: ['Darth Vader', 'Qui-Gon Jinn'],
      environment: ['Tatooine spaceport'],
      style: ['epic cinematic scene'],
      composition: ['combat duel'],
      lighting: ['intense lighting'],
      palette: ['dark', 'muted'],
      constraints: {
        promptInstructions: ['single subject', 'two full recognizable characters'],
        negativeHints: [],
        noText: true,
        safeMode: true,
      },
    },
    scenePolicy: {
      subjectMode: 'pair',
      explicitSubjectCount: 2,
    },
  }, 'genere une image de darkvador versus Qui-Gon Jinn, en plein combat, dans le spatioport de Tatooine');

  // findCardinalityConflict est conservé comme utilitaire mais ne bloque plus la validation
  assert.match(findCardinalityConflict(payload), /single_subject_instruction_in_multi_subject_scene/);
  // La validation ne throw plus sur la cardinalité — le LLM décide
  assert.doesNotThrow(() => validateCanonicalizedImageGenerateRequest(payload));
});

test('validateCanonicalizedImageGenerateRequest accepts collapsed two-fighter requests — LLM decides cardinality', () => {
  // Le LLM canonicalizer décide si "deux combattants" = pair ou single.
  // On ne revalide plus avec des regex sur le texte brut.
  const rawUserInput = 'Un affrontement anime explosif de type DBZ entre deux combattants ultra puissants';
  const payload = normalizeCanonicalizedImageGenerateRequest({
    canonicalEnglishInput: 'Explosive anime confrontation in a rocky arena',
    structuredFields: {
      subject: ['confrontation'],
      environment: ['rocky arena'],
      style: ['explosive anime'],
      composition: ['single subject poster framing'],
      lighting: ['intense light'],
      palette: [],
      constraints: {
        promptInstructions: ['single clearly visible main subject'],
        negativeHints: [],
        noText: true,
        safeMode: true,
      },
    },
    scenePolicy: {
      subjectMode: 'single',
      explicitSubjectCount: 1,
    },
  }, rawUserInput);

  // findRawSubjectCardinalityExpectation et findCardinalityConflict restent disponibles
  // comme utilitaires pour le system prompt du LLM, mais ne bloquent plus la validation.
  assert.deepEqual(findRawSubjectCardinalityExpectation(rawUserInput), {
    subjectMode: 'pair',
    explicitSubjectCount: 2,
    reason: 'explicit_two_subjects',
  });
  assert.match(findCardinalityConflict(payload), /raw_pair_scene_collapsed_to_single/);
  // La validation accepte — c'est le LLM qui doit corriger ça, pas une regex
  assert.doesNotThrow(() => validateCanonicalizedImageGenerateRequest(payload));
});

test('extractPreservedNamedEntityCandidates ignores prompt section labels but preserves DBZ acronym', () => {
  const rawUserInput = "genere une image d'un affrontement anime explosif de type DBZ entre deux combattants ultra puissants dans une arène rocheuse détruite, au moment d’un choc d’énergie monumental. Les deux personnages sont bien distincts, en full body, face à face ou en collision au centre de l’image. Style anime shonen haut de gamme, rendu très détaillé, couleurs intenses, illustration cinématique, sans texte. Negative prompt : low quality, blurry, bad anatomy, extra fingers, bad hands, text, watermark, logo";

  assert.deepEqual(
    extractPreservedNamedEntityCandidates(rawUserInput),
    ['DBZ']
  );
});

test('validateCanonicalizedImageGenerateRequest accepts the full DBZ two-fighter request without requiring section labels', () => {
  const rawUserInput = "genere une image d'un affrontement anime explosif de type DBZ entre deux combattants ultra puissants dans une arène rocheuse détruite, au moment d’un choc d’énergie monumental, poses dynamiques, muscles tendus, expressions féroces et déterminées, auras gigantesques autour des corps, éclairs, ondes de choc, poussière, rochers qui lévitent, lumière intense, ciel dramatique déchiré par l’énergie, impact visuel énorme. Les deux personnages sont bien distincts, en full body, face à face ou en collision au centre de l’image, avec attaque énergétique massive contre contre-attaque puissante, ambiance de fin de combat légendaire. Style anime shonen haut de gamme, rendu très détaillé, couleurs intenses, cheveux et vêtements emportés par l’énergie, composition claire et lisible, sensation de vitesse, puissance et destruction, illustration cinématique, sans texte. Negative prompt : low quality, blurry, bad anatomy, extra fingers, bad hands, malformed face, asymmetrical eyes, duplicate body, fused limbs, multiple extra characters, messy composition, weak aura, weak energy effects, flat lighting, cropped head, cropped hands, cut off body, deformed proportions, childish cartoon style, realistic photo style, text, watermark, logo";
  const payload = normalizeCanonicalizedImageGenerateRequest({
    canonicalEnglishInput: 'Two distinct ultra-powerful anime fighters in an explosive DBZ-style energy clash inside a destroyed rocky arena',
    structuredFields: {
      subject: ['first ultra-powerful anime fighter', 'second ultra-powerful anime fighter'],
      environment: ['destroyed rocky arena', 'dramatic energy-torn sky'],
      style: ['high-end shonen anime', 'DBZ-style energy battle'],
      composition: ['full-body face-to-face collision', 'massive energy attack versus counterattack'],
      lighting: ['intense energy light'],
      palette: ['intense colors'],
      constraints: {
        promptInstructions: ['both fighters fully visible', 'clear separate silhouettes'],
        negativeHints: ['low quality', 'blurry', 'bad anatomy', 'extra fingers', 'text', 'watermark', 'logo'],
        noText: true,
        safeMode: true,
      },
    },
    scenePolicy: {
      subjectMode: 'pair',
      explicitSubjectCount: 2,
    },
  }, rawUserInput);

  assert.doesNotThrow(() => validateCanonicalizedImageGenerateRequest(payload));
});

test('canonicalizeImageGenerateRequest accepts the first LLM result without retrying on cardinality — LLM decides', async () => {
  // Le LLM décide de la cardinalité. Même si le premier résultat a subjectMode=single
  // pour une demande "vs", on l'accepte — c'est au LLM de bien interpréter le contexte.
  let callCount = 0;
  const canonicalizedRequest = await canonicalizeImageGenerateRequest(
    'genere une image de darkvador versus Qui-Gon Jinn, en plein combat, dans le spatioport de Tatooine',
    {
      stage: 'canonicalize-image-generate-request-test',
      callStructuredLlmJson: async () => {
        callCount += 1;
        return {
          canonicalEnglishInput: 'Generate an image of Darth Vader versus Obi-Wan Kenobi in combat, set on the spaceport of Tatooine',
          structuredFields: {
            subject: ['Darth Vader', 'Obi-Wan Kenobi'],
            environment: ['Tatooine spaceport'],
            style: ['dark epic scene'],
            composition: ['combat duel'],
            lighting: ['intense lighting'],
            palette: ['dark', 'muted'],
            constraints: {
              promptInstructions: ['no text'],
              negativeHints: ['low resolution'],
              noText: true,
              safeMode: true,
            },
          },
          scenePolicy: {
            subjectMode: 'single',
            explicitSubjectCount: 1,
          },
        };
      },
    }
  );

  // Un seul appel LLM — pas de retry sur la cardinalité
  assert.equal(callCount, 1);
  assert.equal(canonicalizedRequest.audit.source, 'provided_structured_llm');
  assert.equal(canonicalizedRequest.audit.fallbackUsed, false);
});

test('canonicalizeImageGenerateRequest accepts collapsed two-fighter requests without retry — LLM decides cardinality', async () => {
  // Le LLM décide si "deux combattants" = pair. On n'impose plus de retry.
  let callCount = 0;
  const canonicalizedRequest = await canonicalizeImageGenerateRequest(
    'Un affrontement anime explosif de type DBZ entre deux combattants ultra puissants dans une arene rocheuse',
    {
      stage: 'canonicalize-image-generate-request-test',
      callStructuredLlmJson: async () => {
        callCount += 1;
        return {
          canonicalEnglishInput: 'Explosive anime confrontation in a destroyed rocky arena',
          structuredFields: {
            subject: ['confrontation'],
            environment: ['destroyed rocky arena'],
            style: ['explosive anime'],
            composition: ['single subject poster framing'],
            lighting: ['intense light'],
            palette: [],
            constraints: {
              promptInstructions: ['single clearly visible main subject'],
              negativeHints: ['blur'],
              noText: true,
              safeMode: true,
            },
          },
          scenePolicy: {
            subjectMode: 'single',
            explicitSubjectCount: 1,
          },
        };
      },
    }
  );

  // Un seul appel — pas de retry sur la cardinalité
  assert.equal(callCount, 1);
  assert.equal(canonicalizedRequest.audit.source, 'provided_structured_llm');
  assert.equal(canonicalizedRequest.audit.fallbackUsed, false);
});

test('canonicalizeImageGenerateRequest keeps a valid structured canonical payload and never marks it as fallback', async () => {
  const canonicalizedRequest = await canonicalizeImageGenerateRequest(
    'genere une image de femme en tenue theatrale',
    {
      stage: 'canonicalize-image-generate-request-test',
      callStructuredLlmJson: async () => ({
        canonicalEnglishInput: 'a woman wearing a theatrical outfit',
        structuredFields: {
          subject: ['woman wearing a theatrical outfit'],
          environment: ['simple setting'],
          style: ['high quality'],
          composition: ['single well-framed subject'],
          lighting: [],
          palette: [],
          constraints: {
            promptInstructions: [],
            negativeHints: [],
            noText: true,
            safeMode: true,
          },
        },
        scenePolicy: {
          subjectMode: 'single',
          explicitSubjectCount: 1,
        },
      }),
    }
  );

  assert.equal(canonicalizedRequest.audit.source, 'provided_structured_llm');
  assert.equal(canonicalizedRequest.audit.fallbackUsed, false);
  assert.match(String(canonicalizedRequest.canonicalEnglishInput || ''), /woman/i);
  assert.doesNotMatch(
    String(canonicalizedRequest.canonicalEnglishInput || ''),
    /\b(?:femme|tenue|theatrale|personnage|sujet)\b/i
  );
});

test('canonicalizeImageGenerateRequest retries once through the LLM when the first structured payload leaks French', async () => {
  let callCount = 0;
  const canonicalizedRequest = await canonicalizeImageGenerateRequest(
    'genere une image de femme en tenue theatrale avec une couronne',
    {
      stage: 'canonicalize-image-generate-request-test',
      callStructuredLlmJson: async ({ text }) => {
        callCount += 1;
        if (callCount === 1) {
          return {
            canonicalEnglishInput: 'femme en tenue theatrale avec une couronne, decor simple',
            structuredFields: {
              subject: ['femme en tenue theatrale'],
              environment: ['decor simple'],
              style: ['haute qualite'],
              composition: ['sujet unique bien cadre'],
              lighting: ['lumiere dramatique'],
              palette: ['violet'],
              constraints: {
                promptInstructions: ['couronne portee par le sujet principal'],
                negativeHints: ['texte lisible'],
                noText: true,
                safeMode: true,
              },
            },
            scenePolicy: {
              subjectMode: 'single',
              explicitSubjectCount: 1,
            },
          };
        }

        assert.match(String(text || ''), /previous_rejected_payload/i);
        assert.match(String(text || ''), /canonicalized_request_not_english_only/i);
        return {
          canonicalEnglishInput: 'a woman wearing a theatrical outfit with a crown, simple setting',
          structuredFields: {
            subject: ['woman wearing a theatrical outfit'],
            environment: ['simple setting'],
            style: ['high quality'],
            composition: ['single well-framed subject'],
            lighting: ['dramatic lighting'],
            palette: ['violet'],
            constraints: {
              promptInstructions: ['crown worn by the main subject'],
              negativeHints: ['readable text'],
              noText: true,
              safeMode: true,
            },
          },
          scenePolicy: {
            subjectMode: 'single',
            explicitSubjectCount: 1,
          },
        };
      },
    }
  );

  assert.equal(callCount, 2);
  assert.equal(canonicalizedRequest.audit.source, 'provided_structured_llm_retry');
  assert.equal(canonicalizedRequest.audit.fallbackUsed, false);
  assert.equal(canonicalizedRequest.audit.reason, 'retry_after_canonicalized_request_not_english_only');
  assert.match(String(canonicalizedRequest.canonicalEnglishInput || ''), /woman|crown/i);
  assert.doesNotMatch(
    String(canonicalizedRequest.canonicalEnglishInput || ''),
    /\b(?:femme|tenue|couronne|decor|haute|qualite|sujet|lumiere|texte)\b/i
  );
});

test('canonicalizeImageGenerateRequest rejects mixed French leaks from a structured payload after the bounded retry is exhausted', async () => {
  await assert.rejects(
    () => canonicalizeImageGenerateRequest(
      'genere une image de femme en tenue theatrale avec une couronne',
      {
        stage: 'canonicalize-image-generate-request-test',
        callStructuredLlmJson: async () => ({
          canonicalEnglishInput: 'femme en tenue theatrale avec une couronne, decor simple',
          structuredFields: {
            subject: ['femme en tenue theatrale'],
            environment: ['decor simple'],
            style: ['haute qualite'],
            composition: ['sujet unique bien cadre'],
            lighting: ['lumiere dramatique'],
            palette: ['violet'],
            constraints: {
              promptInstructions: ['couronne portee par le sujet principal'],
              negativeHints: ['texte lisible'],
              noText: true,
              safeMode: true,
            },
          },
          scenePolicy: {
            subjectMode: 'single',
            explicitSubjectCount: 1,
          },
        }),
      }
    ),
    (error) => {
      assert.equal(error?.code, 'image_request_canonicalizer_failed');
      assert.equal(error?.statusCode, 502);
      assert.equal(error?.payload?.details?.policy, 'llm_only_no_heuristic_fallback');
      assert.deepEqual(
        error?.payload?.details?.reasons,
        [
          'provided_structured_llm:canonicalized_request_not_english_only',
          'provided_structured_llm_retry:canonicalized_request_not_english_only',
        ]
      );
      return true;
    }
  );
});

test('canonicalizeImageGenerateRequest rejects reference-image style transforms after French-only LLM leaks', async () => {
  let callCount = 0;

  await assert.rejects(
    () => canonicalizeImageGenerateRequest(
      'utilise cette image pour genere une image de cette personne en dragon ball z',
      {
        stage: 'canonicalize-image-generate-request-test',
        referenceImagePresent: true,
        referenceImageUrl: 'https://example.test/reference.png',
        allowCompatFallback: true,
        callStructuredLlmJson: async () => {
          callCount += 1;
          return {
            canonicalEnglishInput: 'la personne de l image de reference en style dragon ball z',
            structuredFields: {
              subject: ['la personne de l image de reference'],
              environment: [],
              style: ['style dragon ball z'],
              composition: ['garder la pose et le cadrage'],
              lighting: [],
              palette: [],
              constraints: {
                promptInstructions: ['garder le meme visage et la meme identite'],
                negativeHints: ['texte lisible'],
                noText: true,
                safeMode: true,
              },
            },
            scenePolicy: {
              subjectMode: 'single',
              explicitSubjectCount: 1,
            },
          };
        },
      }
    ),
    (error) => {
      assert.equal(error?.code, 'image_request_canonicalizer_failed');
      assert.equal(error?.statusCode, 502);
      assert.equal(error?.payload?.details?.policy, 'llm_only_no_heuristic_fallback');
      assert.deepEqual(
        error?.payload?.details?.reasons,
        [
          'provided_structured_llm:canonicalized_request_not_english_only',
          'provided_structured_llm_retry:canonicalized_request_not_english_only',
        ]
      );
      assert.equal(callCount, 2);
      return true;
    }
  );
});

test('resolveCanonicalizerTimeoutMs defaults to a safer structured-output budget when no explicit timeout is set', () => {
  assert.equal(
    resolveCanonicalizerTimeoutMs({
      A11_IMAGE_CANONICALIZER_TIMEOUT_MS: '',
      A11_WAZAA_LLM_TIMEOUT_MS: '90000',
    }),
    30000
  );
});

test('canonicalizeImageGenerateRequest passes the explicit canonicalizer timeout to the structured llm caller', async () => {
  const previous = process.env.A11_IMAGE_CANONICALIZER_TIMEOUT_MS;
  process.env.A11_IMAGE_CANONICALIZER_TIMEOUT_MS = '42000';
  let capturedTimeout = null;

  try {
    await canonicalizeImageGenerateRequest('genere une image de dragon bleu', {
      stage: 'canonicalize-image-generate-request-test',
      callStructuredLlmJson: async (payload) => {
        capturedTimeout = payload.timeoutMs;
        return {
          canonicalEnglishInput: 'a blue dragon',
          structuredFields: {
            subject: ['blue dragon'],
            environment: [],
            style: [],
            composition: [],
            lighting: [],
            palette: [],
            constraints: {
              promptInstructions: [],
              negativeHints: [],
              noText: true,
              safeMode: true,
            },
          },
          scenePolicy: {
            subjectMode: 'single',
            explicitSubjectCount: 1,
          },
        };
      },
    });

    assert.equal(capturedTimeout, 42000);
  } finally {
    if (previous === undefined) delete process.env.A11_IMAGE_CANONICALIZER_TIMEOUT_MS;
    else process.env.A11_IMAGE_CANONICALIZER_TIMEOUT_MS = previous;
  }
});
