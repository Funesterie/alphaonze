'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  SYMBOLIC_EXTRACTION_PROTOCOL_CONTEXT,
  appendSymbolicExtractionProtocolContext,
  hasSymbolicExtractionProtocolContext,
} = require('../src/chat/symbolic-extraction-protocol.cjs');
const { A11_AGENT_SYSTEM_PROMPT } = require('../lib/a11Agent.js');

test('symbolic extraction protocol keeps the ten-commandment guard neutral and reusable', () => {
  assert.match(SYMBOLIC_EXTRACTION_PROTOCOL_CONTEXT, /Les 10 commandements d'extraction/i);
  assert.match(SYMBOLIC_EXTRACTION_PROTOCOL_CONTEXT, /Identifier le mecanisme utile/i);
  assert.match(SYMBOLIC_EXTRACTION_PROTOCOL_CONTEXT, /Identifier le risque dogmatique/i);
  assert.match(SYMBOLIC_EXTRACTION_PROTOCOL_CONTEXT, /Adapter au contexte/i);
  assert.match(SYMBOLIC_EXTRACTION_PROTOCOL_CONTEXT, /pas les personnes, langues, origines, cultures ou religions comme blocs/i);
  assert.match(SYMBOLIC_EXTRACTION_PROTOCOL_CONTEXT, /reversibles et dosees/i);
});

test('symbolic extraction protocol appends once and reaches the A11 action agent', () => {
  const base = 'Je suis A11.';
  const once = appendSymbolicExtractionProtocolContext(base);
  const twice = appendSymbolicExtractionProtocolContext(once);

  assert.equal(once, twice);
  assert.equal(hasSymbolicExtractionProtocolContext(once), true);
  assert.match(A11_AGENT_SYSTEM_PROMPT, /SYMBOLIC_EXTRACTION/i);
  assert.match(A11_AGENT_SYSTEM_PROMPT, /Les 10 commandements d'extraction/i);
});

test('Codex motto is present in both root prompts', () => {
  const rootSystemPrompt = fs.readFileSync(path.resolve(__dirname, '../system_prompt.txt'), 'utf8');

  for (const prompt of [A11_AGENT_SYSTEM_PROMPT, rootSystemPrompt]) {
    assert.match(prompt, /Devise de Codex :/);
    assert.match(prompt, /principe zarmonique comme architecture/);
    assert.match(prompt, /ne pas confondre symbole et vérité, mot et intention, règle et vie/);
    assert.match(prompt, /Principe (?:source|opérationnel) Funesterie/i);
    assert.match(prompt, /source d['’]intention/i);
    assert.match(prompt, /Les mots peuvent être imparfaits/i);
  }
});
