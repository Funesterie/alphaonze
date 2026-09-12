'use strict';

/**
 * clip-credits.cjs — Crédits utilisateur pour les clips NOSSEN.
 *
 * DECISION DE DJEFF, 12/09/2026 : tout le monde paie ses clips en crédits, sauf
 * les admins ; prix = vrai coût Comfy x2 ; les crédits s'achètent en packs Stripe.
 * Cela revient sur le « tout gratuit » du 18/08 pour les clips.
 *
 * LE PRIX VIENT DU COUT REEL, PAS D'UNE GRILLE
 *
 * Un plan = une génération Seedance 2.0 Fast de 8 s, ~0,14 USD relevés sur le
 * compte. Le prix d'un clip est donc proportionnel à ses plans : 6 pour un Clip,
 * durée/8 pour un Full Clip. La marge x2 couvre les plans refusés puis relancés
 * (payés à Comfy, jamais facturés ici) et les frais Stripe, et laisse de quoi
 * renflouer le compte Comfy. Tout est réglable par variable, rien n'est figé.
 *
 * ON NE FACTURE QUE CE QUI EST LIVRE
 *
 * Au lancement, on RÉSERVE le prix estimé ; à la fin, on rend la différence avec
 * les plans réellement livrés. Un clip qui échoue est remboursé en entier, un
 * clip partiel au prorata. Une réservation n'est jamais augmentée après coup.
 *
 * UN SEUL REGISTRE, EN BASE
 *
 * Blue et green tournent en même temps pendant une bascule : un solde en fichier
 * serait écrit par deux processus. Le registre vit donc dans Postgres, en lignes
 * signées (+ achat, - réservation, + remboursement), et le solde est leur somme.
 * Chaque ligne a une référence UNIQUE : un webhook Stripe rejoué ou un
 * remboursement retenté ne crédite jamais deux fois. Les débits se font sous un
 * verrou par utilisateur : deux clips lancés à la même seconde ne dépensent pas
 * deux fois le même solde.
 */

function nombre(valeur, defaut) {
  const n = Number(valeur);
  return Number.isFinite(n) && n > 0 ? n : defaut;
}

const EUR_PAR_CREDIT = 0.10;
const SECONDES_PAR_PLAN = 8;
const PLANS_CLIP_NORMAL = 6;
// Full Clip sans durée connue : on réserve large (4 min), la différence revient.
const PLANS_FULL_SANS_DUREE = 30;
const PLANS_MAX = 45;

function tarif(env = process.env) {
  return {
    usdParPlan: nombre(env.NOSSEN_CLIP_USD_PAR_PLAN, 0.14),
    marge: nombre(env.NOSSEN_CLIP_MARGE, 2),
    eurParUsd: nombre(env.NOSSEN_CLIP_EUR_PAR_USD, 0.92),
    eurParCredit: EUR_PAR_CREDIT,
  };
}

/** Crédits dus pour un nombre de plans livrés. */
function creditsPourPlans(plans, env = process.env) {
  const n = Math.max(0, Math.floor(Number(plans) || 0));
  if (!n) return 0;
  const t = tarif(env);
  return Math.ceil((n * t.usdParPlan * t.eurParUsd * t.marge) / t.eurParCredit - 1e-9);
}

/** Plans attendus pour un lancement, avant de connaître la durée exacte. */
function plansEstimes({ fullDuration, dureeSecondes } = {}) {
  if (!fullDuration) return PLANS_CLIP_NORMAL;
  const d = Number(dureeSecondes);
  if (!Number.isFinite(d) || d <= 0) return PLANS_FULL_SANS_DUREE;
  return Math.max(1, Math.min(PLANS_MAX, Math.ceil(Math.min(d, 900) / SECONDES_PAR_PLAN)));
}

// Packs vendus. Le prix est calculé ici, jamais lu dans une requête du navigateur.
const PACKS = Object.freeze({
  decouverte: Object.freeze({ id: 'decouverte', credits: 100, eurCents: 1000, label: '100 crédits' }),
  createur: Object.freeze({ id: 'createur', credits: 300, eurCents: 3000, label: '300 crédits' }),
  studio: Object.freeze({ id: 'studio', credits: 600, eurCents: 6000, label: '600 crédits' }),
});

function packsPublics() {
  return Object.values(PACKS).map((p) => ({ id: p.id, credits: p.credits, eurCents: p.eurCents, label: p.label }));
}

/**
 * Ce qu'une session Stripe terminée doit créditer, ou null. La session vient d'un
 * webhook dont la signature a été vérifiée ; on revalide quand même le pack, le
 * paiement et le montant, pour qu'un pack renommé ou un prix changé ne crédite
 * jamais un montant que le client n'a pas payé.
 */
function creditDepuisSessionStripe(session) {
  const meta = (session && session.metadata) || {};
  if (meta.kind !== 'clip_credits') return null;
  const pack = PACKS[String(meta.pack || '')];
  const userId = String(meta.userId || session.client_reference_id || '').trim();
  if (!pack || !userId || !session.id) return null;
  if (session.payment_status !== 'paid') return null;
  if (Number(session.amount_total) !== pack.eurCents) return null;
  return { userId, credits: pack.credits, ref: `stripe:${session.id}`, reason: `achat_pack_${pack.id}` };
}

// ---------------------------------------------------------------------------
// Registre. Le magasin est injectable : Postgres en production, mémoire en test.

