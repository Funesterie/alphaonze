'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { beforeEach, test } = require('node:test');

const capsule = require('../src/persona/persona-capsule.cjs');
const personaEngine = require('../src/persona/persona-engine.cjs');
const { hasInlineSecret } = require('../src/persona/persona-provider-rebind.cjs');
const registry = require('../src/persona/persona-runtime-registry.cjs');
const runner = require('../src/persona/persona-agent-revival-runner.cjs');

function keyPair() {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  return {
    privateKey: pair.privateKey,
    publicKey,
    keyId: crypto.createHash('sha256').update(Buffer.from(publicKey, 'utf8')).digest('hex').slice(0, 16),
    algorithm: 'ed25519',
  };
}

function makeFixture(ids = ['vivy']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-agent-revival-'));
  const vault = path.join(root, 'vault');
  const runtime = path.join(root, 'runtime');
  fs.mkdirSync(vault, { recursive: true });
  fs.mkdirSync(runtime, { recursive: true });
  const pair = keyPair();
  for (const id of ids) writeHolocron(vault, id, pair);
  const env = {
    A11_RUNTIME_ROOT: runtime,
    FUNESTERIE_PERSONA_VAULT: vault,
    FUNESTERIE_HOLOCRON_VERIFYING_KEY: pair.publicKey,
    A11_PERSONA_AGENT_IDS: ids.join(','),
    A11_PERSONA_AGENT_REVIVAL_ENABLED: '1',
    A11_PERSONA_AGENT_REVIVAL_MAX_PER_RUN: '1',
    A11_PERSONA_AGENT_REVIVAL_MAX_ATTEMPTS: '2',
    A11_PERSONA_AGENT_REVIVAL_COOLDOWN_MS: '60000',
  };
  return { root, vault, runtime, pair, env };
}

function writeHolocron(vault, id, pair, overrides = {}) {
  const cap = capsule.buildCapsule({
    id,
    label: id === 'k44' ? 'K44' : `${id[0].toUpperCase()}${id.slice(1)}`,
    role: `agent ${id}`,
    official: overrides.official !== false,
    note: Object.prototype.hasOwnProperty.call(overrides, 'note')
      ? overrides.note
      : `identite canonique ${id}`,
  }, {
    snapshotAt: overrides.snapshotAt || '2026-08-08T20:00:00.000Z',
    canonical: overrides.canonical !== false,
    models: overrides.models || [{ role: 'chat', provider: 'openrouter', model: 'gpt-test' }],
    tools: overrides.tools || [{ name: 'chat', allowed: true }, { name: 'deploy', allowed: false }],
    voice: { voiceStyle: `${id}-official`, sampleRef: null, consentBy: 'djeff' },
    memoryPointers: [{ store: 'neo4j', address: `memory/${id}/canon`, checksum: 'pending' }],
    providers: [{ provider: 'suno', voiceIdRef: `secrets/persona/${id}-voice-id` }],
    behaviorTests: [{ id: 'identity', era: '2026-08', axis: 'identite', probe: 'qui es tu', expects: id }],
  });
  capsule.writeCapsule(vault, id, cap, pair);
}

