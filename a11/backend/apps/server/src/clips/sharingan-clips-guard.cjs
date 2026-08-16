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
 * @param {string} opts.stripeCheckoutUrl - Stripe payment link for clips (29.99€)
 * @param {string} opts.trollVideoPath - Full path to troll video (or null to use default in clipsDir)
 */
/**
 * Un lien de paiement, PAS une session.
 *
 * La valeur codee en dur ici etait `checkout.stripe.com/c/pay/cs_live_...`, donc
 * une Checkout Session. Une session Stripe expire en 24 h : le lendemain, tout
 * hotlinkeur etait redirige vers une page morte. Le piege avait l'air de
 * fonctionner -- il redirigeait bien -- mais il n'encaissait plus rien, et rien
 * ne le signalait.
 *
 * Un Payment Link (`buy.stripe.com/...`) est permanent et cree sa session a la
 * volee a chaque visite. C'est le bon outil pour une redirection posee une fois
 * et laissee en place. Le commentaire d'origine disait d'ailleurs « payment
 * link » : c'est l'intention qui etait juste, pas la valeur.
 */
function estLienDePaiementValide(url = '') {
  const u = String(url || '').trim();
  if (!/^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_-]+/.test(u)) return false;
  // Une session deguisee en lien passerait le test ci-dessus si elle etait
  // hebergee ailleurs; on refuse explicitement tout ce qui porte un cs_.
  return !/\bcs_(live|test)_/.test(u);
}

function createSharinganClipsGuard(opts = {}) {
  const {
    clipsDir = CLIPS_DIR,
    stripeCheckoutUrl = process.env.NOSSEN_CLIP_CHECKOUT_URL || '',
    trollVideoPath = null
  } = opts;

  const lienPaiement = estLienDePaiementValide(stripeCheckoutUrl) ? stripeCheckoutUrl : '';
  if (!lienPaiement) {
    // Bruyant au demarrage, une seule fois : un paywall muet qui laisse tout
    // passer coute plus cher qu'une ligne rouge dans les logs.
    console.warn(
      '[Sharingan] NOSSEN_CLIP_CHECKOUT_URL absent ou invalide.'
      + ' Attendu un Payment Link https://buy.stripe.com/... (permanent),'
      + ' pas une Checkout Session cs_live_... (expire en 24 h).'
      + ' Les hotlinks seront refuses en 402 au lieu d etre rediriges.'
    );
  }

  const trollPath = trollVideoPath || path.join(clipsDir, TROLL_VIDEO);

  return function sharinganGuard(req, res, next) {
    // Internal services always pass
    if (req.internalService) return next();

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

    // Hotlink externe sans authentification → la caisse.
    //
    // Sans lien valide on REFUSE au lieu de rediriger. Envoyer vers une page de
    // paiement morte, c'est offrir le clip a celui qui ferme l'onglet : il a le
    // fichier des que la redirection echoue cote client. Un 402 ne rapporte
    // rien non plus, mais il ne donne rien.
    if (!lienPaiement) {
      console.warn(`[Sharingan] Hotlink refuse (aucun lien de paiement configure): ${req.ip}`);
      return res.status(402).json({
        error: 'payment_required',
        message: 'Ce clip appartient a NOSSEN. Ecoute-le sur funesterie.me.',
      });
    }

    console.log(`[Sharingan] Paywall: ${req.ip} → lien de paiement`);
    return res.redirect(302, lienPaiement);
  };
}

module.exports = { createSharinganClipsGuard, isRipper, estLienDePaiementValide };
