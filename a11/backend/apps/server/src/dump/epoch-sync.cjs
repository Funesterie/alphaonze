'use strict';
/**
 * EPOCH SYNC — Synchronisation horaire du circuit HENRY
 *
 * Tous les agents recalculent le même circuit à chaque nouvelle époque.
 * Une époque = une heure (HH:00:00 UTC).
 *
 * Le seed de l'époque combine :
 *   - l'identifiant de l'époque (date + heure)
 *   - un événement public aléatoire (quinté, loto, euromillions, ou Discord)
 *   - le sel privé du Vault (STEGO_SALT)
 *
 * Période de transition : pendant les 5 dernières minutes de l'ancienne époque,
 * l'ancien et le nouveau circuit fonctionnent ensemble. Les agents acceptent
 * les deux seeds (ancien et nouveau) pendant cette fenêtre.
 */

const crypto = require('node:crypto');
const { deriveKey, formatQuinte, formatLoto } = require('./quinte-key.cjs');

const EPOCH_DURATION_MS = 60 * 60 * 1000; // 1 hour
const TRANSITION_WINDOW_MS = 5 * 60 * 1000; // last 5 minutes of each epoch
const SEED_LENGTH = 32; // hex string length

// ─── Epoch identification ──────────────────────────────────────────────────

/**
 * Get the epoch ID for a given timestamp.
 * Format: "2026-08-04T20" (date + hour)
 * @param {Date} [date]
 * @returns {string}
 */
function epochId(date) {
  const d = date || new Date();
  return d.toISOString().slice(0, 13); // "2026-08-04T20"
}

/**
 * Get the previous epoch ID.
 * @param {Date} [date]
 * @returns {string}
 */
function previousEpochId(date) {
  const d = date || new Date();
  const prev = new Date(d.getTime() - EPOCH_DURATION_MS);
  return epochId(prev);
}

/**
 * Get the next epoch ID.
 * @param {Date} [date]
 * @returns {string}
 */
function nextEpochId(date) {
  const d = date || new Date();
  const next = new Date(d.getTime() + EPOCH_DURATION_MS);
  return epochId(next);
}

/**
 * Get the start time of an epoch.
 * @param {string} id — epoch ID
 * @returns {Date}
 */
function epochStart(id) {
  return new Date(id + ':00:00.000Z');
}

/**
 * Get the end time of an epoch.
 * @param {string} id — epoch ID
 * @returns {Date}
 */
function epochEnd(id) {
  return new Date(epochStart(id).getTime() + EPOCH_DURATION_MS);
}

/**
 * Check if we're in the transition window (last 5 minutes of the epoch).
 * @param {Date} [date]
 * @returns {boolean}
 */
function isInTransitionWindow(date) {
  const d = date || new Date();
  const end = epochEnd(epochId(d));
  const msToEnd = end.getTime() - d.getTime();
  return msToEnd <= TRANSITION_WINDOW_MS && msToEnd > 0;
}

// ─── Public event sources ──────────────────────────────────────────────────

/**
 * Resolve the public event seed for an epoch.
 *
 * The public event is an external random source that all parties can observe:
 *   - Quinté results (published after each race)
 *   - Loto results (published daily)
 *   - EuroMillions results (published Tue/Fri)
 *   - Discord channel message (published by a bot)
 *
 * For hours without a scheduled public event, we use the epoch ID itself
 * as a deterministic but unpredictable seed (no one knows future epoch IDs
 * in advance in a way that helps predict the seed, since the salt is private).
 *
 * @param {string} epoch — epoch ID
 * @param {object} [publicEvent] — optional public event data
 * @param {string} [publicEvent.type] — "quinte" | "loto" | "euromillions" | "discord" | "none"
 * @param {string} [publicEvent.numbers] — formatted numbers
 * @param {string} [publicEvent.channelId] — Discord channel ID
 * @param {string} [publicEvent.messageId] — Discord message ID
 * @returns {string} hex seed material
 */
