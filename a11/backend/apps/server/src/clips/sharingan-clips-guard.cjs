'use strict';
/**
 * Sharingan Clips Guard — Anti-piracy + Paywall for Full Clips
 * 
 * 1. Detects bots/rippers via User-Agent + suspicious headers → serves troll video
 * 2. If user not authenticated and not internal → redirect to Stripe 29.99€ checkout
 * 3. Authenticated users / internal services pass through normally
 */

const path = require('path');
const { CLIPS_DIR } = require('./clip-storage.cjs');
const { estActif: estToutGratuit } = require('../auth/tout-gratuit.cjs');
const TROLL_VIDEO = 'sharingan_troll.mp4';

/**
 * Outils dont l'unique raison d'etre ici est d'aspirer un flux video.
 *
 * CE QUI A ETE RETIRE, ET POURQUOI — chaque entree suivante renvoyait le troll a
 * quelqu'un qu'on ne veut surtout pas troller :
 *
 *   discordbot, whatsapp, twitterbot, facebookexternalhit
 *     Robots d'apercu de lien. Ils passent quand NOUS partageons un clip. Leur
 *     servir le troll, c'est mettre le squelette en vignette de nos propres
 *     partages.
 *
 *   googlebot, bingbot, applebot, baiduspider, yandexbot, duckduckbot
 *     Moteurs de recherche. Leur servir autre chose qu'aux visiteurs porte un
 *     nom -- cloaking -- et se paie en desindexation. A eviter en toute saison,
 *     et particulierement pendant une verification Google en cours.
 *
 *   okhttp
 *     Client HTTP standard d'Android : la moitie des applications du telephone.
 *
 *   java/N, go-http-client, node-fetch, httpclient, axios/0.
 *     Bibliotheques generiques. Nos propres services les utilisent.
 *
 *   ffmpeg
 *     Sert autant a voler qu'a lire. Notre propre chaine de montage l'appelle.
 *
 *   grab
 *     Trop court : attrape « Instagram », entre autres.
 *
 * Ce qui reste ne se lance pas par accident.
 */
const RIPPER_PATTERNS = [
  /yt-dlp/i, /youtube-dl/i, /streamripper/i,
  /\bwget\b/i, /aria2/i, /scrapy/i, /python-urllib/i,
  /phantomjs/i, /selenium/i, /headlesschrome/i
];

function isRipper(req) {
  const ua = req.headers['user-agent'] || '';

  // Un User-Agent absent n'est PAS une preuve. Certains lecteurs embarques et
  // proxys d'entreprise n'en envoient pas, et l'en-tete se falsifie de toute
  // facon en une ligne : celui qui vole en met un. Punir son absence ne coute
  // qu'aux honnetes gens.
  if (RIPPER_PATTERNS.some(p => p.test(ua))) return true;

  // ANCIENNE REGLE SUPPRIMEE : « requete Range sans referer = aspiration ».
  // Safari demande TOUJOURS des Range pour une balise <video>, et n'envoie pas
  // de referer sous Referrer-Policy: no-referrer ni en navigation privee. La
  // regle servait donc le troll a des utilisateurs iPhone qui avaient paye.
  //
  // Le telechargement massif se mesure au DEBIT, pas a un en-tete : plusieurs
  // requetes Range disjointes sur le meme fichier depuis la meme IP en peu de
  // temps. Tant que ce compteur n'existe pas, mieux vaut ne rien conclure.
  return false;
}

/**
 * Mount the Sharingan guard on the clips route
 * @param {object} opts
 * @param {string} opts.clipsDir - Path to clips directory
 * @param {string} opts.landingUrl - Page funesterie.me où renvoyer un hotlink (jamais une URL Stripe)
 * @param {string} opts.trollVideoPath - Full path to troll video (or null to use default in clipsDir)
 */
/**
 * Aucune URL Stripe dans ce garde. Plus jamais.
 *
 * Historique en trois temps :
 *   1. une Checkout Session codee en dur (`checkout.stripe.com/.../cs_live_...`),
 *      qui expirait en 24 h et redirigeait ensuite vers une page morte ;
 *   2. un Payment Link (`buy.stripe.com/...`), permanent, donc toujours vivant ;
 *   3. ce meme Payment Link compromis -- et c'est la que le probleme se voit.
 *
 * Un Payment Link est une URL publique, permanente, non revocable autrement que
 * dans le tableau de bord Stripe, et posee ici a la vue de tous ceux qui
 * declenchent le paywall : c'est-a-dire, par construction, des gens qui aspirent
 * nos clips. Sa permanence, qui etait l'argument pour le choisir, est exactement
 * ce qui en fait une prise durable une fois qu'il fuit. Le Sharingan peut trier
 * les aspirateurs autant qu'il veut : tant qu'il tend lui-meme une adresse de
 * caisse permanente, le genjutsu ne protege rien.
 *
 * On ne redirige donc plus que vers NOTRE domaine. La page d'atterrissage, elle,
 * fabrique une session fraiche cote serveur quand un humain veut vraiment payer :
 * rien de permanent ne traine dehors.
 */
