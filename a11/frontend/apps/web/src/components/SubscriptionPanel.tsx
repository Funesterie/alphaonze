import React, { useEffect, useState } from 'react';
import { 
  getSubscriptionStatus, 
  createCheckoutSession, 
  createCustomerPortal,
  type SubscriptionStatus 
} from '../lib/api';

interface SubscriptionPanelProps {
  isAdmin: boolean;
  onClose?: () => void;
  productName?: string;
}

const A11_STUDIO_PLAN = {
  name: 'A11 Studio',
  price: '9 EUR',
  period: 'par mois',
  includedTokens: 'Chat long + 120 credits creation inclus',
};

const STUDIO_FEATURES = [
  'Chat court accessible, chat long protege par abonnement leger',
  'Credits mensuels pour images, videos courtes, audio et exports',
  'A11 choisit automatiquement le meilleur pipeline selon la source partagee',
  'Annulable a tout moment depuis le portail client',
];

const CONTRIBUTION_REWARDS = [
  '+10 a +40 credits pour un retour utile, reproductible ou bien annote',
  '+100 a +300 credits pour un dataset, prompt, correction ou cas metier qui ameliore A11',
  'Attribution apres score de pertinence, pas de revente ni publication automatique des apports',
];

const BLUEPRINT_OFFER = {
  price: '85 000 EUR+',
  label: 'Blueprint source qualifie',
  detail: 'Source, orchestration, memoire, runbook, transfert technique et cadrage de deploiement.',
};

const SALES_CONTACT_EMAIL = 'cellaurojeffrey@gmail.com';
const WERO_PHONE = String(import.meta.env.VITE_A11_WERO_PHONE || '').trim();
const RIB_DOCUMENT_URL = String(import.meta.env.VITE_A11_RIB_URL || '').trim();
const PAYPAL_URL = String(import.meta.env.VITE_A11_PAYPAL_URL || '').trim();
const PAYPAL_EMAIL = String(import.meta.env.VITE_A11_PAYPAL_EMAIL || '').trim();

function buildBlueprintContactLink() {
  return `mailto:${SALES_CONTACT_EMAIL}?subject=${encodeURIComponent('Qualification Blueprint A11')}&body=${encodeURIComponent(
    'Bonjour,\n\nJe souhaite qualifier une licence Blueprint A11.\n\nOrganisation:\nBesoin:\nBudget:\nDelai:\n\nMerci.'
  )}`;
}

function buildPaymentContactLink() {
  return `mailto:${SALES_CONTACT_EMAIL}?subject=${encodeURIComponent('Paiement A11 Studio')}&body=${encodeURIComponent(
    'Bonjour,\n\nJe souhaite payer A11 Studio.\n\nCompte A11 / email:\nMoyen prefere: Stripe / Wero / virement / PayPal\nReference:\n\nMerci.'
  )}`;
}

function formatFrenchPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 10) return value;
  return digits.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
}