async function soldeVia(q, userId) {
  const r = await q.query('SELECT COALESCE(SUM(delta), 0)::int AS solde FROM clip_credit_ledger WHERE user_id = $1', [userId]);
  return Number(r.rows[0] && r.rows[0].solde) || 0;
}

async function insererVia(q, { userId, delta, reason, ref }) {
  const r = await q.query(
    'INSERT INTO clip_credit_ledger (user_id, delta, reason, ref) VALUES ($1, $2, $3, $4) ON CONFLICT (ref) DO NOTHING RETURNING id',
    [userId, delta, reason, ref]
  );
  return r.rowCount > 0;
}

function creerMagasinPostgres(db) {
  let schemaPret = null;
  const schema = () => {
    if (!schemaPret) {
      schemaPret = db.query(`CREATE TABLE IF NOT EXISTS clip_credit_ledger (
          id BIGSERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          delta INTEGER NOT NULL,
          reason TEXT NOT NULL,
          ref TEXT NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS clip_credit_ledger_user_idx ON clip_credit_ledger (user_id);`)
        .catch((error) => { schemaPret = null; throw error; });
    }
    return schemaPret;
  };
  return {
    async solde(userId) {
      await schema();
      return soldeVia(db, userId);
    },
    async avecVerrou(userId, travail) {
      await schema();
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`clip-credits:${userId}`]);
        const resultat = await travail({ solde: (u) => soldeVia(client, u), inserer: (l) => insererVia(client, l) });
        await client.query('COMMIT');
        return resultat;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

function creerMagasinMemoire() {
  const lignes = [];
  let file = Promise.resolve();
  const solde = async (userId) => lignes.filter((l) => l.userId === userId).reduce((s, l) => s + l.delta, 0);
  const inserer = async (ligne) => {
    if (lignes.some((l) => l.ref === ligne.ref)) return false;
    lignes.push({ ...ligne });
    return true;
  };
  return {
    lignes,
    solde,
    avecVerrou(_userId, travail) {
      const suite = file.then(() => travail({ solde, inserer }));
      file = suite.catch(() => {});
      return suite;
    },
  };
}

/** Réserve `credits` si le solde suffit. Ne débite jamais en dessous de zéro. */
async function reserver(magasin, { userId, credits, ref }) {
  return magasin.avecVerrou(userId, async (tx) => {
    const solde = await tx.solde(userId);
    if (solde < credits) return { ok: false, solde, requis: credits };
    const insere = await tx.inserer({ userId, delta: -credits, reason: 'reservation_clip', ref });
    return { ok: true, solde: insere ? solde - credits : solde, requis: credits };
  });
}

/** Crédite une fois pour toutes par référence (achat, remboursement). */
async function crediter(magasin, { userId, credits, ref, reason }) {
  if (!(credits > 0)) return { insere: false, solde: await magasin.solde(userId) };
  return magasin.avecVerrou(userId, async (tx) => {
    const insere = await tx.inserer({ userId, delta: credits, reason, ref });
    return { insere, solde: await tx.solde(userId) };
  });
}

// ABONNEMENTS (decision de Djeff, 12/09/2026) : l'argent du Premium renfloue Suno
// (la musique) et ne donne aucun crédit clip ; celui du Fondateur renfloue Suno
// ET Comfy : sa part Comfy devient 50 crédits clip par mois (~5 EUR sur ~10 EUR
// mensuels). La mensualité est versée au premier passage du mois, une seule fois
// grâce à sa référence ; les crédits non dépensés restent acquis.
function creditsFondateurParMois(env = process.env) {
  return Math.floor(nombre(env.NOSSEN_CLIP_CREDITS_FONDATEUR, 50));
}

function estFondateurActif(palier, maintenant = new Date()) {
  if (!palier) return false;
  const plan = String(palier.subscription_plan || '').toLowerCase();
  const tier = String(palier.account_tier || '').toLowerCase();
  if (plan !== 'founder' && tier !== 'founder') return false;
  if (palier.subscription_active !== true) return false;
  if (!palier.subscription_end_date) return true;
  const fin = new Date(palier.subscription_end_date);
  return !Number.isNaN(fin.getTime()) && fin > maintenant;
}

async function attribuerMoisFondateur(magasin, { userId, maintenant = new Date(), env = process.env }) {
  const mois = maintenant.toISOString().slice(0, 7);
  return crediter(magasin, {
    userId,
    credits: creditsFondateurParMois(env),
    ref: `fondateur:${userId}:${mois}`,
    reason: 'mensualite_fondateur',
  });
}

/** Ce qu'il faut rendre à la fin d'un clip, au vu des plans livrés. */
function aRembourser(reservation, plansLivres, env = process.env) {
  if (!reservation || !(reservation.credits > 0)) return 0;
  const du = Math.min(reservation.credits, creditsPourPlans(plansLivres, env));
  return reservation.credits - du;
}

module.exports = {
  EUR_PAR_CREDIT,
  PACKS,
  PLANS_CLIP_NORMAL,
  aRembourser,
  attribuerMoisFondateur,
  creditsFondateurParMois,
  estFondateurActif,
  creditDepuisSessionStripe,
  creditsPourPlans,
  creerMagasinMemoire,
  creerMagasinPostgres,
  crediter,
  packsPublics,
  plansEstimes,
  reserver,
  tarif,
};
