'use strict';

/**
 * fiche.cjs — Routes de la fiche personnelle (13/09/2026), montées sur /api/fiche
 * derrière verifyJWT. Voir src/fiche/fiche-compte.cjs.
 *
 *   GET    /api/fiche        la fiche du compte (créée à la première visite)
 *   PUT    /api/fiche        { pseudo?, videoPrompt?, description? } -- corriger la fiche
 *   POST   /api/fiche/photo  multipart : photo + consentement=avatar-photo-v1
 *   GET    /api/fiche/photo  la photo, pour son propriétaire seulement
 *   DELETE /api/fiche/photo  efface la photo et l'avatar
 */

const express = require('express');
const multer = require('multer');
const fiche = require('../fiche/fiche-compte.cjs');
const { langueDeRequete, messageServeur } = require('../i18n/messages-serveur.cjs');

// Code d'erreur -> statut HTTP. Le texte vient de messages-serveur.cjs, dans la
// langue de la personne (16/09/2026) ; les codes restent stables.
const ERREURS = Object.freeze({
  compte_inconnu: 401,
  consentement_manquant: 400,
  format_photo: 400,
  taille_photo: 400,
  trop_d_analyses: 429,
  vision_indisponible: 503,
  avatar_absent: 400,
  description_trop_courte: 400,
});

function messageErreur(req, code) {
  return messageServeur(req, `fiche.${code}`, fiche.ANALYSES_PAR_JOUR);
}

// Les refus par défaut de fiche-compte sont en français ; une raison écrite par
// Gemini est déjà dans la langue demandée.
const REFUS_PAR_DEFAUT = Object.freeze({
  'Photo refusée : il faut un seul visage d’adulte, bien net.': 'fiche.photoRefusee',
  'Description inexploitable : essaie une autre photo, de face et bien éclairée.': 'fiche.descriptionInexploitable',
});

function repondreErreur(req, res, error) {
  const code = error && error.message;
  const statut = ERREURS[code];
  if (statut) return res.status(statut).json({ ok: false, error: code, message: messageErreur(req, code) });
  console.warn('[fiche] erreur:', String(code || '').slice(0, 160));
  return res.status(502).json({ ok: false, error: 'FICHE_INDISPONIBLE', message: messageServeur(req, 'fiche.indisponible') });
}

function createFicheRouter({ env = process.env, decrireImpl = null } = {}) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: fiche.TAILLE_PHOTO_MAX, files: 1 } });
  const utilisateur = (req) => req.user || null;

  router.get('/', (req, res) => {
    try {
      res.json({ ok: true, fiche: fiche.vuePublique(fiche.lireFiche(utilisateur(req), { env })), consentement: fiche.CONSENTEMENT_PHOTO });
    } catch (error) { repondreErreur(req, res, error); }
  });

  router.put('/', express.json({ limit: '8kb' }), (req, res) => {
    try {
      const corps = req.body || {};
      const maj = fiche.majFiche(utilisateur(req), { pseudo: corps.pseudo, videoPrompt: corps.videoPrompt, description: corps.description }, { env });
      res.json({ ok: true, fiche: fiche.vuePublique(maj) });
    } catch (error) { repondreErreur(req, res, error); }
  });

  router.post('/photo', (req, res, next) => {
    upload.single('photo')(req, res, (error) => {
      if (error) return res.status(400).json({ ok: false, error: 'taille_photo', message: messageErreur(req, 'taille_photo') });
      return next();
    });
  }, async (req, res) => {
    try {
      const resultat = await fiche.enregistrerPhoto(utilisateur(req), {
        image: req.file && req.file.buffer,
        mimeType: req.file && req.file.mimetype,
        consentement: req.body && req.body.consentement,
      }, { env, langue: langueDeRequete(req), ...(decrireImpl ? { decrireImpl } : {}) });
      if (!resultat.ok) {
        const cleRefus = REFUS_PAR_DEFAUT[resultat.raison];
        const message = cleRefus ? messageServeur(req, cleRefus) : resultat.raison;
        return res.status(422).json({ ok: false, error: 'PHOTO_REFUSEE', message, fiche: fiche.vuePublique(resultat.fiche) });
      }
      return res.json({ ok: true, fiche: fiche.vuePublique(resultat.fiche) });
    } catch (error) { return repondreErreur(req, res, error); }
  });

  router.get('/photo', (req, res) => {
    try {
      const photo = fiche.cheminPhoto(utilisateur(req), { env });
      if (!photo) return res.status(404).json({ ok: false, error: 'PHOTO_ABSENTE' });
      res.set('Cache-Control', 'private, no-store');
      res.type(photo.mimeType);
      return res.sendFile(photo.chemin);
    } catch (error) { return repondreErreur(req, res, error); }
  });

  router.delete('/photo', (req, res) => {
    try {
      res.json({ ok: true, fiche: fiche.vuePublique(fiche.supprimerAvatar(utilisateur(req), { env })) });
    } catch (error) { repondreErreur(req, res, error); }
  });

  return router;
}

module.exports = { createFicheRouter };
