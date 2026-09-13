'use strict';
/**
 * clip-router.cjs — Routes Express pour les clips NOSSEN.
 *
 * Routes :
 *   POST /api/mcp-bridge/clip/start  → lancer un clip (async, retourne jobId)
 *   GET  /api/mcp-bridge/clip/status/:id → statut d'un job
 *   GET  /api/mcp-bridge/clip/list → clips terminés
 *   GET  /api/mcp-bridge/clip/my-jobs → jobs de l'utilisateur
 */
const express = require('express');
const {
  ACTIVE_STATUSES,
  claimJob,
  createJob,
  createWorkerId,
  getJob,
  heartbeatJob,
  listJobs,
  listPublicClips,
  recordProviderPromptId,
} = require('./clip-jobs.cjs');
const { buildClipErrorInfo } = require('./clip-error-info.cjs');

const CLIP_WORKER_ID = createWorkerId();

function sanitizeJobDiagnostic(value, maxLength = 500) {
  return String(value || '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => {
      try {
        const url = new URL(raw.replace(/[),.;]+$/, ''));
        url.search = '';
        url.hash = '';
        return url.toString();
      } catch { return '[url masquée]'; }
    })
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[masqué]')
    .replace(/\b(api[_ -]?key|authorization|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[masqué]')
    .trim()
    .slice(0, maxLength);
}

// Valeurs du menu casting de la page NOSSEN. "auto" et le vide laissent le
// Director choisir ; tout le reste est une distribution explicite. Rien de ce qui
// arrive du navigateur n est repris tel quel.
function normaliserCasting(valeur) {
  const v = String(valeur == null ? '' : valeur).trim().toLowerCase().slice(0, 40);
  return /^[a-z0-9-]+$/.test(v) ? v : '';
}

function normaliserDistribution(multiVoice, casting) {
  const propres = (Array.isArray(multiVoice) ? multiVoice : [])
    .map((x) => String(x == null ? '' : x).trim().toLowerCase().slice(0, 30))
    .filter((x) => /^[a-z0-9-]+$/.test(x));
  if (propres.length) return [...new Set(propres)].slice(0, 16);
  // random-lead est tire au sort par la page avant l envoi : s il arrive tel
  // quel, il n a pas ete resolu, et on laisse le Director choisir.
  if (casting && casting !== 'auto' && casting !== 'random-lead') return [casting];
  return [];
}

const nodeCrypto = require('node:crypto');
const clipCredits = require('./clip-credits.cjs');
const comfySolde = require('./comfy-solde.cjs');
const clipAcces = require('./clip-acces.cjs');

// Rendu choisi sur la page : "film" (prises de vue reelles, le defaut depuis le
// 12/09/2026) ou "anime" (clip manga). Toute autre valeur retombe sur le film.
function normaliserRendu(valeur) {
  const v = String(valeur == null ? '' : valeur).trim().toLowerCase();
  return v === 'anime' || v === 'manga' ? 'anime' : 'film';
}

function createClipRouter({ verifyJWT, isAdmin, generateClipImpl, db = null, isAdminRequest = null, magasinCredits = null, stripeService = null, palierUtilisateur = null, lireSoldeComfy = null, lireIdentiteCompte = null } = {}) {
  const router = express.Router();
  // Registre des crédits (clip-credits.cjs). Sans base, un non-admin ne lance
  // rien : on échoue fermé plutôt que d'offrir des clips que Comfy facture.
  const magasin = magasinCredits || (db ? clipCredits.creerMagasinPostgres(db) : null);
  // Abonnement du compte, pour la mensualité Fondateur. id::text : la colonne
  // peut être un entier ou un uuid, l'identifiant du jeton est une chaîne.
  const lirePalier = palierUtilisateur || (db ? async (uid) => {
    const r = await db.query(
      'SELECT subscription_plan, account_tier, subscription_active, subscription_end_date FROM users WHERE id::text = $1 LIMIT 1',
      [uid]
    );
    return r.rows[0] || null;
  } : null);
  const attribuerFondateur = async (uid) => {
    if (!magasin || !lirePalier || !uid) return;
    try {
      if (clipCredits.estFondateurActif(await lirePalier(uid))) {
        await clipCredits.attribuerTrimestreFondateur(magasin, { userId: uid });
      }
    } catch (error) {
      console.warn('[clip-router] Mensualité Fondateur non attribuée:', sanitizeJobDiagnostic(error.message));
    }
  };
  const estAdmin = (req) => (typeof isAdminRequest === 'function'
    ? Boolean(isAdminRequest(req))
    : Boolean(req.user && (req.user.isAdmin === true || String(req.user.role || '').toLowerCase() === 'admin')));
  const idUtilisateur = (req) => {
    const u = req.user || (req.session && req.session.user) || {};
    return String(u.id || u.sub || '').trim();
  };
  const reglerCredits = (reservation, resultat) => {
    if (!reservation || !magasin) return;
    const plansLivres = resultat && Number(resultat.segments) > 0 ? Number(resultat.segments) : 0;
    const rendre = clipCredits.aRembourser(reservation, plansLivres);
    if (rendre <= 0) return;
    clipCredits.crediter(magasin, {
      userId: reservation.userId,
      credits: rendre,
      ref: `${reservation.ref}:remboursement`,
      reason: plansLivres ? 'remboursement_plans_non_livres' : 'remboursement_clip_echoue',
    }).catch((error) => console.error('[clip-router] Remboursement crédits impossible', reservation.ref, error.message));
  };

  // Réserve Comfy (13/09/2026) : le 12/09 un Full Clip s'est arrêté à 2/28 sur
  // « Payment Required », après avoir fait travailler Sol pour rien. On lit le
  // solde réel (comfy-solde.cjs) et on déduit ce que les clips en cours vont
  // encore consommer. Solde illisible = on ne sait pas, on ne bloque rien.
  const lireSolde = lireSoldeComfy || comfySolde.creerLecteurSolde();
  // Casting « Moi » : la fiche vidéo tirée de la photo du compte (fiche-compte.cjs).
  const lireIdentite = lireIdentiteCompte || ((user) => require('../fiche/fiche-compte.cjs').identiteClipDuCompte(user));
  const plansEnCours = () => {
    try {
      return listJobs({ limit: 200, raw: true })
        .filter((job) => ACTIVE_STATUSES.has(job.status))
        .reduce((total, job) => {
          const prevus = Number(job.totalSegments) || clipCredits.plansEstimes({ fullDuration: job.fullDuration });
          return total + Math.max(0, prevus - (Number(job.segments) || 0));
        }, 0);
    } catch (_) {
      return 0;
    }
  };
  const etatReserve = async (plans) => {
    let solde = null;
    try { solde = await lireSolde(); } catch (_) { solde = null; }
    if (!solde || !Number.isFinite(Number(solde.credits))) return null;
    // Les deux reserves voyagent avec la couverture : l'admin voit laquelle se vide.
    return {
      ...comfySolde.couverture({ plans, soldeCredits: solde.credits, plansEnCours: plansEnCours() }),
      mensuel: solde.mensuel ?? null,
      bonus: solde.bonus ?? null,
    };
  };

  // Avant un lancement : combien de plans, et la réserve Comfy suffit-elle ?
  // Le solde exact n'est montré qu'aux admins.
  router.get('/estimation', async (req, res) => {
    const fullDuration = req.query.full === '1' || req.query.full === 'true';
    const plans = clipCredits.plansEstimes({ fullDuration, dureeSecondes: Number(req.query.durationSeconds) || undefined });
    const admin = estAdmin(req);
    const reserve = await etatReserve(plans);
    res.json({
      ok: true,
      plans,
      creditsSite: admin ? 0 : clipCredits.creditsPourPlans(plans),
      reserve: reserve
        ? {
          connue: true,
          suffisant: reserve.suffisant,
          plansPossibles: reserve.plansPossibles,
          ...(admin ? { creditsDisponibles: reserve.creditsDisponibles, creditsNecessaires: reserve.creditsNecessaires } : {}),
        }
        : { connue: false },
    });
  });

  // Solde et tarifs, pour la page.
  router.get('/credits', async (req, res) => {
    const admin = estAdmin(req);
    const uid = idUtilisateur(req);
    let solde = null;
    if (!admin && uid) await attribuerFondateur(uid);
    if (!admin && uid && magasin) {
      try { solde = await magasin.solde(uid); } catch (error) {
        return res.status(503).json({ ok: false, error: 'CREDITS_INDISPONIBLES' });
      }
    }
    const reserveAdmin = admin ? await etatReserve(1) : null;
    res.json({
      ok: true,
      admin,
      solde,
      ...(reserveAdmin ? { reserveComfy: {
        credits: reserveAdmin.creditsDisponibles,
        plans: reserveAdmin.plansPossibles,
        mensuel: reserveAdmin.mensuel,
        bonus: reserveAdmin.bonus,
      } } : {}),
      tarif: {
        clip: clipCredits.creditsPourPlans(clipCredits.PLANS_CLIP_NORMAL),
        parPlan: clipCredits.creditsPourPlans(1),
        fullParMinute: clipCredits.creditsPourPlans(clipCredits.plansEstimes({ fullDuration: true, dureeSecondes: 60 })),
        eurParCredit: clipCredits.EUR_PAR_CREDIT,
        fondateurParTrimestre: clipCredits.creditsFondateurParTrimestre(),
      },
      packs: clipCredits.packsPublics(),
      achatPossible: Boolean(stripeServiceOuDefaut() && stripeServiceOuDefaut().isCreditCheckoutEnabled()),
    });
  });

  function stripeServiceOuDefaut() {
    if (stripeService) return stripeService;
    try { return require('../../lib/stripe-service.cjs'); } catch (_) { return null; }
  }

  // Achat d'un pack : renvoie l'adresse du paiement Stripe.
  router.post('/credits/checkout', express.json({ limit: '16kb' }), async (req, res) => {
    const uid = idUtilisateur(req);
    if (!uid) return res.status(401).json({ ok: false, error: 'CONNEXION_REQUISE' });
    const service = stripeServiceOuDefaut();
    if (!service || !service.isCreditCheckoutEnabled()) return res.status(503).json({ ok: false, error: 'PAIEMENT_INDISPONIBLE' });
    const pack = String((req.body && req.body.pack) || '');
    if (!clipCredits.PACKS[pack]) return res.status(400).json({ ok: false, error: 'PACK_INCONNU' });
    try {
      const u = req.user || {};
      const session = await service.createCreditPackSession(uid, u.email || null, { pack, returnUrl: req.body && req.body.returnUrl });
      res.json({ ok: true, url: session.url });
    } catch (error) {
      console.error('[clip-router] Checkout crédits:', sanitizeJobDiagnostic(error.message));
      res.status(502).json({ ok: false, error: 'PAIEMENT_INDISPONIBLE' });
    }
  });

  // Lancer un clip (authentification requise)
  router.post('/start', express.json({ limit: '512kb' }), async (req, res) => {
    const { songUrl, title, style, fullDuration, sections } = req.body;
    // La page NOSSEN envoie la distribution choisie (casting + multiVoice). Elle
    // etait jetee ici : aucun clip lance depuis le site ou le telephone ne recevait
    // d identite, et chaque plan reinventait le visage du personnage (constate par
    // Djeff le 12/09/2026 sur trois clips d affilee).
    const casting = normaliserCasting(req.body && req.body.casting);
    const castArtists = normaliserDistribution(req.body && req.body.multiVoice, casting);
    const render = normaliserRendu(req.body && req.body.render);
    if (!songUrl) return res.status(400).json({ ok: false, error: 'songUrl requis' });

    // Casting « Moi » (13/09/2026) : l'avatar de la fiche du compte joue le rôle
    // principal. Sans avatar, on refuse avant toute réservation.
    let identiteCompte = null;
    if (casting === 'moi') {
      try { identiteCompte = lireIdentite(req.user || (req.session && req.session.user) || null); } catch (_) { identiteCompte = null; }
      if (!identiteCompte) {
        return res.status(400).json({
          ok: false,
          error: 'AVATAR_MANQUANT',
          message: 'Crée d’abord ton avatar dans « Ma fiche » : une photo de toi suffit.',
        });
      }
    }

    // Réserve vide : on refuse AVANT de réserver des crédits et de faire
    // travailler le Director. Réserve basse : on lance, et on le dit.
    const plansDemandes = clipCredits.plansEstimes({ fullDuration, dureeSecondes: req.body && req.body.durationSeconds });
    const reserve = await etatReserve(plansDemandes);
    if (reserve && reserve.plansPossibles < 1) {
      return res.status(503).json({
        ok: false,
        error: 'RESERVE_VIDEO_VIDE',
        message: 'La réserve vidéo du studio est vide pour le moment : aucun clip ne peut être généré, et aucun crédit ne t’a été pris.',
      });
    }

    const user = req.user || (req.session && req.session.user) || {};

    // Crédits : tout le monde paie sauf les admins (decision du 12/09/2026).
    let reservation = null;
    if (!estAdmin(req)) {
      const uid = idUtilisateur(req);
      if (!uid) return res.status(401).json({ ok: false, error: 'CONNEXION_REQUISE', message: 'Connecte-toi pour lancer un clip.' });
      if (!magasin) return res.status(503).json({ ok: false, error: 'CREDITS_INDISPONIBLES', message: 'Crédits indisponibles pour le moment.' });
      await attribuerFondateur(uid);
      const plans = clipCredits.plansEstimes({ fullDuration, dureeSecondes: req.body && req.body.durationSeconds });
      const credits = clipCredits.creditsPourPlans(plans);
      const ref = `clip:${nodeCrypto.randomUUID()}`;
      let sortie;
      try {
        sortie = await clipCredits.reserver(magasin, { userId: uid, credits, ref });
      } catch (error) {
        console.error('[clip-router] Réservation crédits impossible:', sanitizeJobDiagnostic(error.message));
        return res.status(503).json({ ok: false, error: 'CREDITS_INDISPONIBLES', message: 'Crédits indisponibles pour le moment.' });
      }
      if (!sortie.ok) {
        return res.status(402).json({
          ok: false,
          error: 'CREDITS_INSUFFISANTS',
          message: `Il faut ${credits} crédits pour ce clip, tu en as ${sortie.solde}.`,
          requis: credits,
          solde: sortie.solde,
        });
      }
      reservation = { userId: uid, credits, ref, plans, solde: sortie.solde };
    }

    const job = createJob({
      songUrl,
      title,
      style,
      fullDuration,
      casting,
      render,
      creditsReserves: reservation ? reservation.credits : 0,
      creditRef: reservation ? reservation.ref : null,
      userId: user.id || user.sub || null,
      email: user.email || null,
    });

    // Lancer la génération en arrière-plan
    setImmediate(() => {
      runClipGeneration(job.id, { songUrl, title, style, fullDuration, sections, casting, castArtists, render, identiteCompte }, {
        workerId: CLIP_WORKER_ID,
        generateClipImpl,
      }).then((sortie) => {
        reglerCredits(reservation, sortie && sortie.result);
      }, (error) => {
        console.error('[clip-router] Job', job.id, 'erreur:', sanitizeJobDiagnostic(error.message));
        reglerCredits(reservation, null);
      });
    });

    res.json({
      ok: true,
      jobId: job.id,
      status: 'pending',
      ...(reservation ? { credits: { reserves: reservation.credits, solde: reservation.solde } } : {}),
      ...(reserve && !reserve.suffisant
        ? { avertissement: { code: 'RESERVE_VIDEO_BASSE', plans: reserve.plans, plansPossibles: reserve.plansPossibles } }
        : {}),
    });
  });

  // Statut d'un job
  router.get('/status/:id', (req, res) => {
    const job = getJob(req.params.id);
    if (!job) return res.status(404).json({ ok: false, error: 'Job introuvable' });
    res.json({
      ok: true,
      id: job.id,
      status: job.status,
      stage: job.stage,
      message: job.message || null,
      progress: job.progress,
      segments: job.segments,
      totalSegments: job.totalSegments,
      providerSegments: Array.isArray(job.providerSegments) ? job.providerSegments : [],
      title: job.title,
      error: job.error,
      errorInfo: job.errorInfo || null,
      outputUrl: job.outputUrl,
      outputFilename: job.outputFilename,
      partial: Boolean(job.partial),
      warning: job.warning || null,
      stale: Boolean(job.stale),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  });

  // Espace privé (13/09/2026) : cette liste publiait les clips de tout le monde.
  // Elle ne montre plus que la vitrine ; l'admin voit tout, avec l'auteur, pour
  // choisir ce qu'il y met (clip-acces.cjs).
  router.get('/list', (req, res) => {
    const admin = estAdmin(req);
    res.json({ ok: true, admin, clips: clipAcces.clipsVisibles({ admin }) });
  });

  // Les clips du compte connecté, visibles par lui seul.
  router.get('/mes-clips', (req, res) => {
    const user = req.user || (req.session && req.session.user) || null;
    res.json({ ok: true, clips: clipAcces.clipsDuCompte(user) });
  });

  // Vitrine : l'admin publie ou retire un clip.
  router.post('/vitrine', express.json({ limit: '4kb' }), (req, res) => {
    if (!estAdmin(req)) return res.status(403).json({ ok: false, error: 'ADMIN_REQUIS' });
    try {
      const vitrine = clipAcces.publierDansVitrine(req.body && req.body.filename, !(req.body && req.body.publier === false));
      res.json({ ok: true, vitrine: [...vitrine] });
    } catch (_) {
      res.status(400).json({ ok: false, error: 'NOM_INVALIDE' });
    }
  });

  // Mes jobs (authentifié)
  router.get('/my-jobs', (req, res) => {
    const user = req.user || (req.session && req.session.user) || {};
    const jobs = listJobs({
      userId: user.id || user.sub,
      email: user.email,
      limit: 20,
    });
    res.json({ ok: true, jobs });
  });

  return router;
}

/**
 * Exécute la génération d'un clip (appelé en arrière-plan).
 */
async function runClipGeneration(jobId, config, {
  workerId = CLIP_WORKER_ID,
  generateClipImpl,
} = {}) {
  const claimed = claimJob(jobId, workerId);
  if (!claimed) return { claimed: false };

  try {
    // Charger le générateur V2
    let generateClip = generateClipImpl;
    if (typeof generateClip !== 'function') {
      try {
        generateClip = require('./clip-generator-v2.cjs').generateClip;
      } catch (_) {
        try {
          generateClip = require('/app/src/clips/clip-generator-v2.cjs').generateClip;
        } catch (_2) {
          generateClip = require('/app/clip-generator-v2.cjs').generateClip;
        }
      }
    }

    // Callback explicite : aucune mutation globale de console, et chaque
    // événement renouvelle le lease du worker qui possède réellement ce job.
    const reportProgress = (event = {}) => {
      const payload = typeof event === 'string' ? { stage: event } : event;
      const stage = sanitizeJobDiagnostic(payload.stage || 'working', 80);
      let status = payload.status;
      if (!['validating', 'directing', 'generating', 'assembling'].includes(status)) {
        if (stage.startsWith('audio:')) status = 'validating';
        else if (stage.startsWith('director:')) status = 'directing';
        else if (stage === 'assembling') status = 'assembling';
        else status = 'generating';
      }
      const updates = { stage, status };
      if (Number.isFinite(Number(payload.progress))) {
        updates.progress = Math.max(0, Math.min(99, Math.round(Number(payload.progress))));
      }
      if (Number.isFinite(Number(payload.segments))) updates.segments = Math.max(0, Math.round(Number(payload.segments)));
      if (Number.isFinite(Number(payload.totalSegments))) {
        updates.totalSegments = Math.max(0, Math.round(Number(payload.totalSegments)));
      }
      if (payload.message) updates.message = sanitizeJobDiagnostic(payload.message);
      const persisted = payload.promptId !== undefined
        ? recordProviderPromptId(jobId, workerId, Number(payload.segmentIndex), payload.promptId, updates)
        : heartbeatJob(jobId, workerId, updates);
      if (!persisted) throw new Error('clip_job_lease_lost');
    };

    const result = await generateClip({ ...config, onProgress: reportProgress });

    const completed = heartbeatJob(jobId, workerId, {
      status: 'done',
      stage: result.partial ? 'complete:partial' : 'complete',
      progress: 100,
      outputUrl: result.url || null,
      outputFilename: result.filename || null,
      segments: result.segments || 0,
      totalSegments: result.requestedSegments || result.segments || 0,
      partial: Boolean(result.partial),
      warning: result.warning ? sanitizeJobDiagnostic(result.warning) : null,
      message: null,
    });
    if (!completed) throw new Error('clip_job_lease_lost');
    return { claimed: true, result };
  } catch (error) {
    const safeError = sanitizeJobDiagnostic(error.message) || 'clip_generation_failed';
    // Champ structuré ADDITIF (rétrocompatible) : le bandeau mobile expose
    // node_type + message lisible. On conserve `error` (chaîne) inchangé.
    const errorInfo = buildClipErrorInfo(safeError, { sanitize: (value) => sanitizeJobDiagnostic(value) });
    heartbeatJob(jobId, workerId, { status: 'error', stage: 'error', error: safeError, errorInfo });
    throw new Error(safeError);
  }
}

module.exports = { CLIP_WORKER_ID, buildClipErrorInfo, createClipRouter, normaliserCasting, normaliserDistribution, normaliserRendu, runClipGeneration, sanitizeJobDiagnostic };
