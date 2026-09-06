'use strict';

/**
 * Auto-réanimation des personas AGENTS (Vivy, Djeff, Marvin, A11, K44...).
 *
 * À ne pas confondre avec `src/music/persona-revival-runner.cjs`, qui recrée une
 * voix Suno expirée et peut consommer des crédits. Ici aucun fournisseur vocal
 * n'est appelé : une identité d'agent morte est remise en mémoire depuis son
 * holocron signé, puis reste RESTORED (jamais PROMOTED sans Djeff GO).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');
const capsule = require('./persona-capsule.cjs');
const {
  fingerprintSignedAgentCapsule,
  readLatestFingerprint,
} = require('./persona-fingerprint.cjs');
const { runAgentCapsuleCanary } = require('./persona-canary.cjs');
const { rebindAgentProviders } = require('./persona-provider-rebind.cjs');
const { ETATS, runResurrection } = require('./persona-recovery-orchestrator.cjs');
const {
  getPersonaRuntimeState,
  listPersonaRuntimeStates,
  normalizePersonaId,
  resetPersonaRuntimeRegistryForTests,
  setPersonaRuntimeState,
} = require('./persona-runtime-registry.cjs');
const {
  isPersonaInjectEnabled,
  personaProfilePath,
  resetDjeffPersonaCache,
} = require('./persona-engine.cjs');

const STATUS_SCHEMA = 'funesterie.persona-agent-revival.status.v1';
const RESTORED_PROFILE_SCHEMA = 'funesterie.persona-agent-restored.v1';
const DEFAULT_PERSONA_IDS = Object.freeze(['vivy', 'djeff', 'marvin', 'a11', 'k44']);
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_STARTUP_DELAY_MS = 0;
const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const DEFAULT_ATTEMPT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_PER_RUN = 5;
const DEFAULT_MAX_ATTEMPTS = 2;
const STATE_SYMBOL = Symbol.for('funesterie.persona-agent-revival-runner.v1');
const DEAD_STATES = new Set(['dead', 'failed', 'broken', 'corrupt', 'offline', 'missing']);
const QUARANTINE_STATES = new Set(['quarantined', 'quarantine']);

function createState() {
  return {
    enabled: false,
    running: false,
    startedAt: null,
    timer: null,
    startupTimer: null,
    attempts: new Map(),
    personas: new Map(),
    lastSweep: null,
    lastRecovery: null,
  };
}

function runtimeState() {
  if (!globalThis[STATE_SYMBOL]) globalThis[STATE_SYMBOL] = createState();
  const state = globalThis[STATE_SYMBOL];
  if (!(state.attempts instanceof Map)) state.attempts = new Map();
  if (!(state.personas instanceof Map)) state.personas = new Map();
  return state;
}

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function envFlag(value, fallback = true) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw) return fallback;
  return !['0', 'false', 'off', 'no'].includes(raw);
}

function integerConfig(env, key, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number(env?.[key]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function resolveVaultRoot(env = process.env) {
  const explicit = String(env.FUNESTERIE_PERSONA_VAULT || '').trim();
  if (explicit) return path.resolve(explicit);
  const candidates = [
    path.join(getCanonicalRuntimeRoot(env), 'persona-vault'),
    path.resolve(process.cwd(), 'runtime', 'persona-vault'),
    path.resolve(__dirname, '..', '..', 'runtime', 'persona-vault'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function normalizeCapsuleId(value = '') {
  const id = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  return /^[a-z0-9-]{1,32}$/.test(id) ? id : '';
}

function configuredPersonaIds(env = process.env, vaultRoot = resolveVaultRoot(env)) {
  const configured = String(env.A11_PERSONA_AGENT_IDS || '')
    .split(/[;,\s]+/g)
    .map(normalizeCapsuleId)
    .filter(Boolean);
  let directories = [];
  try {
    directories = fs.readdirSync(vaultRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => normalizeCapsuleId(entry.name))
      .filter(Boolean);
  } catch {}
  return [...new Set([...DEFAULT_PERSONA_IDS, ...configured, ...directories])];
}

function readKeyMaterial(raw = '') {
  const candidate = String(raw || '').trim();
  if (!candidate) return '';
  if (candidate.includes('-----BEGIN')) return candidate;
  try {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return fs.readFileSync(candidate, 'utf8');
    }
  } catch {}
  return '';
}

/**
 * Résout une ancre de confiance existante. Contrairement à resolveSigningKey,
 * cette fonction ne génère JAMAIS de clé : si le coffre a perdu sa clé, on
 * met en quarantaine au lieu d'inventer un nouveau secret qui signerait le faux.
 */
