'use strict';

const { hasFullAccess, isFullAccessEmail } = require('../src/auth/full-access.cjs');

/**
 * Middleware pour vérifier l'abonnement actif
 * Bloque l'accès aux fonctionnalités premium (génération image/vidéo) pour les non-abonnés
 * Exception : les admins ont toujours accès
 */

/**
 * Vérifie si l'utilisateur a un abonnement actif ou est admin
 * @param {object} db - Instance PostgreSQL
 * @returns {Function} Middleware Express
 */
function createSubscriptionMiddleware(db) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role;

      // Les admins ont toujours accès
      if (userRole === 'admin' || hasFullAccess(req.user)) {
        return next();
      }

      if (!userId) {
        return res.status(401).json({
          error: 'Authentification requise',
          code: 'AUTH_REQUIRED',
        });
      }

      // Vérifier l'abonnement dans la DB
      const result = await db.query(
        'SELECT email, subscription_active, subscription_end_date FROM users WHERE id = $1',
        [userId]
      );

      const user = result.rows[0];

      if (user && isFullAccessEmail(user.email)) {
        if (!user.subscription_active) {
          await db.query(
            'UPDATE users SET subscription_active=true, subscription_end_date=NULL, updated_at=NOW() WHERE id=$1',
            [userId]
          );
        }
        return next();
      }

      if (!user) {
        return res.status(404).json({
          error: 'Utilisateur non trouvé',
          code: 'USER_NOT_FOUND',
        });
      }

      // Vérifier si l'abonnement est actif
      if (!user.subscription_active) {
        return res.status(403).json({
          error: 'Abonnement requis',
          message: 'Cette fonctionnalite necessite A11 Studio actif ou des credits de creation disponibles.',
          code: 'SUBSCRIPTION_REQUIRED',
          subscriptionUrl: '/api/subscription/create-checkout',
        });
      }

      // Vérifier si l'abonnement n'est pas expiré
      if (user.subscription_end_date && new Date(user.subscription_end_date) < new Date()) {
        return res.status(403).json({
          error: 'Abonnement expiré',
          message: 'Votre abonnement a expiré. Veuillez le renouveler.',
          code: 'SUBSCRIPTION_EXPIRED',
          subscriptionUrl: '/api/subscription/create-checkout',
        });
      }

      // Abonnement valide, continuer
      next();
    } catch (error) {
      console.error('[SubscriptionMiddleware] Erreur:', error);
      res.status(500).json({
        error: 'Erreur lors de la vérification de l\'abonnement',
        code: 'SUBSCRIPTION_CHECK_ERROR',
      });
    }
  };
}

module.exports = createSubscriptionMiddleware;
