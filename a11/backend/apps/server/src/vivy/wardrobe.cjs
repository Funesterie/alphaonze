'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');

const WARDROBE_SCHEMA = 'funesterie.vivy.wardrobe.v1';
const MAX_ACCESSORIES = 2;

// Règle canon Funesterie:
// Une tenue Vivy n'est jamais imposée. Elle est offerte.
// Vivy peut l'accepter, la refuser, la renommer, la découper ou la fusionner.

function wardrobePath(env = process.env) {
  return path.join(getCanonicalRuntimeRoot(env), 'vivy-wardrobe', 'wardrobe.json');
}

function foldText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function cleanLine(value = '', fallback = '', max = 200) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, max);
}

function cleanList(value, maxItems = 12, maxLen = 120) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanLine(item, '', maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeGift(input = {}) {
  const id = cleanLine(input.id, '', 80).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  if (!id) return null;
  return {
    type: 'vivy_wardrobe_gift',
    id,
    name: cleanLine(input.name, id, 120),
    offeredBy: cleanLine(input.offeredBy, 'Djeff', 80),
    intent: cleanLine(input.intent, '', 300),
    emotion: cleanLine(input.emotion, '', 160),
    energy: Math.max(0, Math.min(100, Number(input.energy ?? input.strength ?? 50) || 50)),
    risk: cleanLine(input.risk, '', 200),
    voice: cleanLine(input.voice, '', 200),
    sound: cleanList(input.sound),
    visual: cleanList(input.visual ?? input.colors),
    numa: cleanList(input.numa, 12, 12),
    rule: cleanLine(input.rule ?? input.balanceRule, '', 240),
    avoid: cleanList(input.avoid),
    tags: cleanList(input.tags, 16, 40).map(foldText),
    acceptance: {
      vivyCanAccept: input.acceptance?.vivyCanAccept !== false,
      vivyCanRefuse: input.acceptance?.vivyCanRefuse !== false,
      vivyCanModify: input.acceptance?.vivyCanModify !== false,
      vivyCanRename: input.acceptance?.vivyCanRename !== false,
    },
    status: 'offered',
    offeredAt: input.offeredAt || nowIso(),
  };
}

function createInitialWardrobe() {
  return {
    schema: WARDROBE_SCHEMA,
    updatedAt: nowIso(),
    canon: 'Une tenue Vivy n’est jamais imposée. Elle est offerte. Vivy peut l’accepter, la refuser, la renommer, la découper ou la fusionner.',
    gifts: [],
    outfits: [],
    decisions: [],
  };
}

function loadWardrobe(env = process.env) {
  const filePath = wardrobePath(env);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.schema === WARDROBE_SCHEMA) return parsed;
  } catch {}
  return createInitialWardrobe();
}

