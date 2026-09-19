'use strict';

// Detecteurs des questions « est-ce que la voix marche ? ». Quand ils repondent
// vrai, le chat renvoie un texte tout fait (etat SIWIS ou voix officielle) AU
// LIEU de faire parler la persona.
//
// Avant le 19/09/2026 ils cherchaient des bouts de mots : « son » matchait
// « personne » ou « sont », « up » matchait « beaucoup », « ok » n'importe ou.
// Un recit envoye a K44 ressortait donc en « La voix officielle ne doit pas etre
// resumee a SIWIS… ». Mots entiers seulement, et messages courts seulement : une
// question sur l'etat de la voix ne fait jamais trois paragraphes.

const MAX_STATUS_QUESTION_CHARS = 180;

function fold(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

const ASKS_STATUS = /\b(?:marche|marchent|fonctionne|fonctionnent|dispo|disponible|status|statut|etat|up|down|ok|cass\w*|bug\w*|repond\w*|panne)\b/;

function isSiwisStatusQuestion(value) {
  const text = fold(value);
  if (!text || text.length > MAX_STATUS_QUESTION_CHARS) return false;
  const mentionsSiwis = /\b(?:siwis|piper|ttssiwis|tts)\b/.test(text);
  return mentionsSiwis && ASKS_STATUS.test(text);
}

function isOfficialVoiceStatusQuestion(value) {
  const raw = String(value || '').trim();
  if (!raw || isSiwisStatusQuestion(raw)) return false;
  // Les marqueurs d'import audio ([audio:fichier]) ne sont pas des questions.
  if (/^\[audio:/i.test(raw)) return false;
  const text = fold(raw);
  if (text.length > MAX_STATUS_QUESTION_CHARS) return false;
  const mentionsVoice = /\b(?:voix|voice|vocal|parle|parler|son)\b/.test(text);
  return mentionsVoice && ASKS_STATUS.test(text);
}

module.exports = {
  isSiwisStatusQuestion,
  isOfficialVoiceStatusQuestion,
  MAX_STATUS_QUESTION_CHARS,
};
