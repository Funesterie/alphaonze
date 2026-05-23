const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildCanonicalImageMaskFromText,
} = require('../src/mask/resolve-image-mask-from-text.cjs');

test('buildCanonicalImageMaskFromText propagates canonicalizer failures instead of using legacy WAZAA fallback', async () => {
  const canonicalizerError = new Error('image_request_canonicalizer_failed');
  canonicalizerError.code = 'image_request_canonicalizer_failed';
  canonicalizerError.statusCode = 502;
  canonicalizerError.payload = {
    ok: false,
    error: 'image_request_canonicalizer_failed',
    details: {
      policy: 'llm_only_no_heuristic_fallback',
      reasons: ['provided_structured_llm:empty_payload'],
    },
  };

  await assert.rejects(
    () => buildCanonicalImageMaskFromText('genere une image de samourai', {
      allowCompatFallback: true,
      canonicalizeImageGenerateRequest: async () => {
        throw canonicalizerError;
      },
    }),
    (error) => {
      assert.equal(error, canonicalizerError);
      assert.equal(error?.payload?.details?.policy, 'llm_only_no_heuristic_fallback');
      return true;
    }
  );
});
