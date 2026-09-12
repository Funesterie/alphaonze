'use strict';
/**
 * clip-error-info.cjs — Parseur PUR (sans express) du diagnostic d'erreur clip.
 *
 * Les erreurs de génération sont des CHAÎNES formées `<code>: <diagnostic>`
 * (ex. 'clip_video_generation_failed: ...' émis par clip-generator-v2.cjs).
 * Ce module extrait un `node_type` stable et le `message` détaillé associé
 * afin d'alimenter un bandeau d'erreur mobile lisible, tout en restant
 * requérable sans express (donc testable dans un sandbox sans registre npm).
 */

const DEFAULT_NODE_TYPE = 'clip_generation_failed';
// Le code précède le premier ': '. On accepte lettres minuscules, chiffres et '_'.
const NODE_TYPE_PREFIX = /^[a-z0-9_]+(?=:)/;

/**
 * Construit la structure {node_type, message} à partir d'un message déjà
 * assaini (ou d'un message brut ; l'appelant est libre de fournir une fonction
 * de sanitisation via `sanitize`).
 *
 * @param {string} rawMessage — le message d'erreur (idéalement déjà assaini)
 * @param {object} [options]
 * @param {(value: string) => string} [options.sanitize] — sanitiseur optionnel
 * @returns {{ node_type: string, message: string }}
 */
function buildClipErrorInfo(rawMessage, { sanitize } = {}) {
  const sanitizer = typeof sanitize === 'function' ? sanitize : (value) => String(value == null ? '' : value).trim();
  const cleaned = sanitizer(rawMessage);
  const match = cleaned.match(NODE_TYPE_PREFIX);
  if (match) {
    const nodeType = match[0];
    // Retire le préfixe '<code>:' et l'espace éventuel qui suit.
    const detail = cleaned.slice(nodeType.length + 1).replace(/^\s+/, '');
    return {
      node_type: nodeType,
      message: detail || cleaned,
    };
  }
  return {
    node_type: DEFAULT_NODE_TYPE,
    message: cleaned,
  };
}

module.exports = { buildClipErrorInfo, DEFAULT_NODE_TYPE };
