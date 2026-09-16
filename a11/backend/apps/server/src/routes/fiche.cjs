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

const ERREURS = Object.freeze({
  compte_inconnu: [401, 'Connecte-toi pour ouvrir ta fiche.'],
  consentement_manquant: [400, 'Coche le consentement pour envoyer ta photo.'],
  format_photo: [400, 'Photo en JPEG, PNG ou WebP.'],
  taille_photo: [400, 'Photo vide ou trop lourde (6 Mo maximum).'],
  trop_d_analyses: [429, `${fiche.ANALYSES_PAR_JOUR} analyses par jour maximum : réessaie demain.`],
  vision_indisponible: [503, 'L’analyse de photo est indisponible pour le moment.'],
  avatar_absent: [400, 'Crée d’abord ton avatar avec une photo.'],
  description_trop_courte: [400, 'Description trop courte.'],
});

function repondreErreur(res, error) {
  const code = error && error.message;
  const connue = ERREURS[code];
  if (connue) return res.status(connue[0]).json({ ok: false, error: code, message: connue[1] });
  console.warn('[fiche] erreur:', String(code || '').slice(0, 160));
  return res.status(502).json({ ok: false, error: 'FICHE_INDISPONIBLE', message: 'Analyse impossible pour le moment, réessaie dans un instant.' });
}

function createFicheRouter({ env = process.env, decrireImpl = null } = {}) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: fiche.TAILLE_PHOTO_MAX, files: 1 } });
  const utilisateur = (req) => req.user || null;

  router.get('/', (req, res) => {
    try {
      res.json({ ok: true, fiche: fiche.vuePublique(fiche.lireFiche(utilisateur(req), { env })), consentement: fiche.CONSENTEMENT_PHOTO });
    } catch (error) { repondreErreur(res, error); }
  });

  router.put('/', express.json({ limit: '8kb' }), (req, res) => {
    try {
      const corps = req.body || {};
      const maj = fiche.majFiche(utilisateur(req), { pseudo: corps.pseudo, videoPrompt: corps.videoPrompt, description: corps.description }, { env });
      res.json({ ok: true, fiche: fiche.vuePublique(maj) });
    } catch (error) { repondreErreur(res, error); }
  });

  router.post('/photo', (req, res, next) => {
    upload.single('photo')(req, res, (error) => {
      if (error) return res.status(400).json({ ok: false, error: 'taille_photo', message: ERREURS.taille_photo[1] });
      return next();
    });
  }, async (req, res) => {
    try {
      const resultat = await fiche.enregistrerPhoto(utilisateur(req), {
        image: req.file && req.file.buffer,
        mimeType: req.file && req.file.mimetype,
        consentement: req.body && req.body.consentement,
      }, { env, ...(decrireImpl ? { decrireImpl } : {}) });
      if (!resultat.ok) {
        return res.status(422).json({ ok: false, error: 'PHOTO_REFUSEE', message: resultat.raison, fiche: fiche.vuePublique(resultat.fiche) });
      }
      return res.json({ ok: true, fiche: fiche.vuePublique(resultat.fiche) });
    } catch (error) { return repondreErreur(res, error); }
  });

  router.get('/photo', (req, res) => {
    try {
      const photo = fiche.cheminPhoto(utilisateur(req), { env });
      if (!photo) return res.status(404).json({ ok: false, error: 'PHOTO_ABSENTE' });
      res.set('Cache-Control', 'private, no-store');
      res.type(photo.mimeType);
      return res.sendFile(photo.chemin);
    } catch (error) { return repondreErreur(res, error); }
  });

  router.delete('/photo', (req, res) => {
    try {
      res.json({ ok: true, fiche: fiche.vuePublique(fiche.supprimerAvatar(utilisateur(req), { env })) });
    } catch (error) { repondreErreur(res, error); }
  });

  return router;
}

module.exports = { createFicheRouter };
