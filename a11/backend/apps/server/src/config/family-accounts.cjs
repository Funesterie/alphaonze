'use strict';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

const FAMILY_ADMIN_EMAILS = Object.freeze([
  'cellaurojeffrey@gmail.com',
  'jeffrey38330@gmail.com',
  'cellaurojeffrey_38@hotmail.com',
  'cellaurojeffrey@hotmail.com',
  'cellaurojeffrey@funesterie.onmicrosoft.com',
  'marvincellauro@gmail.com',
  'cellauromarvin@gmail.com',
  'giovannabrunetto@gmail.com',
  'bayetgerard@gmail.com',
  'jewitt.charlene@gmail.com',
  'charlenejewitt@gmail.com',
  'funeste38@gmail.com',
  'funesterie38@gmail.com',
  'boostro38@gmail.com',
]);

const FAMILY_VOICE_IDENTITIES = Object.freeze({
  djeff: Object.freeze({
    key: 'djeff',
    accountEmail: 'cellaurojeffrey@gmail.com',
    persona: 'djeff',
    label: 'Djeff',
    voiceStyle: 'djeff-rap',
    referencePath: 'voice-library/djeff-rap.wav',
    referenceStatus: 'ready-local-reference',
    note: 'Voix rap Djeff/Pignon, distincte de la voix officielle A11.',
  }),
  k44: Object.freeze({
    key: 'k44',
    accountEmail: 'giovannabrunetto@gmail.com',
    persona: 'kaen44',
    label: 'K44',
    voiceStyle: 'kaen44-official-french-narrator',
    referencePath: 'voice-library/kaen44-official-french-narrator.wav',
    referenceStatus: 'ready-local-reference',
    note: 'Voix officielle K44 rattachee au compte Giovanna.',
  }),
  a11: Object.freeze({
    key: 'a11',
    accountEmail: 'bayetgerard@gmail.com',
    persona: 'a11',
    label: 'A11',
    voiceStyle: 'a11-official-stern-french',
    referencePath: 'voice-library/a11-official-stern-french.wav',
    referenceStatus: 'awaiting-family-reference',
    note: 'Voix officielle A11 rattachee a Gerard; reference definitive a importer quand elle sera fournie.',
  }),
  vivy: Object.freeze({
    key: 'vivy',
    accountEmail: 'jewitt.charlene@gmail.com',
    persona: 'vivy',
    label: 'Vivy',
    voiceStyle: 'vivy-official-french-conversational',
    referencePath: 'voice-library/vivy.wav',
    referenceStatus: 'awaiting-family-reference',
    note: 'Voix officielle Vivy rattachee a Charlene; reference definitive a importer quand elle sera fournie.',
  }),
});

const PERSONAL_VOICE_POLICY = Object.freeze({
  persona: 'personal',
  label: 'Ma voix',
  minimumTier: 'premium',
  consent: 'voice-learning-v1',
  storageRule: 'Raw voice clips stay in private runtime storage and are never committed or served as public assets.',
  trainingRule: 'A connected premium, founder, or admin account may train only its own personal voice unless it is a family admin curating a mapped family persona.',
  deletionRule: 'The owner account can remove its collected corpus with delete-voice-learning-corpus.',
});

function uniqueEmails(values = []) {
  return [...new Set(values.map(normalizeEmail).filter(Boolean))];
}

function getFamilyAdminEmails() {
  return uniqueEmails(FAMILY_ADMIN_EMAILS);
}

function getFamilyVoiceIdentities() {
  return Object.values(FAMILY_VOICE_IDENTITIES);
}

function getFamilyVoiceIdentityByEmail(email) {
  const normalized = normalizeEmail(email);
  return getFamilyVoiceIdentities().find((identity) => normalizeEmail(identity.accountEmail) === normalized) || null;
}

function getFamilyVoiceIdentityByKey(key) {
  const normalized = String(key || '').trim().toLowerCase();
  return FAMILY_VOICE_IDENTITIES[normalized] || null;
}

function getFamilyVoiceIdentitiesForPersona(persona) {
  const normalized = String(persona || '').trim().toLowerCase();
  return getFamilyVoiceIdentities().filter((identity) => identity.persona === normalized);
}

function getOfficialVoiceSourceEmailsForPersona(persona) {
  return uniqueEmails(getFamilyVoiceIdentitiesForPersona(persona).map((identity) => identity.accountEmail));
}

module.exports = {
  FAMILY_ADMIN_EMAILS,
  FAMILY_VOICE_IDENTITIES,
  PERSONAL_VOICE_POLICY,
  normalizeEmail,
  getFamilyAdminEmails,
  getFamilyVoiceIdentities,
  getFamilyVoiceIdentityByEmail,
  getFamilyVoiceIdentityByKey,
  getFamilyVoiceIdentitiesForPersona,
  getOfficialVoiceSourceEmailsForPersona,
};