function resolveTrustedVerificationKey(vaultRoot, env = process.env) {
  const candidates = [
    env.FUNESTERIE_HOLOCRON_VERIFYING_KEY,
    env.FUNESTERIE_HOLOCRON_SIGNING_KEY,
    path.join(vaultRoot, '.keys', 'holocron-ed25519.pem'),
  ];
  for (const candidate of candidates) {
    const material = readKeyMaterial(candidate);
    if (!material) continue;
    try {
      const publicKey = crypto.createPublicKey(material).export({ type: 'spki', format: 'pem' });
      const keyId = crypto.createHash('sha256').update(Buffer.from(publicKey, 'utf8')).digest('hex').slice(0, 16);
      return { publicKey, keyId };
    } catch {}
  }
  return null;
}

function normalizeProfileStatus(profile) {
  return String(profile?.status || profile?.state || profile?.validation || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

function readDiskProfile(personaId, env = process.env) {
  const runtimeId = normalizePersonaId(personaId);
  if (!runtimeId) return { exists: false, profile: null, error: 'persona_id_invalid' };
  const file = personaProfilePath(runtimeId, env);
  try {
    const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { exists: true, profile, error: null };
  } catch (error) {
    return {
      exists: false,
      profile: null,
      error: error?.code === 'ENOENT' ? 'profile_missing' : 'profile_unreadable',
    };
  }
}

function safeLatestFingerprint(vaultRoot, personaId) {
  try {
    return readLatestFingerprint(vaultRoot, personaId);
  } catch {
    return { state: 'QUARANTINED', error: 'fingerprint_unreadable' };
  }
}

function finiteTimestamp(value) {
  const parsed = typeof value === 'number' ? value : Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function profileQuarantineReferences(profile) {
  if (!profile || typeof profile !== 'object') return [];
  return [
    profile.quarantinedAt,
    profile.quarantineAt,
    profile.quarantine?.at,
    profile.statusAt,
    profile.updatedAt,
    profile.snapshotAt,
    profile.at,
  ];
}

function capsuleSnapshotIsNewer(holocron, references = []) {
  const capsuleAt = finiteTimestamp(holocron?.files?.['capsule.json']?.snapshotAt);
  if (capsuleAt == null) return false;
  const referenceTimes = (Array.isArray(references) ? references : [references])
    .map(finiteTimestamp)
    .filter((value) => value != null);
  // Sans borne temporelle vérifiable, « plus récent » n'a aucun sens : on
  // échoue fermé au lieu de recycler la même capsule après une quarantaine.
  if (!referenceTimes.length) return false;
  return capsuleAt > Math.max(...referenceTimes);
}

function verifyHolocron(vaultRoot, personaId, trustedKey) {
  if (!trustedKey) return { ok: false, error: 'trusted_verification_key_missing' };
  try {
    const verification = capsule.verifyCapsule(vaultRoot, personaId, trustedKey.publicKey);
    const holocron = capsule.readCapsule(vaultRoot, personaId);
    const cap = holocron.files?.['capsule.json'] || {};
    const identity = holocron.files?.['identity.json'] || {};
    const identityMatches = normalizeCapsuleId(cap.personaId) === personaId
      && normalizeCapsuleId(identity.personaId) === personaId;
    const trustedKeyMatches = verification.keyId === trustedKey.keyId;
    return {
      ok: verification.ok && identityMatches && trustedKeyMatches,
      error: verification.ok
        ? (!identityMatches ? 'holocron_persona_mismatch' : (!trustedKeyMatches ? 'holocron_untrusted_key' : null))
        : 'holocron_signature_or_checksum_invalid',
      verification,
      holocron,
      keyId: trustedKey.keyId,
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 180) };
  }
}

function publicInspection(record) {
  return {
    personaId: record.personaId,
    runtimePersonaId: record.runtimePersonaId,
    state: record.state,
    reason: record.reason || null,
    recoverable: record.recoverable === true,
    capsuleSigned: record.capsuleSigned === true,
    keyId: record.keyId || null,
    fingerprintState: record.fingerprintState || null,
    checkedAt: record.checkedAt,
  };
}

function inspectAgentPersona(personaId, { env = process.env, vaultRoot = resolveVaultRoot(env), now = Date.now() } = {}) {
  const id = normalizeCapsuleId(personaId);
  const checkedAt = nowIso(now);
  const runtimePersonaId = normalizePersonaId(id);
  if (!id || !runtimePersonaId) {
    return publicInspection({ personaId: id || String(personaId || ''), runtimePersonaId: '', state: 'UNAVAILABLE', reason: 'persona_id_invalid', checkedAt });
  }

  const registry = getPersonaRuntimeState(runtimePersonaId);
  const disk = readDiskProfile(runtimePersonaId, env);
  const profileStatus = normalizeProfileStatus(disk.profile);
  const profileActive = isPersonaInjectEnabled(disk.profile);
  const trustedKey = resolveTrustedVerificationKey(vaultRoot, env);
  const signed = verifyHolocron(vaultRoot, id, trustedKey);
  const fingerprint = signed.holocron ? safeLatestFingerprint(vaultRoot, id) : null;
  const fingerprintState = String(fingerprint?.state || '').toUpperCase() || null;
  const base = {
    personaId: id,
    runtimePersonaId,
    capsuleSigned: signed.ok,
    keyId: signed.keyId || null,
    fingerprintState,
    checkedAt,
  };

  if (!signed.ok) {
    if (registry?.state === 'RESTORED') {
      return publicInspection({ ...base, state: 'QUARANTINED', reason: signed.error, recoverable: false });
    }
    // Un holocron cassé dégrade la sauvegarde, mais n'abat pas une persona disque
    // encore saine. S'il faut réellement restaurer, on échoue fermé.
    if (profileActive && !DEAD_STATES.has(profileStatus) && !QUARANTINE_STATES.has(profileStatus)) {
      return publicInspection({ ...base, state: 'DEGRADED', reason: signed.error, recoverable: false });
    }
    return publicInspection({ ...base, state: 'QUARANTINED', reason: signed.error, recoverable: false });
  }

  if (registry?.state === 'RESTORED') {
    return publicInspection({ ...base, state: 'RESTORED', reason: 'runtime_holocron_overlay', recoverable: false });
  }

  if (registry?.state === 'RECOVERING') {
    return publicInspection({ ...base, state: 'RECOVERING', reason: registry.reason, recoverable: false });
  }

  const quarantineFromFingerprint = fingerprintState === 'QUARANTINED';
  const quarantineFromProfile = QUARANTINE_STATES.has(profileStatus);
  // Le sweep pose aussi une barrière QUARANTINED temporaire sur toutes les
  // personas mortes avant de respecter son budget par passe. Cette barrière
  // ferme l'injection, mais ne signifie pas que la capsule signée a déjà échoué.
  const pendingDeadBarrier = registry?.state === 'QUARANTINED'
    && registry.source === 'agent-revival-health-sweep'
    && (!disk.exists || DEAD_STATES.has(profileStatus));
  const quarantineFromRegistry = registry?.state === 'QUARANTINED' && !pendingDeadBarrier;
  if (quarantineFromRegistry || quarantineFromFingerprint || quarantineFromProfile) {
    const quarantineReferences = [
      fingerprint?.snapshotAt,
      quarantineFromRegistry ? registry.at : null,
      ...(quarantineFromProfile ? profileQuarantineReferences(disk.profile) : []),
    ];
    const newerCapsule = capsuleSnapshotIsNewer(signed.holocron, quarantineReferences);
    const explicitlyAllowed = envFlag(env.A11_PERSONA_AGENT_REVIVE_QUARANTINED, false);
    return publicInspection({
      ...base,
      state: 'QUARANTINED',
      reason: registry?.reason || (quarantineFromFingerprint ? 'fingerprint_quarantined' : 'profile_quarantined'),
      recoverable: newerCapsule || explicitlyAllowed,
    });
  }

  if (profileActive && !DEAD_STATES.has(profileStatus)) {
    return publicInspection({ ...base, state: 'RESTORED', reason: 'active_profile', recoverable: false });
  }

  if (!disk.exists || DEAD_STATES.has(profileStatus)) {
    return publicInspection({
      ...base,
      state: 'dead',
      reason: disk.error || `profile_${profileStatus || 'dead'}`,
      recoverable: true,
    });
  }

  // Brouillon/inactif n'est pas mort. L'auto-réanimation ne contourne jamais une
  // validation humaine simplement parce que `active` vaut false.
  return publicInspection({ ...base, state: 'INACTIVE', reason: `profile_${profileStatus || 'not_approved'}`, recoverable: false });
}

function buildRestoredAgentProfile(personaId, holocron, verification = {}) {
  const cap = holocron?.files?.['capsule.json'] || {};
  const identity = holocron?.files?.['identity.json'] || {};
  const models = holocron?.files?.['models.json']?.chain || [];
  const tools = holocron?.files?.['tools.json']?.permissions || [];
  const label = String(identity.label || cap.label || personaId).trim().slice(0, 120);
  const role = String(identity.role || cap.role || '').trim().slice(0, 600);
  const note = String(identity.note || '').trim().slice(0, 1000);
  const injectableBrief = [role ? `${label}: ${role}.` : label, note].filter(Boolean).join(' ').slice(0, 1600);
  return {
    schema: RESTORED_PROFILE_SCHEMA,
    personaId,
    status: 'RESTORED',
    active: true,
    approved: cap.official === true && identity.official === true && cap.canonical === true,
    restoredFromHolocron: {
      schemaVersion: cap.schemaVersion || null,
      snapshotAt: cap.snapshotAt || null,
      keyId: verification.keyId || null,
      canonical: cap.canonical === true,
    },
    identity_core: {
      publicNames: [label],
      role,
      tone: note,
    },
    injectable_brief: injectableBrief,
    model_bindings: models.filter((entry) => entry && typeof entry === 'object').map((entry) => ({
      modelRole: entry.role,
      provider: entry.provider,
      model: entry.model,
    })),
    tool_permissions: tools.filter((entry) => entry && typeof entry === 'object').map((entry) => ({
      name: entry.name,
      allowed: entry.allowed === true,
    })),
    boundaries: {
      signedCapsuleOnly: true,
      secretsEmbedded: false,
      voicePersonaRecovery: false,
      automaticPromotion: false,
    },
  };
}

function signedMemoryReferences(holocron) {
  const pointers = holocron?.files?.['memory-pointers.json']?.pointers;
  return (Array.isArray(pointers) ? pointers : []).map((pointer, index) => ({
    id: String(pointer?.id || pointer?.address || `${pointer?.store || 'memory'}:${index}`),
    checksum: pointer?.checksum || null,
  }));
}

async function recoverAgentPersona(personaId, {
  env = process.env,
  vaultRoot = resolveVaultRoot(env),
  now = Date.now(),
} = {}) {
  const id = normalizeCapsuleId(personaId);
  const runtimePersonaId = normalizePersonaId(id);
  const trustedKey = resolveTrustedVerificationKey(vaultRoot, env);
  const signed = verifyHolocron(vaultRoot, id, trustedKey);
  if (!signed.ok) {
    if (runtimePersonaId) {
      setPersonaRuntimeState(runtimePersonaId, 'QUARANTINED', { reason: signed.error, source: 'agent-revival' });
      resetDjeffPersonaCache();
    }
    return { ok: false, personaId: id, state: 'QUARANTINED', reason: signed.error };
  }

  const holocron = signed.holocron;
  let profile;
  try {
    profile = buildRestoredAgentProfile(id, holocron, signed.verification);
  } catch (error) {
    setPersonaRuntimeState(runtimePersonaId, 'QUARANTINED', {
      reason: `profile_rehydration_failed:${String(error?.message || error).slice(0, 120)}`,
      source: 'agent-revival',
      keyId: signed.keyId,
    });
    resetDjeffPersonaCache();
    return { ok: false, personaId: id, state: 'QUARANTINED', reason: 'profile_rehydration_failed' };
  }
  const fingerprint = fingerprintSignedAgentCapsule(holocron, id);
  const rebind = rebindAgentProviders(holocron);
  const canary = runAgentCapsuleCanary({ personaId: id, profile, fingerprint, rebind });
  const pointers = signedMemoryReferences(holocron);

  const result = await runResurrection(id, {
    freeze: async () => {
      setPersonaRuntimeState(runtimePersonaId, 'RECOVERING', {
        reason: 'signed_holocron_rehydration',
        source: 'agent-revival',
        keyId: signed.keyId,
      });
      resetDjeffPersonaCache();
      return { ok: true, routerLevel: true, activeColorChanged: false, scope: 'persona-runtime-registry' };
    },
    snapshot: async () => ({ ok: true, redacted: true, secrets: false, at: nowIso(now) }),
    restoreCode: async () => ({ ok: true, mode: 'current-verified-runtime', checkoutPerformed: false }),
    restoreMemory: async () => ({ ok: true, mode: 'signed-references-only', references: pointers.length }),
    rehydrate: async () => ({ ok: true, profile, pointeurs: pointers, carnets: pointers }),
    rebind: async () => ({ ok: rebind.toutesLiees, ...rebind }),
    fingerprint: async () => fingerprint,
    canary: async () => canary,
    djeffGo: async () => ({ go: false, automaticPromotion: false }),
    promotion: async () => ({ ok: false, holocronReecrit: false }),
  });

  if (result.etat === ETATS.RESTORED) {
    setPersonaRuntimeState(runtimePersonaId, 'RESTORED', {
      profile,
      source: 'signed-holocron',
      keyId: signed.keyId,
    });
    resetDjeffPersonaCache();
    return {
      ok: true,
      personaId: id,
      runtimePersonaId,
      state: ETATS.RESTORED,
      promoted: false,
      keyId: signed.keyId,
      fingerprint: fingerprint.state,
      canary: canary.state,
      rebind: rebind.toutesLiees,
      voicePersonaRecovery: false,
      paidProviderTouched: false,
    };
  }

  setPersonaRuntimeState(runtimePersonaId, 'QUARANTINED', {
    reason: result.raison || 'resurrection_refused',
    source: 'agent-revival',
    keyId: signed.keyId,
  });
  resetDjeffPersonaCache();
  return {
    ok: false,
    personaId: id,
    runtimePersonaId,
    state: ETATS.QUARANTINED,
    reason: result.raison || 'resurrection_refused',
    promoted: false,
  };
}

function attemptAllowance(personaId, env, now) {
  const state = runtimeState();
  let previous = state.attempts.get(personaId) || { count: 0, lastAttemptAt: 0, windowStartedAt: now };
  const cooldownMs = integerConfig(env, 'A11_PERSONA_AGENT_REVIVAL_COOLDOWN_MS', DEFAULT_COOLDOWN_MS, { min: 1_000 });
  const windowMs = integerConfig(env, 'A11_PERSONA_AGENT_REVIVAL_ATTEMPT_WINDOW_MS', DEFAULT_ATTEMPT_WINDOW_MS, { min: cooldownMs });
  const maxAttempts = integerConfig(env, 'A11_PERSONA_AGENT_REVIVAL_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS, { min: 1, max: 20 });
  if (now - previous.windowStartedAt >= windowMs) {
    previous = { count: 0, lastAttemptAt: 0, windowStartedAt: now };
    state.attempts.set(personaId, previous);
  }
  if (previous.count >= maxAttempts) return { allowed: false, reason: 'attempt_budget_exhausted' };
  if (previous.lastAttemptAt && now - previous.lastAttemptAt < cooldownMs) {
    return { allowed: false, reason: 'cooldown', retryInMs: cooldownMs - (now - previous.lastAttemptAt) };
  }
  return { allowed: true, previous };
}

function recordAttempt(personaId, now) {
  const state = runtimeState();
  const previous = state.attempts.get(personaId) || { count: 0, lastAttemptAt: 0, windowStartedAt: now };
  state.attempts.set(personaId, {
    count: previous.count + 1,
    lastAttemptAt: now,
    windowStartedAt: previous.windowStartedAt || now,
  });
}

async function runPersonaAgentRevivalSweep({
  env = process.env,
  vaultRoot = resolveVaultRoot(env),
  now = Date.now(),
  recover = recoverAgentPersona,
} = {}) {
  const state = runtimeState();
  if (state.running) return { skipped: 'sweep_already_running', treated: 0, results: [] };
  if (!envFlag(env.A11_PERSONA_AGENT_REVIVAL_ENABLED, true)) {
    state.enabled = false;
    return { skipped: 'disabled', treated: 0, results: [] };
  }

  state.running = true;
  state.enabled = true;
  const startedAt = nowIso(now);
  const results = [];
  try {
    const inspections = configuredPersonaIds(env, vaultRoot)
      .map((id) => inspectAgentPersona(id, { env, vaultRoot, now }));
    let registryChanged = false;
    for (const inspection of inspections) {
      state.personas.set(inspection.personaId, inspection);
      // DEAD et QUARANTINED ferment réellement l'injection dans persona-engine.
      // On pose la barrière avant le premier await de récupération : même une
      // tentative lente ou différée ne laisse jamais repasser le fallback Vivy.
      if (inspection.runtimePersonaId && (inspection.state === 'dead' || inspection.state === 'QUARANTINED')) {
        const registered = getPersonaRuntimeState(inspection.runtimePersonaId);
        if (registered?.state !== 'QUARANTINED') {
          setPersonaRuntimeState(inspection.runtimePersonaId, 'QUARANTINED', {
            reason: inspection.reason || `persona_${inspection.state}`,
            source: inspection.capsuleSigned === false
              ? 'agent-revival-integrity-sweep'
              : 'agent-revival-health-sweep',
            keyId: inspection.keyId,
          });
          registryChanged = true;
        }
      }
    }
    if (registryChanged) resetDjeffPersonaCache();

    const maxPerRun = integerConfig(env, 'A11_PERSONA_AGENT_REVIVAL_MAX_PER_RUN', DEFAULT_MAX_PER_RUN, { min: 1, max: 20 });
    const candidates = inspections.filter((entry) => entry.recoverable);
    let attemptedThisRun = 0;
    for (const inspection of candidates) {
      if (attemptedThisRun >= maxPerRun) break;
      const allowance = attemptAllowance(inspection.personaId, env, now);
      if (!allowance.allowed) {
        results.push({ personaId: inspection.personaId, ok: false, skipped: allowance.reason, retryInMs: allowance.retryInMs || null });
        continue;
      }
      recordAttempt(inspection.personaId, now);
      attemptedThisRun += 1;
      let recovery;
      try {
        recovery = await recover(inspection.personaId, { env, vaultRoot, now });
      } catch (error) {
        recovery = { ok: false, personaId: inspection.personaId, state: 'QUARANTINED', reason: String(error?.message || error).slice(0, 180) };
        setPersonaRuntimeState(inspection.runtimePersonaId, 'QUARANTINED', {
          reason: recovery.reason,
          source: 'agent-revival',
        });
        resetDjeffPersonaCache();
      }
      results.push(recovery);
      state.lastRecovery = {
        at: nowIso(now),
        personaId: inspection.personaId,
        ok: recovery.ok === true,
        state: recovery.state || null,
        reason: recovery.reason || null,
        promoted: recovery.promoted === true,
      };
      state.personas.set(inspection.personaId, inspectAgentPersona(inspection.personaId, { env, vaultRoot, now }));
    }

    state.lastSweep = {
      startedAt,
      finishedAt: nowIso(Date.now()),
      checked: inspections.length,
      candidates: candidates.length,
      treated: results.filter((entry) => !entry.skipped).length,
      restored: results.filter((entry) => entry.ok).length,
      quarantined: inspections.filter((entry) => entry.state === 'QUARANTINED').length,
      dead: inspections.filter((entry) => entry.state === 'dead').length,
      results: results.map((entry) => ({
        personaId: entry.personaId,
        ok: entry.ok === true,
        state: entry.state || null,
        skipped: entry.skipped || null,
        reason: entry.reason || null,
      })),
    };
    return { treated: state.lastSweep.treated, checked: inspections.length, candidates: candidates.length, results };
  } finally {
    state.running = false;
  }
}

function ensurePersonaAgentRevivalSweep({
  env = process.env,
  setIntervalImpl = setInterval,
  setTimeoutImpl = setTimeout,
} = {}) {
  const state = runtimeState();
  if (!envFlag(env.A11_PERSONA_AGENT_REVIVAL_ENABLED, true)) {
    state.enabled = false;
    return getPersonaAgentRevivalStatus();
  }
  state.enabled = true;
  if (state.timer) return getPersonaAgentRevivalStatus();
  state.startedAt = state.startedAt || nowIso();

  const intervalMs = integerConfig(env, 'A11_PERSONA_AGENT_REVIVAL_INTERVAL_MS', DEFAULT_INTERVAL_MS, { min: 15 * 60 * 1000 });
  const startupDelayMs = integerConfig(env, 'A11_PERSONA_AGENT_REVIVAL_STARTUP_DELAY_MS', DEFAULT_STARTUP_DELAY_MS, { min: 0, max: intervalMs });
  const sweep = () => {
    runPersonaAgentRevivalSweep({ env }).catch((error) => {
      const current = runtimeState();
      current.lastSweep = {
        startedAt: nowIso(),
        finishedAt: nowIso(),
        checked: 0,
        candidates: 0,
        treated: 0,
        restored: 0,
        quarantined: 0,
        dead: 0,
        error: String(error?.message || error).slice(0, 180),
        results: [],
      };
      console.warn('[PersonaAgentRevival] sweep failed: %s', current.lastSweep.error);
    });
  };

  state.timer = setIntervalImpl(sweep, intervalMs);
  state.timer?.unref?.();
  state.startupTimer = setTimeoutImpl(() => {
    runtimeState().startupTimer = null;
    sweep();
  }, startupDelayMs);
  state.startupTimer?.unref?.();
  return getPersonaAgentRevivalStatus();
}

function getPersonaAgentRevivalStatus() {
  const state = runtimeState();
  return {
    ok: true,
    schema: STATUS_SCHEMA,
    enabled: state.enabled,
    status: !state.enabled ? 'DISABLED' : (state.running ? 'RUNNING' : 'IDLE'),
    timerArmed: Boolean(state.timer),
    bootPassScheduled: Boolean(state.startupTimer),
    startedAt: state.startedAt,
    lastSweep: state.lastSweep ? JSON.parse(JSON.stringify(state.lastSweep)) : null,
    lastRecovery: state.lastRecovery ? JSON.parse(JSON.stringify(state.lastRecovery)) : null,
    personas: [...state.personas.values()].map((entry) => ({ ...entry })),
    runtimeStates: listPersonaRuntimeStates().map(({ profile, ...entry }) => ({ ...entry, hasRestoredProfile: Boolean(profile) })),
    safeguards: {
      singleton: true,
      lock: true,
      cooldown: true,
      attemptBudget: true,
      perSweepBudget: true,
      signedCapsuleOnly: true,
      syntheticSecrets: false,
      voicePersonaRecovery: false,
      automaticPromotion: false,
    },
  };
}

function resetPersonaAgentRevivalForTests() {
  const state = runtimeState();
  if (state.timer) clearInterval(state.timer);
  if (state.startupTimer) clearTimeout(state.startupTimer);
  globalThis[STATE_SYMBOL] = createState();
  resetPersonaRuntimeRegistryForTests();
  resetDjeffPersonaCache();
}

module.exports = {
  DEFAULT_COOLDOWN_MS,
  DEFAULT_ATTEMPT_WINDOW_MS,
  DEFAULT_INTERVAL_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_PER_RUN,
  DEFAULT_PERSONA_IDS,
  DEFAULT_STARTUP_DELAY_MS,
  RESTORED_PROFILE_SCHEMA,
  STATE_SYMBOL,
  STATUS_SCHEMA,
  buildRestoredAgentProfile,
  configuredPersonaIds,
  ensurePersonaAgentRevivalSweep,
  getPersonaAgentRevivalStatus,
  inspectAgentPersona,
  recoverAgentPersona,
  resetPersonaAgentRevivalForTests,
  resolveTrustedVerificationKey,
  resolveVaultRoot,
  runPersonaAgentRevivalSweep,
  verifyHolocron,
};