function openExternal(url: string) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function SubscriptionPanel({ isAdmin, onClose, productName = 'A11' }: SubscriptionPanelProps) {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('');

  useEffect(() => {
    loadSubscriptionStatus();
  }, []);

  async function loadSubscriptionStatus() {
    setLoading(true);
    setError('');
    try {
      const data = await getSubscriptionStatus();
      setStatus(data);
    } catch (err) {
      setError((err as Error).message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubscribe() {
    setActionLoading(true);
    setError('');
    try {
      const data = await createCheckoutSession();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      setError((err as Error).message || 'Erreur lors de la souscription');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleManageSubscription() {
    setActionLoading(true);
    setError('');
    try {
      const data = await createCustomerPortal();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      setError((err as Error).message || 'Erreur lors de l\'ouverture du portail');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCopyPaymentValue(label: string, value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback(`${label} copie`);
      window.setTimeout(() => setCopyFeedback(''), 2200);
    } catch {
      setCopyFeedback(`${label}: ${value}`);
    }
  }

  function formatDate(dateString?: string | number | null) {
    if (!dateString) return 'N/A';
    try {
      const date = typeof dateString === 'number' 
        ? new Date(dateString * 1000) 
        : new Date(dateString);
      return new Intl.DateTimeFormat('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(date);
    } catch {
      return 'N/A';
    }
  }

  const panelStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    padding: '24px',
    maxWidth: '760px',
    margin: '0 auto',
  };

  const cardStyle: React.CSSProperties = {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '12px',
    padding: '20px',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '12px 24px',
    borderRadius: '8px',
    border: 'none',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'all 0.2s',
  };

  const primaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    background: '#7c3aed',
    color: 'white',
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    background: '#334155',
    color: '#e2e8f0',
  };

  const paymentGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: '10px',
    marginTop: '16px',
  };

  const paymentTileStyle: React.CSSProperties = {
    border: '1px solid #334155',
    borderRadius: '8px',
    padding: '12px',
    background: '#111827',
    minHeight: '132px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: '10px',
  };

  const paymentTileButtonStyle: React.CSSProperties = {
    ...secondaryButtonStyle,
    width: '100%',
    padding: '9px 12px',
    fontSize: '13px',
  };

  const studioPlan = {
    ...A11_STUDIO_PLAN,
    name: productName === 'Kaen44' ? 'Kaen44 Plus' : A11_STUDIO_PLAN.name,
  };
  const studioFeatures = STUDIO_FEATURES.map((feature) => feature.replace(/\bA11\b/g, productName));
  const contributionRewards = CONTRIBUTION_REWARDS.map((reward) => reward.replace(/\bA11\b/g, productName));
  const subscriptionTitle = productName === 'Kaen44' ? 'Abonnement Kaen44' : 'Abonnement A11';
  const activationLabel = productName === 'Kaen44' ? 'Activer Kaen44 Plus' : 'Activer A11 Studio';

  if (loading) {
    return (
      <div style={panelStyle}>
        <h2 style={{ margin: 0, color: '#f1f5f9' }}>{subscriptionTitle}</h2>
        <div style={{ ...cardStyle, textAlign: 'center', padding: '40px' }}>
          <div style={{ color: '#94a3b8' }}>Chargement...</div>
        </div>
      </div>
    );
  }

  if (isAdmin || status?.fullAccess) {
    return (
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, color: '#f1f5f9' }}>{subscriptionTitle}</h2>
          {onClose && (
            <button
              onClick={onClose}
              style={{ ...secondaryButtonStyle, padding: '8px 16px' }}
            >
              Fermer
            </button>
          )}
        </div>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>👑</div>
          <h3 style={{ margin: '0 0 8px 0', color: '#f1f5f9' }}>
            {isAdmin ? 'Acces Administrateur' : 'Acces gratuit complet'}
          </h3>
          <p style={{ margin: 0, color: '#94a3b8' }}>
            Vous avez un acces complet a {productName}, aux quotas internes et a la supervision des credits.
          </p>
        </div>
      </div>
    );
  }

  const isActive = status?.active || false;
  const willCancel = status?.stripeStatus?.cancelAtPeriodEnd || false;

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, color: '#f1f5f9' }}>{subscriptionTitle}</h2>
        {onClose && (
          <button
            onClick={onClose}
            style={{ ...secondaryButtonStyle, padding: '8px 16px' }}
          >
            Fermer
          </button>
        )}
      </div>

      {error && (
        <div style={{
          background: '#7f1d1d',
          border: '1px solid #991b1b',
          borderRadius: '8px',
          padding: '12px 16px',
          color: '#fecaca',
          fontSize: '14px',
        }}>
          {error}
        </div>
      )}

      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div style={{ fontSize: '32px' }}>
            {isActive ? '✅' : '❌'}
          </div>
          <div>
            <h3 style={{ margin: '0 0 4px 0', color: '#f1f5f9' }}>
              {isActive ? 'Abonnement Actif' : 'Pas d\'abonnement'}
            </h3>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '14px' }}>
              {isActive 
                ? willCancel 
                  ? `Actif jusqu'au ${formatDate(status?.stripeStatus?.currentPeriodEnd)}`
                  : `Renouvellement le ${formatDate(status?.stripeStatus?.currentPeriodEnd)}`
                : `Activez ${studioPlan.name} pour obtenir le chat long et des credits creation`
              }
            </p>
          </div>
        </div>

        {!isActive && (
          <div style={{
            background: '#0f172a',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '12px' }}>
              <div>
                <div style={{ color: '#f1f5f9', fontWeight: 'bold', fontSize: '18px' }}>{studioPlan.name}</div>
                <div style={{ color: '#38bdf8', fontSize: '13px', marginTop: '4px' }}>{studioPlan.includedTokens}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ color: '#f1f5f9', fontWeight: 'bold', fontSize: '24px' }}>{studioPlan.price}</span>
                <div style={{ color: '#94a3b8', fontSize: '14px' }}>{studioPlan.period}</div>
              </div>
            </div>
            <ul style={{ margin: '0', paddingLeft: '20px', color: '#cbd5e1', fontSize: '14px' }}>
              {studioFeatures.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <div style={{ borderTop: '1px solid #1e293b', marginTop: '16px', paddingTop: '14px' }}>
              <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '13px', marginBottom: '8px' }}>
                Jetons bonus par pertinence
              </div>
              <ul style={{ margin: '0', paddingLeft: '20px', color: '#cbd5e1', fontSize: '13px' }}>
                {contributionRewards.map((reward) => (
                  <li key={reward}>{reward}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {!isActive ? (
            <button
              onClick={handleSubscribe}
              disabled={actionLoading}
              style={{
                ...primaryButtonStyle,
                opacity: actionLoading ? 0.6 : 1,
                cursor: actionLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {actionLoading ? 'Chargement...' : activationLabel}
            </button>
          ) : (
            <button
              onClick={handleManageSubscription}
              disabled={actionLoading}
              style={{
                ...primaryButtonStyle,
                opacity: actionLoading ? 0.6 : 1,
                cursor: actionLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {actionLoading ? 'Chargement...' : 'Gérer mon abonnement'}
            </button>
          )}

          {/* Accès au portail Stripe (factures) — disponible dès qu'un compte Stripe existe */}
          {(isActive || status?.stripeStatus) && (
            <button
              onClick={handleManageSubscription}
              disabled={actionLoading}
              style={{
                ...secondaryButtonStyle,
                opacity: actionLoading ? 0.6 : 1,
                cursor: actionLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              🧾 {actionLoading ? 'Chargement...' : 'Mes factures'}
            </button>
          )}
        </div>

        {!isActive && (
          <div style={{ borderTop: '1px solid #1e293b', marginTop: '18px', paddingTop: '16px' }}>
            <div style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '15px' }}>
              Moyens de paiement disponibles
            </div>
            <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '4px' }}>
              Stripe active automatiquement les moyens compatibles depuis le dashboard; Wero et virement restent en validation manuelle.
            </div>

            <div style={paymentGridStyle}>
              <div style={paymentTileStyle}>
                <div>
                  <div style={{ color: '#e2e8f0', fontWeight: 800 }}>Stripe Checkout</div>
                  <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '5px' }}>
                    Carte, wallets, Link et moyens locaux actives selon pays et configuration Stripe.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSubscribe}
                  disabled={actionLoading}
                  style={{
                    ...paymentTileButtonStyle,
                    opacity: actionLoading ? 0.6 : 1,
                    cursor: actionLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  Ouvrir Stripe
                </button>
              </div>

              {WERO_PHONE && (
                <div style={paymentTileStyle}>
                  <div>
                    <div style={{ color: '#e2e8f0', fontWeight: 800 }}>Wero</div>
                    <div style={{ color: '#38bdf8', fontSize: '15px', marginTop: '5px', fontWeight: 800 }}>
                      {formatFrenchPhone(WERO_PHONE)}
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '5px' }}>
                      Indiquez l'email du compte {productName} en reference.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyPaymentValue('Numero Wero', WERO_PHONE)}
                    style={paymentTileButtonStyle}
                  >
                    Copier Wero
                  </button>
                </div>
              )}

              {RIB_DOCUMENT_URL && (
                <div style={paymentTileStyle}>
                  <div>
                    <div style={{ color: '#e2e8f0', fontWeight: 800 }}>Virement bancaire</div>
                    <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '5px' }}>
                      Ouvre le document RIB securise. Ajoutez l'email du compte {productName} dans le libelle.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openExternal(RIB_DOCUMENT_URL)}
                    style={paymentTileButtonStyle}
                  >
                    Ouvrir le RIB
                  </button>
                </div>
              )}

              {(PAYPAL_URL || PAYPAL_EMAIL) && (
                <div style={paymentTileStyle}>
                  <div>
                    <div style={{ color: '#e2e8f0', fontWeight: 800 }}>PayPal</div>
                    {PAYPAL_EMAIL && (
                      <div style={{ color: '#38bdf8', fontSize: '13px', marginTop: '5px', fontWeight: 800, wordBreak: 'break-word' }}>
                        {PAYPAL_EMAIL}
                      </div>
                    )}
                    <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '5px' }}>
                      Compte Business PayPal avec validation manuelle.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => (
                      PAYPAL_URL
                        ? openExternal(PAYPAL_URL)
                        : handleCopyPaymentValue('Email PayPal', PAYPAL_EMAIL)
                    )}
                    style={paymentTileButtonStyle}
                  >
                    {PAYPAL_URL ? 'Ouvrir PayPal' : 'Copier PayPal'}
                  </button>
                </div>
              )}

              <div style={paymentTileStyle}>
                <div>
                  <div style={{ color: '#e2e8f0', fontWeight: 800 }}>Devis ou autre moyen</div>
                  <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '5px' }}>
                    Pour facture, preuve de paiement, changement d'offre ou paiement manuel.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openExternal(buildPaymentContactLink())}
                  style={paymentTileButtonStyle}
                >
                  Contacter
                </button>
              </div>
            </div>

            {copyFeedback && (
              <div style={{ color: '#a7f3d0', fontSize: '12px', marginTop: '10px' }}>
                {copyFeedback}
              </div>
            )}
          </div>
        )}
      </div>

      {isActive && (
        <div style={{
          background: '#064e3b',
          border: '1px solid #065f46',
          borderRadius: '8px',
          padding: '12px 16px',
          color: '#a7f3d0',
          fontSize: '14px',
        }}>
          <strong>Merci pour votre soutien !</strong> Vous avez accès à {studioPlan.name}, au chat long et aux credits de creation.
        </div>
      )}

      <div style={{
        ...cardStyle,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 260, flex: 1 }}>
          <div style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '16px' }}>{BLUEPRINT_OFFER.label}</div>
          <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '6px' }}>{BLUEPRINT_OFFER.detail}</div>
          <div style={{ color: '#cbd5e1', fontSize: '12px', marginTop: '8px' }}>
            Contact qualifie par email; telephone transmis uniquement apres cadrage.
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#f1f5f9', fontWeight: 800, fontSize: '22px' }}>{BLUEPRINT_OFFER.price}</div>
          <button
            type="button"
            onClick={() => window.open(buildBlueprintContactLink(), '_blank')}
            style={{ ...secondaryButtonStyle, marginTop: '10px' }}
          >
            Qualifier le Blueprint
          </button>
        </div>
      </div>
    </div>
  );
}