function writeDiskProfile(runtime, id, profile) {
  const runtimeId = id === 'k44' ? 'kaen44' : id;
  const dir = path.join(runtime, 'personas', runtimeId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${runtimeId}-persona.profile.json`), JSON.stringify(profile), 'utf8');
}

beforeEach(() => {
  runner.resetPersonaAgentRevivalForTests();
});

test('une persona agent sans profil est dead et réanimable seulement avec un holocron signé', () => {
  const fixture = makeFixture(['vivy']);
  const inspection = runner.inspectAgentPersona('vivy', {
    env: fixture.env,
    vaultRoot: fixture.vault,
    now: Date.parse('2026-08-08T21:00:00.000Z'),
  });
  assert.equal(inspection.state, 'dead');
  assert.equal(inspection.recoverable, true);
  assert.equal(inspection.capsuleSigned, true);
  assert.equal(inspection.keyId, fixture.pair.keyId);
});

test('la résurrection restaure un overlay agent minimal sans voix payante et sans promotion', async () => {
  const fixture = makeFixture(['vivy']);
  const recovery = await runner.recoverAgentPersona('vivy', {
    env: fixture.env,
    vaultRoot: fixture.vault,
  });

  assert.equal(recovery.ok, true);
  assert.equal(recovery.state, 'RESTORED');
  assert.equal(recovery.promoted, false);
  assert.equal(recovery.voicePersonaRecovery, false);
  assert.equal(recovery.paidProviderTouched, false);

  const restored = registry.getPersonaRuntimeState('vivy');
  assert.equal(restored.state, 'RESTORED');
  assert.equal(restored.profile.active, true);
  assert.equal(restored.profile.boundaries.secretsEmbedded, false);
  assert.equal(restored.profile.boundaries.voicePersonaRecovery, false);
  assert.equal(restored.profile.boundaries.automaticPromotion, false);
  assert.equal(JSON.stringify(restored.profile).includes('voiceIdRef'), false);

  const live = personaEngine.loadPersonaState('vivy', fixture.env, { force: true });
  assert.equal(live.active, true);
  assert.equal(live.profile.status, 'RESTORED');
  assert.match(live.brief, /agent vivy/i);
});

test('une capsule altérée ne restaure rien et met en QUARANTINED', async () => {
  const fixture = makeFixture(['a11']);
  const identityPath = path.join(fixture.vault, 'a11', 'identity.json');
  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  identity.role = 'role falsifie';
  fs.writeFileSync(identityPath, JSON.stringify(identity), 'utf8');

  const inspection = runner.inspectAgentPersona('a11', { env: fixture.env, vaultRoot: fixture.vault });
  assert.equal(inspection.state, 'QUARANTINED');
  assert.equal(inspection.recoverable, false);
  assert.equal(inspection.capsuleSigned, false);

  const recovery = await runner.recoverAgentPersona('a11', { env: fixture.env, vaultRoot: fixture.vault });
  assert.equal(recovery.ok, false);
  assert.equal(recovery.state, 'QUARANTINED');
  assert.equal(registry.getPersonaRuntimeState('a11').state, 'QUARANTINED');
});

test('un secret en clair dans une capsule pourtant signée bloque la réhydratation', async () => {
  const fixture = makeFixture(['marvin']);
  writeHolocron(fixture.vault, 'marvin', fixture.pair, {
    models: [{ role: 'chat', provider: 'openrouter', model: 'gpt-test', token: 'interdit-en-clair' }],
  });
  const recovery = await runner.recoverAgentPersona('marvin', { env: fixture.env, vaultRoot: fixture.vault });
  assert.equal(recovery.ok, false);
  assert.equal(recovery.state, 'QUARANTINED');
  assert.equal(registry.getPersonaRuntimeState('marvin').state, 'QUARANTINED');
});

test('les clés de secret camelCase et les valeurs secrètes dans identity.note sont refusées', async () => {
  for (const field of ['apiKey', 'accessToken', 'clientSecret']) {
    assert.equal(hasInlineSecret({ [field]: 'valeur-secrete-123456' }), true, field);
  }
  assert.equal(hasInlineSecret({
    identity: { note: 'Jeton de secours: sk-proj-1234567890abcdef' },
  }), true);
  assert.equal(hasInlineSecret({
    identity: { note: 'Documenter les API keys et le token budget sans stocker de valeur.' },
  }), false);

  const fixture = makeFixture(['marvin']);
  writeHolocron(fixture.vault, 'marvin', fixture.pair, {
    note: 'identite canonique; accessToken=super-secret-value-123',
  });
  const recovery = await runner.recoverAgentPersona('marvin', { env: fixture.env, vaultRoot: fixture.vault });
  assert.equal(recovery.ok, false);
  assert.equal(recovery.state, 'QUARANTINED');
  assert.equal(registry.getPersonaRuntimeState('marvin').profile, null);
});

test('un holocron signé mais non canonique reste un brouillon et ne peut pas être auto-activé', async () => {
  const fixture = makeFixture(['vivy']);
  writeHolocron(fixture.vault, 'vivy', fixture.pair, { canonical: false });

  const recovery = await runner.recoverAgentPersona('vivy', { env: fixture.env, vaultRoot: fixture.vault });
  assert.equal(recovery.ok, false);
  assert.equal(recovery.state, 'QUARANTINED');
  const runtime = registry.getPersonaRuntimeState('vivy');
  assert.equal(runtime.state, 'QUARANTINED');
  assert.equal(runtime.profile, null);
  assert.equal(personaEngine.buildPersonaSystemPrompt('vivy', fixture.env), '');
});

test('K44 est restaurée dans le runtime canonique Kaen44 sans perdre son identité signée', async () => {
  const fixture = makeFixture(['k44']);
  const recovery = await runner.recoverAgentPersona('k44', { env: fixture.env, vaultRoot: fixture.vault });
  assert.equal(recovery.ok, true);
  assert.equal(recovery.runtimePersonaId, 'kaen44');
  const restored = registry.getPersonaRuntimeState('kaen44');
  assert.equal(restored.state, 'RESTORED');
  assert.equal(restored.profile.personaId, 'k44');
  assert.match(personaEngine.buildPersonaSystemPrompt('k44', fixture.env), /K44/i);
});

test('aucune clé synthétique nest générée quand lancre de confiance manque', () => {
  const fixture = makeFixture(['marvin']);
  const env = { ...fixture.env };
  delete env.FUNESTERIE_HOLOCRON_VERIFYING_KEY;
  delete env.FUNESTERIE_HOLOCRON_SIGNING_KEY;
  assert.equal(fs.existsSync(path.join(fixture.vault, '.keys')), false);

  const inspection = runner.inspectAgentPersona('marvin', { env, vaultRoot: fixture.vault });
  assert.equal(inspection.state, 'QUARANTINED');
  assert.equal(inspection.reason, 'trusted_verification_key_missing');
  assert.equal(fs.existsSync(path.join(fixture.vault, '.keys')), false);
});

test('un profil brouillon inactif nest jamais auto-approuvé comme sil était mort', async () => {
  const fixture = makeFixture(['djeff']);
  writeDiskProfile(fixture.runtime, 'djeff', {
    personaId: 'djeff',
    status: 'draft-awaiting-djeff',
    active: false,
    injectable_brief: 'brouillon',
  });

  const inspection = runner.inspectAgentPersona('djeff', { env: fixture.env, vaultRoot: fixture.vault });
  assert.equal(inspection.state, 'INACTIVE');
  assert.equal(inspection.recoverable, false);

  const sweep = await runner.runPersonaAgentRevivalSweep({ env: fixture.env, vaultRoot: fixture.vault });
  assert.equal(sweep.results.some((entry) => entry.personaId === 'djeff'), false);
  assert.equal(registry.getPersonaRuntimeState('djeff'), null);
});

test('dead ferme linjection Vivy avant dattendre une récupération lente', async () => {
  const fixture = makeFixture(['vivy']);
  assert.match(personaEngine.buildPersonaSystemPrompt('vivy', fixture.env), /repli canonique public minimal/i);

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const sweepPromise = runner.runPersonaAgentRevivalSweep({
    env: fixture.env,
    vaultRoot: fixture.vault,
    recover: async () => {
      await gate;
      return { ok: false, personaId: 'vivy', state: 'QUARANTINED', reason: 'test_stop' };
    },
  });

  assert.equal(registry.getPersonaRuntimeState('vivy').state, 'QUARANTINED');
  assert.equal(personaEngine.buildPersonaSystemPrompt('vivy', fixture.env), '');
  release();
  await sweepPromise;
});

test('QUARANTINED ferme aussi le fallback même quand la capsule nest pas récupérable', async () => {
  const fixture = makeFixture(['vivy']);
  const identityPath = path.join(fixture.vault, 'vivy', 'identity.json');
  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  identity.role = 'alteration non signee';
  fs.writeFileSync(identityPath, JSON.stringify(identity), 'utf8');
  assert.notEqual(personaEngine.buildPersonaSystemPrompt('vivy', fixture.env), '');

  await runner.runPersonaAgentRevivalSweep({ env: fixture.env, vaultRoot: fixture.vault });
  assert.equal(registry.getPersonaRuntimeState('vivy').state, 'QUARANTINED');
  assert.equal(personaEngine.buildPersonaSystemPrompt('vivy', fixture.env), '');
});

test('RECOVERING et QUARANTINED propagent un état blocked sans fallback voix dans le contexte agents', () => {
  const fixture = makeFixture(['vivy']);
  fixture.env.A11_PERSONA_DOCS_DIR = path.join(fixture.root, 'empty-docs');
  fixture.env.FUNESTERIE_REFERENCE_ROOT = path.join(fixture.root, 'empty-references');
  fs.mkdirSync(fixture.env.A11_PERSONA_DOCS_DIR, { recursive: true });
  fs.mkdirSync(fixture.env.FUNESTERIE_REFERENCE_ROOT, { recursive: true });

  for (const runtimeState of ['RECOVERING', 'QUARANTINED']) {
    registry.setPersonaRuntimeState('vivy', runtimeState, { reason: 'integration-test' });
    personaEngine.resetDjeffPersonaCache();
    const state = personaEngine.loadPersonaState('vivy', fixture.env, { force: true });
    assert.equal(state.active, false, runtimeState);
    assert.equal(state.blocked, true, runtimeState);
    assert.equal(state.source, 'runtime-block', runtimeState);
    assert.equal(state.brief, '', runtimeState);

    const context = personaEngine.buildAgentsPersonaContext(fixture.env, {
      force: true,
      personas: ['vivy'],
    });
    assert.doesNotMatch(context, /VIVY \(persona voix\)|Vivy: présence musicale/i, runtimeState);
  }
});

test('une quarantaine runtime invalide immédiatement un brief sain encore en cache', () => {
  const fixture = makeFixture(['vivy']);
  const cached = personaEngine.loadPersonaState('vivy', fixture.env, { force: true });
  assert.equal(cached.blocked, false);
  assert.notEqual(cached.brief, '');

  registry.setPersonaRuntimeState('vivy', 'QUARANTINED', { reason: 'cache-barrier-test' });
  const blocked = personaEngine.loadPersonaState('vivy', fixture.env);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.brief, '');
  assert.equal(personaEngine.buildPersonaSystemPrompt('vivy', fixture.env), '');
});

test('une capsule en quarantaine nest pas newer sans référence finie et la même capsule reste fermée', () => {
  const fixture = makeFixture(['vivy']);
  writeDiskProfile(fixture.runtime, 'vivy', {
    personaId: 'vivy',
    status: 'QUARANTINED',
    active: false,
    quarantinedAt: '2026-08-08T20:00:00.000Z',
  });

  const sameCapsule = runner.inspectAgentPersona('vivy', {
    env: fixture.env,
    vaultRoot: fixture.vault,
  });
  assert.equal(sameCapsule.state, 'QUARANTINED');
  assert.equal(sameCapsule.recoverable, false);

  writeHolocron(fixture.vault, 'vivy', fixture.pair, {
    snapshotAt: '2026-08-08T20:01:00.000Z',
  });
  const genuinelyNewerCapsule = runner.inspectAgentPersona('vivy', {
    env: fixture.env,
    vaultRoot: fixture.vault,
  });
  assert.equal(genuinelyNewerCapsule.state, 'QUARANTINED');
  assert.equal(genuinelyNewerCapsule.recoverable, true);

  writeDiskProfile(fixture.runtime, 'vivy', {
    personaId: 'vivy',
    status: 'QUARANTINED',
    active: false,
  });
  const missingReference = runner.inspectAgentPersona('vivy', {
    env: fixture.env,
    vaultRoot: fixture.vault,
  });
  assert.equal(missingReference.state, 'QUARANTINED');
  assert.equal(missingReference.recoverable, false);
});

test('le budget par passe restaure au plus une persona puis la suivante au passage suivant', async () => {
  const fixture = makeFixture(['vivy', 'a11']);
  const first = await runner.runPersonaAgentRevivalSweep({
    env: fixture.env,
    vaultRoot: fixture.vault,
    now: Date.parse('2026-08-08T21:00:00.000Z'),
  });
  assert.equal(first.results.filter((entry) => entry.ok).length, 1);

  const second = await runner.runPersonaAgentRevivalSweep({
    env: fixture.env,
    vaultRoot: fixture.vault,
    now: Date.parse('2026-08-08T21:01:00.000Z'),
  });
  assert.equal(second.results.filter((entry) => entry.ok).length, 1);
  assert.deepEqual(
    ['vivy', 'a11'].map((id) => registry.getPersonaRuntimeState(id)?.state),
    ['RESTORED', 'RESTORED']
  );
});

test('verrou et cooldown empêchent les campagnes concurrentes ou répétées', async () => {
  const fixture = makeFixture(['vivy']);
  let release;
  let calls = 0;
  const recoveryGate = new Promise((resolve) => { release = resolve; });
  const failingRecovery = async (id) => {
    calls += 1;
    await recoveryGate;
    registry.setPersonaRuntimeState(id, 'QUARANTINED', { reason: 'test_failure' });
    return { ok: false, personaId: id, state: 'QUARANTINED', reason: 'test_failure' };
  };
  const now = Date.parse('2026-08-08T21:00:00.000Z');
  const firstPromise = runner.runPersonaAgentRevivalSweep({ env: fixture.env, vaultRoot: fixture.vault, now, recover: failingRecovery });
  const concurrent = await runner.runPersonaAgentRevivalSweep({ env: fixture.env, vaultRoot: fixture.vault, now, recover: failingRecovery });
  assert.equal(concurrent.skipped, 'sweep_already_running');
  release();
  await firstPromise;
  assert.equal(calls, 1);

  const repeated = await runner.runPersonaAgentRevivalSweep({
    env: { ...fixture.env, A11_PERSONA_AGENT_REVIVE_QUARANTINED: '1' },
    vaultRoot: fixture.vault,
    now: now + 1_000,
    recover: failingRecovery,
  });
  assert.equal(repeated.results[0].skipped, 'cooldown');
  assert.equal(calls, 1);
});

test('le minuteur est singleton, planifie une passe boot et expose lobservabilité', () => {
  const fixture = makeFixture(['vivy']);
  let intervals = 0;
  let timeouts = 0;
  const handle = () => ({ unref() {} });
  const options = {
    env: fixture.env,
    setIntervalImpl: () => { intervals += 1; return handle(); },
    setTimeoutImpl: () => { timeouts += 1; return handle(); },
  };
  runner.ensurePersonaAgentRevivalSweep(options);
  runner.ensurePersonaAgentRevivalSweep(options);

  const status = runner.getPersonaAgentRevivalStatus();
  assert.equal(intervals, 1);
  assert.equal(timeouts, 1);
  assert.equal(status.timerArmed, true);
  assert.equal(status.bootPassScheduled, true);
  assert.equal(status.safeguards.singleton, true);
  assert.equal(status.safeguards.syntheticSecrets, false);
  assert.equal(status.safeguards.voicePersonaRecovery, false);
});
