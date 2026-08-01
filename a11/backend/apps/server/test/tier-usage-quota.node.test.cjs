'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.join(__dirname, '../src/auth/tier-usage-quota.cjs');
const { TIERS } = require(path.join(__dirname, '../src/auth/mcp-account-tier.cjs'));

function freshModule() {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('le quota LLM par defaut se consomme et finit par bloquer (basic = 5/jour)', () => {
  const quota = freshModule();
  const user = { id: 'user-basic-1' };

  for (let i = 0; i < 5; i += 1) {
    const check = quota.checkDefaultLlmQuota(user, TIERS.BASIC);
    assert.equal(check.ok, true, `le message ${i + 1} doit passer`);
    assert.equal(check.used, i);
    quota.recordDefaultLlmUsage(user, TIERS.BASIC);
  }

  const blocked = quota.checkDefaultLlmQuota(user, TIERS.BASIC);
  assert.equal(blocked.ok, false, 'le 6e message doit etre refuse');
  assert.equal(blocked.used, 5);
  assert.equal(blocked.limit, 5);
  assert.equal(blocked.remaining, 0);
});

test('les compteurs sont cloisonnes par utilisateur', () => {
  const quota = freshModule();
  const alice = { id: 'alice' };
  const bob = { id: 'bob' };

  for (let i = 0; i < 5; i += 1) quota.recordDefaultLlmUsage(alice, TIERS.BASIC);

  assert.equal(quota.checkDefaultLlmQuota(alice, TIERS.BASIC).ok, false, 'alice est a sec');
  assert.equal(quota.checkDefaultLlmQuota(bob, TIERS.BASIC).ok, true, 'bob ne doit pas payer pour alice');
});

test('admin_family n est jamais bloque', () => {
  const quota = freshModule();
  const admin = { id: 'djeff' };

  for (let i = 0; i < 500; i += 1) quota.recordDefaultLlmUsage(admin, TIERS.ADMIN_FAMILY);

  const check = quota.checkDefaultLlmQuota(admin, TIERS.ADMIN_FAMILY);
  assert.equal(check.ok, true);
  assert.equal(check.limit, Infinity);
  assert.equal(check.remaining, Infinity);
});

test('premium a un plafond plus haut que basic, founder plus haut que premium', () => {
  const quota = freshModule();
  const basic = quota.getTierUsageQuota(TIERS.BASIC).defaultLlmMessagesPerDay;
  const premium = quota.getTierUsageQuota(TIERS.PREMIUM).defaultLlmMessagesPerDay;
  const founder = quota.getTierUsageQuota(TIERS.FOUNDER).defaultLlmMessagesPerDay;

  assert.ok(basic < premium, 'basic doit etre sous premium');
  assert.ok(premium < founder, 'premium doit etre sous founder');
});

test('un tier inconnu retombe sur basic au lieu de devenir illimite', () => {
  const quota = freshModule();
  const check = quota.checkDefaultLlmQuota({ id: 'inconnu' }, 'tier_qui_nexiste_pas');
  assert.equal(check.limit, quota.getTierUsageQuota(TIERS.BASIC).defaultLlmMessagesPerDay);
  assert.notEqual(check.limit, Infinity, 'un tier inconnu ne doit jamais ouvrir un acces illimite');
});

test('la reponse de depassement ne fuite aucun secret et porte le nudge d abonnement', () => {
  const quota = freshModule();
  const user = { id: 'user-quota' };
  for (let i = 0; i < 5; i += 1) quota.recordDefaultLlmUsage(user, TIERS.BASIC);

  const body = quota.buildQuotaExceededResponse(quota.checkDefaultLlmQuota(user, TIERS.BASIC));
  assert.equal(body.ok, false);
  assert.equal(body.code, 'QUOTA_EXCEEDED');
  assert.equal(body.quota.scope, 'default_llm');
  assert.ok(body.upgradeUrl, 'une porte de sortie vers l abonnement doit etre proposee');
  assert.match(JSON.stringify(body), /^[^]*$/);
  assert.equal(/sk-|Bearer |password|token=/i.test(JSON.stringify(body)), false, 'aucun secret dans la reponse');
});

test('le fair-use des ressources a cle user est distinct du quota LLM', () => {
  const quota = freshModule();
  const user = { id: 'user-premium' };

  for (let i = 0; i < 20; i += 1) quota.recordDefaultLlmUsage(user, TIERS.PREMIUM);

  assert.equal(quota.checkDefaultLlmQuota(user, TIERS.PREMIUM).ok, false, 'le LLM par defaut est epuise');
  assert.equal(
    quota.checkFairUseQuota('suno', user, TIERS.PREMIUM).ok,
    true,
    'Suno tourne sur la cle de l utilisateur: son quota ne doit pas suivre celui du LLM',
  );
});
