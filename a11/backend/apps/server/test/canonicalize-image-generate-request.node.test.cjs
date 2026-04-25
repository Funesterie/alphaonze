const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CANONICAL_IMAGE_GENERATE_REQUEST_SYSTEM_PROMPT,
  canonicalizeImageGenerateRequest,
  extractPreservedNamedEntityCandidates,
  findCardinalityConflict,
  findMissingNamedEntityCandidates,
  normalizeCanonicalizedImageGenerateRequest,
  resolveCanonicalizerTimeoutMs,
  validateCanonicalizedImageGenerateRequest,
} = require('../src/mask/canonicalize-image-generate-request.cjs');

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
  process.env.A11_TRANSLATION_API_KEY = '';
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
    process.env.A11_TRANSLATION_API_KEY = previous.A11_TRANSLATION_API_KEY;
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

test('validateCanonicalizedImageGenerateRequest rejects non-atomic structured field items that survive normalization', () => {
  assert.throws(
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
    }),
    /canonicalized_request_non_atomic_structured_fields/
  );
});

test('canonicalizer prompt explicitly forbids named-entity substitution and contradictory subject counts', () => {
  assert.match(CANONICAL_IMAGE_GENERATE_REQUEST_SYSTEM_PROMPT, /proper names and named entities as immutable/i);
  assert.match(CANONICAL_IMAGE_GENERATE_REQUEST_SYSTEM_PROMPT, /Do not replace a named entity with a related/i);
  assert.match(CANONICAL_IMAGE_GENERATE_REQUEST_SYSTEM_PROMPT, /Do not emit "single subject" instructions for pair or group scenes/i);
});

test('validateCanonicalizedImageGenerateRequest rejects missing explicit named entities from the raw request', () => {
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
  assert.deepEqual(findMissingNamedEntityCandidates(payload), ['Qui-Gon Jinn']);
  assert.throws(
    () => validateCanonicalizedImageGenerateRequest(payload),
    /canonicalized_request_missing_named_entity/
  );
});

test('validateCanonicalizedImageGenerateRequest rejects single-subject instructions in pair scenes', () => {
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

  assert.match(findCardinalityConflict(payload), /single_subject_instruction_in_multi_subject_scene/);
  assert.throws(
    () => validateCanonicalizedImageGenerateRequest(payload),
    /canonicalized_request_cardinality_conflict/
  );
});

test('canonicalizeImageGenerateRequest retries when the LLM substitutes a named character or contradicts pair cardinality', async () => {
  let callCount = 0;
  const canonicalizedRequest = await canonicalizeImageGenerateRequest(
    'genere une image de darkvador versus Qui-Gon Jinn, en plein combat, dans le spatioport de Tatooine',
    {
      stage: 'canonicalize-image-generate-request-test',
      callStructuredLlmJson: async ({ text }) => {
        callCount += 1;
        if (callCount === 1) {
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
                promptInstructions: ['single subject', 'no text'],
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
        }

        assert.match(String(text || ''), /previous_rejected_payload/i);
        assert.match(String(text || ''), /canonicalized_request_/i);
        return {
          canonicalEnglishInput: 'Generate an image of Darth Vader versus Qui-Gon Jinn in a lightsaber duel at the Tatooine spaceport',
          structuredFields: {
            subject: ['Darth Vader', 'Qui-Gon Jinn'],
            environment: ['Tatooine spaceport'],
            style: ['epic cinematic duel'],
            composition: ['two-character lightsaber combat'],
            lighting: ['desert backlight'],
            palette: ['sand', 'black', 'green', 'red'],
            constraints: {
              promptInstructions: [
                'both characters fully readable',
                'clear opposed combat poses',
                'two separate lightsabers visible',
              ],
              negativeHints: ['crowd', 'third subject'],
              noText: true,
              safeMode: true,
            },
          },
          scenePolicy: {
            subjectMode: 'pair',
            explicitSubjectCount: 2,
          },
        };
      },
    }
  );

  assert.equal(callCount, 2);
  assert.equal(canonicalizedRequest.audit.source, 'provided_structured_llm_retry');
  assert.equal(canonicalizedRequest.audit.reason, 'retry_after_canonicalized_request_cardinality_conflict');
  assert.match(canonicalizedRequest.canonicalEnglishInput, /Qui-Gon Jinn/i);
  assert.doesNotMatch(canonicalizedRequest.canonicalEnglishInput, /Obi-Wan/i);
  assert.equal(canonicalizedRequest.scenePolicy.subjectMode, 'pair');
  assert.equal(canonicalizedRequest.scenePolicy.explicitSubjectCount, 2);
  assert.deepEqual(canonicalizedRequest.structuredFields.subject, ['Darth Vader', 'Qui-Gon Jinn']);
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
