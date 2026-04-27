-- Migration : Ajout des colonnes d'abonnement Stripe
-- Date : 2026-04-27
-- Description : Ajoute les colonnes nécessaires pour gérer les abonnements Stripe

-- Ajouter les colonnes si elles n'existent pas déjà
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255) UNIQUE,
ADD COLUMN IF NOT EXISTS subscription_active BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Index pour améliorer les performances des requêtes
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_subscription_active ON users(subscription_active);

-- Mettre à jour les admins existants pour qu'ils aient un accès illimité
UPDATE users 
SET subscription_active = TRUE 
WHERE role = 'admin' AND subscription_active IS NULL;

-- Commentaires
COMMENT ON COLUMN users.stripe_customer_id IS 'ID client Stripe pour gérer l''abonnement';
COMMENT ON COLUMN users.subscription_active IS 'Indique si l''utilisateur a un abonnement actif';
COMMENT ON COLUMN users.subscription_end_date IS 'Date de fin de l''abonnement en cours';
