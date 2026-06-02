'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyzeUploadedResource,
  buildConversationResourceContext,
} = require('../lib/resource-reader.cjs');

test('upload resource analysis infers likely action for briefs', async () => {
  const analysis = await analyzeUploadedResource({
    filename: 'brief-vivy.txt',
    contentType: 'text/plain',
    buffer: Buffer.from('Objectif: creer une chanson courte avec voix Vivy.\nTache: preparer le brief audio.'),
  });

  assert.equal(analysis.fileKind, 'text');
  assert.equal(analysis.actionInference.intent, 'brief_or_task_context');
  assert.ok(analysis.actionInference.suggestedAction.includes('brouillon'));
  assert.deepEqual(analysis.actionInference.routeHints, ['brief', 'task_extract']);
});

test('conversation resource context exposes likely action and route hints', () => {
  const context = buildConversationResourceContext([
    {
      id: 42,
      filename: 'voice-test.mp3',
      resourceKind: 'audio',
      contentType: 'audio/mpeg',
      metadata: {
        analysis: {
          readableInChatContext: true,
          preview: '[Analyse audio] Duree: 0:12 | Codec: MP3',
          actionInference: {
            intent: 'voice_or_music_source',
            suggestedAction: 'Decider si le fichier sert de reference voix.',
            routeHints: ['audio_transcribe', 'voice_reference'],
          },
        },
      },
    },
  ]);

  assert.match(context, /Action probable: Decider si le fichier sert de reference voix\./);
  assert.match(context, /Routes probables: audio_transcribe, voice_reference/);
});
