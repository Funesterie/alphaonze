'use strict';

/**
 * Chat vocal avec Vivy — /api/vivy/voice-chat
 *
 * Djeff: « le chat vocal avec Vivy ca peut etre fun car ya beaucoup de gens qui veulent
 * lui parler [...] mais tu debloque ca que pour les compte fondateur/famille. »
 *
 * La boucle complete est faite ici, en un seul appel garde: micro -> transcription ->
 * reponse de Vivy. La restitution vocale reste au client, qui utilise /api/tts/speak.
 *
 * Le verrou est cote serveur, pas cote interface: masquer un bouton n'empeche personne
 * d'appeler la route. Chaque etape coute -- transcription facturable puis appel LLM --
 * donc la porte se ferme avant la depense, pas apres.
 *
 * Endpoints:
 *   GET  /api/vivy/voice-chat/access  — ce compte a-t-il le droit ?
 *   POST /api/vivy/voice-chat         — audio (multipart) -> transcription + reponse
 */

const express = require('express');
const multer = require('multer');

const { transcribe } = require('../../lib/stt-service.cjs');
const { ensureAnalyzableWav } = require('../tts/audio-intake.cjs');
const { getLogger } = require('../../lib/structured-logger.cjs');
const { getFamilyAdminEmails, normalizeEmail } = require('../config/family-accounts.cjs');

const logger = getLogger({ component: 'vivy-voice-chat' });

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MIN_AUDIO_BYTES = 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES },
});

/** Fondateur ou famille, d'apres la liste de reference du projet. */
function isFamilyVoiceUser(req) {
  const email = normalizeEmail(req?.user?.email);
  if (!email) return false;
  const admins = getFamilyAdminEmails();
  return Array.isArray(admins) ? admins.includes(email) : Boolean(admins?.has?.(email));
}

function createVivyVoiceChatRouter({ verifyJWT, buildVivyAiChat } = {}) {
  const router = express.Router();

  // Meme parti pris que pour la transcription: sans garde fournie, on refuse.
  const garde = typeof verifyJWT === 'function'
    ? verifyJWT
    : (_req, res) => res.status(503).json({ ok: false, error: 'auth_guard_missing' });

  function refuserSiNonFamille(req, res) {
    if (isFamilyVoiceUser(req)) return false;
    res.status(403).json({
      ok: false,
      error: 'voice_chat_restricted',
      message: 'Le chat vocal avec Vivy est réservé aux comptes fondateur et famille.',
    });
    return true;
  }

  // ── GET /api/vivy/voice-chat/access ───────────────────────────────────────
  // Permet a l'interface de n'afficher le bouton qu'aux ayants droit, sans que cet
  // affichage constitue la protection.
  router.get('/access', garde, (req, res) => {
    const autorise = isFamilyVoiceUser(req);
    return res.json({
      ok: true,
      allowed: autorise,
      reason: autorise ? '' : 'family_only',
      message: autorise ? '' : 'Réservé aux comptes fondateur et famille.',
    });
  });

  // ── POST /api/vivy/voice-chat ─────────────────────────────────────────────
  router.post('/', garde, upload.single('audio'), async (req, res) => {
    if (refuserSiNonFamille(req, res)) return;

    if (typeof buildVivyAiChat !== 'function') {
      return res.status(503).json({ ok: false, error: 'vivy_chat_unavailable' });
    }

    const buffer = req.file?.buffer;
    if (!buffer || buffer.length < MIN_AUDIO_BYTES) {
      return res.status(400).json({
        ok: false,
        error: 'missing_audio',
        message: 'Aucun audio exploitable. Envoie un champ "audio" en multipart/form-data.',
      });
    }

    const debut = Date.now();

    // Le navigateur enregistre en webm/opus. Whisper l'accepte mais doit le decoder,
    // et la transcription s'en ressent -- « c'est mon test » ressortait « c'est mon
    // temps ». On lui donne du WAV mono 16 kHz, sa frequence native. Si ffmpeg
    // echoue, on envoie l'original plutot que de perdre le tour.
    let audio = buffer;
    let typeAudio = req.file?.mimetype || 'audio/webm';
    try {
      const converti = await ensureAnalyzableWav(buffer, req.file?.originalname || 'voix.webm', process.env, { sampleRate: 16000 });
      if (converti?.ok && converti.buffer?.length) {
        audio = converti.buffer;
        typeAudio = 'audio/wav';
      }
    } catch (error) {
      logger.warn('Conversion WAV impossible, envoi de l original', { error: error?.message });
    }

    let transcription;
    try {
      transcription = await transcribe(audio, typeAudio, {
        language: String(req.body?.language || 'fr').trim() || 'fr',
      });
    } catch (error) {
      logger.error('Transcription du chat vocal impossible', { error: error?.message });
      return res.status(502).json({ ok: false, error: 'transcription_failed', message: error?.message });
    }

    const texte = String(transcription?.text || '').trim();
    if (!texte) {
      // Un blanc n'est pas une erreur: on le dit, et surtout on n'appelle pas le LLM
      // pour rien.
      return res.json({
        ok: true,
        transcript: '',
        reply: '',
        message: "Je n'ai rien entendu de clair. Réessaie plus près du micro.",
      });
    }

    try {
      const reponse = await buildVivyAiChat({
        message: texte,
        sessionId: String(req.body?.sessionId || '').trim() || undefined,
        conversationId: String(req.body?.conversationId || '').trim() || undefined,
        language: String(req.body?.language || 'fr').trim() || 'fr',
        shareToken: undefined,
      }, req);

      // Memes champs, meme ordre que la route de chat ecrite. Une premiere version
      // lisait reply/text/message: aucun n'existe, donc Vivy repondait dans le vide
      // alors que le modele avait bien tourne.
      const reply = String(
        reponse?.publicLyrics
        || reponse?.publicText
        || reponse?.assistant
        || reponse?.content
        || reponse?.summary
        || ''
      ).trim();
      // Le journal structure ne retenait que userId: sans les compteurs en clair,
      // impossible de voir qu'une reponse partait vide.
      console.info(
        '[VivyVoiceChat] audio=%s transcription=%s caracteres reponse=%s caracteres duree=%sms',
        typeAudio,
        texte.length,
        reply.length,
        Date.now() - debut
      );
      logger.info('Chat vocal Vivy', { userId: String(req.user?.id || '') });

      return res.json({
        ok: true,
        transcript: texte,
        language: transcription?.language || null,
        reply,
        session: reponse?.sessionId || reponse?.session || null,
      });
    } catch (error) {
      logger.error('Reponse Vivy impossible en vocal', { error: error?.message });
      return res.status(error?.status || 500).json({
        ok: false,
        error: error?.code || 'vivy_voice_chat_failed',
        message: error?.message || String(error),
      });
    }
  });

  return router;
}

module.exports = createVivyVoiceChatRouter;
module.exports.isFamilyVoiceUser = isFamilyVoiceUser;