function saveWardrobe(wardrobe, env = process.env) {
  const filePath = wardrobePath(env);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = { ...wardrobe, updatedAt: nowIso() };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function offerWardrobeGift(giftInput = {}, env = process.env) {
  const gift = normalizeGift(giftInput);
  if (!gift) return { ok: false, error: 'gift_id_missing' };
  const wardrobe = loadWardrobe(env);
  if (wardrobe.gifts.some((entry) => entry.id === gift.id && entry.status === 'offered')
    || wardrobe.outfits.some((entry) => entry.giftId === gift.id)) {
    return { ok: false, error: 'gift_already_known', giftId: gift.id };
  }
  wardrobe.gifts.push(gift);
  saveWardrobe(wardrobe, env);
  return { ok: true, gift };
}

function recordWardrobeDecision(decisionInput = {}, env = process.env) {
  const giftId = cleanLine(decisionInput.giftId, '', 80).toLowerCase();
  const decision = cleanLine(decisionInput.decision, '', 24).toLowerCase();
  if (!giftId) return { ok: false, error: 'gift_id_missing' };
  if (!['accept', 'refuse', 'modify'].includes(decision)) {
    return { ok: false, error: 'decision_invalid', allowed: ['accept', 'refuse', 'modify'] };
  }
  const wardrobe = loadWardrobe(env);
  const gift = wardrobe.gifts.find((entry) => entry.id === giftId && entry.status === 'offered');
  if (!gift) return { ok: false, error: 'gift_not_offered', giftId };

  const record = {
    giftId,
    decision,
    reason: cleanLine(decisionInput.reason, '', 400),
    decidedAt: nowIso(),
    decidedBy: 'vivy',
  };
  gift.status = decision === 'refuse' ? 'refused' : 'adopted';
  wardrobe.decisions.push(record);

  if (decision !== 'refuse') {
    const changes = decisionInput.changes && typeof decisionInput.changes === 'object'
      ? decisionInput.changes
      : {};
    const outfit = {
      id: gift.id,
      giftId: gift.id,
      name: cleanLine(decisionInput.adoptedAs, gift.name, 120),
      emotion: cleanLine(changes.emotion, gift.emotion, 160),
      energy: Math.max(0, Math.min(100, Number(changes.energy ?? changes.strength ?? gift.energy) || gift.energy)),
      voice: cleanLine(changes.voice, gift.voice, 200),
      sound: cleanList(changes.sound).length ? cleanList(changes.sound) : gift.sound,
      visual: cleanList(changes.visual).length ? cleanList(changes.visual) : gift.visual,
      numa: gift.numa,
      rule: cleanLine(changes.rule, gift.rule, 240),
      avoid: cleanList(changes.avoid).length ? cleanList(changes.avoid) : gift.avoid,
      tags: gift.tags,
      added: cleanList(changes.added),
      adoptedAt: nowIso(),
      offeredBy: gift.offeredBy,
    };
    wardrobe.outfits = wardrobe.outfits.filter((entry) => entry.id !== outfit.id);
    wardrobe.outfits.push(outfit);
    saveWardrobe(wardrobe, env);
    return { ok: true, decision: record, outfit };
  }

  saveWardrobe(wardrobe, env);
  return { ok: true, decision: record };
}

function scoreOutfitAffinity(outfit, foldedSubject) {
  let score = 0;
  const haystackTokens = [
    ...(outfit.tags || []),
    ...(outfit.sound || []),
    ...(outfit.visual || []),
    outfit.emotion || '',
    outfit.name || '',
  ].map(foldText).filter(Boolean);
  for (const token of haystackTokens) {
    for (const word of token.split(/[^a-z0-9]+/).filter((part) => part.length >= 4)) {
      if (foldedSubject.includes(word)) score += 1;
    }
  }
  return score;
}

// Un mood principal + deux accessoires max. Sinon elle essaye de porter
// toute l'armoire en même temps.
function pickVivyOutfit({ subjectText = '', mood = '' } = {}, env = process.env) {
  const wardrobe = loadWardrobe(env);
  if (!wardrobe.outfits.length) return null;
  const foldedSubject = foldText(`${subjectText}\n${mood}`);
  const scored = wardrobe.outfits
    .map((outfit) => ({ outfit, score: scoreOutfitAffinity(outfit, foldedSubject) }))
    .sort((a, b) => b.score - a.score);
  if (!scored.length || scored[0].score <= 0) return null;
  const main = scored[0].outfit;
  const accessories = scored
    .slice(1)
    .filter((entry) => entry.score > 0)
    .slice(0, MAX_ACCESSORIES)
    .map((entry) => entry.outfit);
  return { main, accessories };
}

function buildOutfitBrief(selection) {
  if (!selection?.main) return '';
  const { main, accessories = [] } = selection;
  const parts = [
    `Tenue portée par Vivy: « ${main.name} » — ${main.emotion || 'état choisi par Vivy'}.`,
    main.voice ? `Voix: ${main.voice}.` : '',
    main.sound?.length ? `Couleur sonore: ${main.sound.join(', ')}.` : '',
    main.visual?.length ? `Couleurs visuelles: ${main.visual.join(', ')}.` : '',
    main.rule ? `Règle d’équilibre: ${main.rule}` : '',
    main.avoid?.length ? `À éviter: ${main.avoid.join(', ')}.` : '',
    accessories.length
      ? `Accessoires: ${accessories.map((entry) => `« ${entry.name} »`).join(' + ')} (touches légères, la tenue principale domine).`
      : '',
  ].filter(Boolean);
  return parts.join(' ');
}

function pickVivyOutfitBrief(input = {}, env = process.env) {
  try {
    const selection = pickVivyOutfit(input, env);
    if (!selection) return { brief: '', selection: null };
    return { brief: buildOutfitBrief(selection), selection };
  } catch {
    return { brief: '', selection: null };
  }
}

module.exports = {
  WARDROBE_SCHEMA,
  buildOutfitBrief,
  loadWardrobe,
  normalizeGift,
  offerWardrobeGift,
  pickVivyOutfit,
  pickVivyOutfitBrief,
  recordWardrobeDecision,
  saveWardrobe,
  wardrobePath,
};