const DOMAINES_ATTERRISSAGE = /^https:\/\/([a-z0-9-]+\.)*funesterie\.me(\/|$)/i;

function estLienAtterrissageValide(url = '') {
  const u = String(url || '').trim();
  if (!DOMAINES_ATTERRISSAGE.test(u)) return false;
  // Ceinture et bretelles : une URL Stripe glissee dans la variable
  // d'atterrissage (redirection, parametre, sous-domaine bricole) est refusee.
  return !/stripe\.com|\bcs_(live|test)_/i.test(u);
}

function createSharinganClipsGuard(opts = {}) {
  const {
    clipsDir = CLIPS_DIR,
    landingUrl = process.env.NOSSEN_CLIP_LANDING_URL || 'https://funesterie.me/',
    trollVideoPath = null
  } = opts;

  const lienAtterrissage = estLienAtterrissageValide(landingUrl) ? landingUrl : '';
  if (!lienAtterrissage) {
    // Bruyant au demarrage, une seule fois : un paywall muet qui laisse tout
    // passer coute plus cher qu'une ligne rouge dans les logs.
    console.warn(
      '[Sharingan] NOSSEN_CLIP_LANDING_URL absent ou invalide.'
      + ' Attendu une URL funesterie.me (jamais une adresse Stripe).'
      + ' Les hotlinks seront refuses en 402 au lieu d etre rediriges.'
    );
  }
  if (String(process.env.NOSSEN_CLIP_CHECKOUT_URL || '').trim()) {
    console.warn(
      '[Sharingan] NOSSEN_CLIP_CHECKOUT_URL est encore definie et sera ignoree.'
      + ' Le Payment Link a ete demantele: desactive-le aussi dans Stripe.'
    );
  }

  const trollPath = trollVideoPath || path.join(clipsDir, TROLL_VIDEO);

  return function sharinganGuard(req, res, next) {
    // Internal services always pass
    if (req.internalService) return next();

    // Tout gratuit: il n'y a plus de caisse derriere la porte, donc plus de
    // raison de la fermer. Le tri des aspirateurs reste actif juste en dessous:
    // gratuit ne veut pas dire qu'on offre la bande passante a yt-dlp.
    if (estToutGratuit(process.env)) {
      if (isRipper(req)) {
        console.log(`[Sharingan] 🔴 Ripper detected (mode gratuit): ${req.headers['user-agent']?.slice(0, 50)} → troll video`);
        return res.sendFile(trollPath, (err) => {
          if (err && !res.headersSent) res.redirect(302, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        });
      }
      return next();
    }

    // Check for rippers → serve troll video
    if (isRipper(req)) {
      console.log(`[Sharingan] 🔴 Ripper detected: ${req.headers['user-agent']?.slice(0, 50)} → troll video`);
      return res.sendFile(trollPath, (err) => {
        if (err && !res.headersSent) {
          // If troll video doesn't exist, send a rickroll redirect
          res.redirect(302, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        }
      });
    }

    // Authenticated users pass through
    if (req.user && req.user.id) return next();

    // Check for valid session cookie (JWT)
    if (req.cookies && req.cookies.session) return next();

    // Not authenticated, not internal, not a ripper → paywall
    // But allow preview (first 5 seconds) if they have a referer from funesterie
    const referer = req.headers['referer'] || '';
    if (referer.includes('funesterie.me') || referer.includes('funesterie.')) {
      // Allow streaming from our own site (the player is on our page)
      return next();
    }

    // Hotlink externe sans authentification → chez nous, pas chez Stripe.
    //
    // Sans lien valide on REFUSE au lieu de rediriger. Envoyer vers une page
    // morte, c'est offrir le clip a celui qui ferme l'onglet : il a le fichier
    // des que la redirection echoue cote client. Un 402 ne rapporte rien non
    // plus, mais il ne donne rien.
    if (!lienAtterrissage) {
      console.warn(`[Sharingan] Hotlink refuse (aucune page d atterrissage configuree): ${req.ip}`);
      return res.status(402).json({
        error: 'payment_required',
        message: 'Ce clip appartient a NOSSEN. Ecoute-le sur funesterie.me.',
      });
    }

    console.log(`[Sharingan] Paywall: ${req.ip} → funesterie.me`);
    return res.redirect(302, lienAtterrissage);
  };
}

module.exports = { createSharinganClipsGuard, isRipper, estLienAtterrissageValide };