function publicEventSeed(epoch, publicEvent) {
  if (!publicEvent || publicEvent.type === 'none') {
    // No public event for this epoch — use epoch ID as seed material
    return crypto.createHash('sha256').update(`epoch:${epoch}`).digest('hex');
  }

  const type = String(publicEvent.type || 'none');
  const numbers = String(publicEvent.numbers || '');
  const channelId = String(publicEvent.channelId || '');
  const messageId = String(publicEvent.messageId || '');

  const material = `${type}:${epoch}:${numbers}:${channelId}:${messageId}`;
  return crypto.createHash('sha256').update(material).digest('hex');
}

// ─── Seed derivation ────────────────────────────────────────────────────────

/**
 * Compute the circuit seed for an epoch.
 *
 * The seed is deterministic: same epoch + same public event + same salt = same seed.
 * It's unpredictable without the salt, even if the public event is known.
 *
 * @param {string} epoch — epoch ID
 * @param {object} [publicEvent] — public event data
 * @param {string} [salt] — private vault salt (defaults to env STEGO_SALT)
 * @returns {string} 32-byte hex seed
 */
function computeSeed(epoch, publicEvent, salt) {
  const effectiveSalt = salt || process.env.STEGO_SALT || process.env.A11_NEZ_TOKEN || 'funesterie-default';
  const publicMaterial = publicEventSeed(epoch, publicEvent);
  const hmac = crypto.createHmac('sha256', effectiveSalt);
  hmac.update(`${epoch}:${publicMaterial}`);
  return hmac.digest('hex').slice(0, SEED_LENGTH);
}

/**
 * Get the seed for the current epoch.
 * @param {object} [publicEvent]
 * @param {string} [salt]
 * @returns {string} hex seed
 */
function currentSeed(publicEvent, salt) {
  return computeSeed(epochId(), publicEvent, salt);
}

/**
 * Get the seed for the previous epoch.
 * @param {object} [publicEvent]
 * @param {string} [salt]
 * @returns {string} hex seed
 */
function previousSeed(publicEvent, salt) {
  return computeSeed(previousEpochId(), publicEvent, salt);
}

/**
 * Get the seeds that are currently valid (current + previous if in transition).
 * During the transition window, both old and new seeds are accepted.
 * @param {object} [publicEvent]
 * @param {object} [prevPublicEvent]
 * @param {string} [salt]
 * @returns {string[]} array of valid hex seeds
 */
function validSeeds(publicEvent, prevPublicEvent, salt) {
  const seeds = [currentSeed(publicEvent, salt)];
  if (isInTransitionWindow()) {
    seeds.push(previousSeed(prevPublicEvent, salt));
  }
  return seeds;
}

// ─── Circuit description ───────────────────────────────────────────────────

/**
 * Describe the circuit for an epoch.
 * This is the "map" of the RubixCube rotation for this epoch.
 *
 * @param {string} epoch — epoch ID
 * @param {object} [publicEvent]
 * @param {string} [salt]
 * @returns {object} circuit description
 */
function describeCircuit(epoch, publicEvent, salt) {
  const seed = computeSeed(epoch, publicEvent, salt);
  const { cubeRotation } = require('./rubix-cube.cjs');
  const rotation = cubeRotation(seed);
  const { pipelineAssignment, faceMap } = require('./rubix-cube.cjs');

  return {
    epoch,
    seed: seed.slice(0, 8) + '...', // truncated for display
    rotation,
    faceMap: faceMap(rotation),
    pipelines: pipelineAssignment(rotation),
    transition: isInTransitionWindow(),
    validUntil: epochEnd(epoch).toISOString(),
  };
}

/**
 * Get the current circuit description.
 * @param {object} [publicEvent]
 * @param {string} [salt]
 * @returns {object}
 */
function currentCircuit(publicEvent, salt) {
  return describeCircuit(epochId(), publicEvent, salt);
}

module.exports = {
  EPOCH_DURATION_MS,
  TRANSITION_WINDOW_MS,
  epochId,
  previousEpochId,
  nextEpochId,
  epochStart,
  epochEnd,
  isInTransitionWindow,
  publicEventSeed,
  computeSeed,
  currentSeed,
  previousSeed,
  validSeeds,
  describeCircuit,
  currentCircuit,
};
